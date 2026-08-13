import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsuarioActual, getEmpresaActual } from "@/lib/auth";
import { getConfigEmpresa } from "@/lib/config";
import { generarJobId } from "@/lib/jobs";
import { enviarAN8n } from "@/lib/n8n/cliente";
import { construirEjemplos, type JobHistorico } from "@/lib/aprendizaje";
import { hidratarJobsModoTabla } from "@/lib/conciliacion/historico";
import { criteriosParaIa } from "@/lib/criteriosIniciales";
import { estadoSuscripcion } from "@/lib/suscripcion";
import { bloqueaRelanzamiento } from "@/lib/jobsAtascados";
import { construirResiduo } from "@/lib/conciliacion/residuo";
import { capturarOrigenPartidas } from "@/lib/origenPartidas-servidor";
import { calcularCuadre } from "@/lib/conciliacion/cuadre";
import { maxFilasConciliacion } from "@/lib/limites";
import type { EstadoJob } from "@/lib/contract/enums";
import {
  PayloadConciliacion,
  Periodo,
  Saldos,
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";
import { ConfigConciliacion } from "@/lib/contract/config";

/**
 * POST /api/conciliacion/iniciar
 *
 * Backend delgado que orquesta el arranque de una conciliación (§7.1):
 *  1) autentica al usuario y valida el payload,
 *  2) genera job_id e inserta el job (estado 'pendiente'),
 *  3) recién entonces dispara n8n (webhook) con el token,
 *  4) compara los conteos recibidos vs. enviados.
 * El frontend nunca contacta a n8n ni conoce el token.
 */

/**
 * Tope de partidas por lado en una conciliación.
 *
 * Es un TECHO, no un objetivo: una empresa con 500–2.000 movimientos —el caso
 * más común— no lo roza nunca. Existe para que un archivo absurdo no tumbe el
 * motor ni deje un `resultado` inmanejable.
 *
 * ⚠️ VA EMPAREJADO CON EL TOPE DE PAYLOAD DE n8n. Cada fila pesa ~194 bytes
 * medidos, así que el payload son `filas × 2 × 194`:
 *
 *     20.000 →  7,8 MB   cabe en el defecto de n8n (16 MB)
 *     36.000 → 14,0 MB   cabe, justo
 *     50.000 → 19,4 MB   ⚠️ NO cabe: hay que subir N8N_PAYLOAD_SIZE_MAX
 *
 * Por eso es una variable de entorno con el valor prudente por defecto: quien
 * necesite más lo sube **junto con** el de n8n, y nadie hereda una combinación
 * rota por defecto. Un despliegue de gran volumen (p. ej. una recaudadora que
 * concilia por día con picos de 36.000) pone 50.000 aquí y 64 MB allá.
 *
 * El valor vive en `lib/limites.ts` porque el diagnóstico previo del Paso 3
 * avisa de este mismo tope antes de que este endpoint lo aplique: con dos
 * números distintos, el wizard diría que cabe algo que luego se rechaza.
 */
const MAX_FILAS = maxFilasConciliacion();

/**
 * Dos formas de iniciar, y la diferencia es de dónde salen las partidas.
 *
 * ── Modo TABLA (`lote_extracto_id`) ────────────────────────────────────────
 *
 * El extracto ya está en `movimientos_extracto` y los comprobantes en su tabla,
 * así que el navegador NO manda partidas: manda el identificador del lote y
 * cuatro datos más. La capa exacta corre en SQL y a n8n solo viaja el residuo.
 *
 * Es lo que hace viable el cliente grande: 903.176 partidas no caben en un
 * JSON, pero un uuid sí.
 *
 * ── Modo PAYLOAD (arrays) ──────────────────────────────────────────────────
 *
 * El camino de siempre, que sigue vivo: el navegador parsea el extracto y manda
 * las filas. Con 500–2.000 movimientos es más simple y no tiene
 * ninguna desventaja, y además es el que usan todas las conciliaciones ya
 * guardadas.
 */
const IniciarReq = z
  .object({
    cuenta_id: z.string().uuid(),
    periodo: Periodo,
    saldos: Saldos,
    config: ConfigConciliacion.partial().optional(),
    lote_extracto_id: z.string().uuid().optional(),
    registros_internos: z
      .array(RegistroInterno)
      .max(MAX_FILAS, `Máximo ${MAX_FILAS} registros internos por conciliación. Concilia el período en cortes más cortos (por ejemplo, por semana o por día).`)
      .optional(),
    movimientos_bancarios: z
      .array(MovimientoBancario)
      .max(MAX_FILAS, `Máximo ${MAX_FILAS} movimientos bancarios por conciliación. Concilia el período en cortes más cortos.`)
      .optional(),
  })
  .refine(
    (r) =>
      r.lote_extracto_id != null ||
      ((r.registros_internos?.length ?? 0) > 0 &&
        (r.movimientos_bancarios?.length ?? 0) > 0),
    {
      message:
        "Falta el extracto: envía `lote_extracto_id` o las partidas de los dos lados.",
    },
  );

export async function POST(request: Request) {
  const usuario = await getUsuarioActual();
  const empresa = await getEmpresaActual();
  if (!usuario || !empresa) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  // Período de prueba: este es el punto donde el límite se hace cumplir. La
  // interfaz además lo explica y desactiva el acceso al wizard, pero ocultar un
  // botón no es un control — cualquiera puede llamar a este endpoint directo.
  const suscripcion = estadoSuscripcion(empresa);
  if (!suscripcion.puedeConciliar) {
    return NextResponse.json(
      {
        error:
          "Tu período de prueba terminó. Puedes seguir consultando tus conciliaciones anteriores; para generar una nueva, escríbenos y activamos tu cuenta.",
        motivo: "prueba_vencida",
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = IniciarReq.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const req = parsed.data;

  // La cuenta debe pertenecer a la empresa del usuario (RLS lo garantiza).
  const supabase = await createClient();
  const { data: cuenta } = await supabase
    .from("cuentas_bancarias")
    .select("id, banco, numero_enmascarado, moneda")
    .eq("id", req.cuenta_id)
    .maybeSingle();
  if (!cuenta) {
    return NextResponse.json(
      { error: "Cuenta no encontrada." },
      { status: 404 },
    );
  }

  const admin = createAdminClient();

  // Idempotencia: no crear dos jobs activos iguales (misma cuenta+período).
  //
  // ⚠️ Un job en vuelo reserva su período para que dos clics no creen dos
  // conciliaciones, pero esa reserva CADUCA. n8n responde en su segundo nodo,
  // así que puede aceptar con 200 y morir en cualquiera de los ocho siguientes;
  // el job se queda en `procesando` y, sin caducidad, encerraba al usuario en un
  // período que ya no podía relanzar. Ver `lib/jobsAtascados.ts`.
  const { data: enVuelo } = await admin
    .from("jobs_conciliacion")
    .select("id, estado, created_at")
    .eq("empresa_id", empresa.empresa_id)
    .eq("cuenta_id", req.cuenta_id)
    .eq("periodo_desde", req.periodo.desde)
    .eq("periodo_hasta", req.periodo.hasta)
    .in("estado", ["pendiente", "procesando"])
    .order("created_at", { ascending: false })
    .limit(1);
  const activo = (enVuelo ?? []).find((j) =>
    bloqueaRelanzamiento(j.estado as EstadoJob, j.created_at),
  );
  if (activo) {
    return NextResponse.json({ job_id: activo.id, idempotente: true });
  }

  // Versión: cuántas veces se ha corrido ya este mismo cuenta+rango. La corrida
  // anterior (si la hay) queda como origen, para poder seguir la trazabilidad
  // de un reproceso hasta la conciliación de la que salió.
  const { data: previas } = await admin
    .from("jobs_conciliacion")
    .select("id, version")
    .eq("empresa_id", empresa.empresa_id)
    .eq("cuenta_id", req.cuenta_id)
    .eq("periodo_desde", req.periodo.desde)
    .eq("periodo_hasta", req.periodo.hasta)
    .order("version", { ascending: false })
    .limit(1);
  const anterior = previas?.[0] ?? null;
  const version = (anterior?.version ?? 0) + 1;

  const jobId = generarJobId(req.periodo.desde);
  const modoTabla = req.lote_extracto_id != null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Config de la empresa (editable en /configuracion) + override por request.
  const configEmpresa = await getConfigEmpresa();

  // Few-shot dinámico: decisiones humanas de conciliaciones previas de la
  // empresa, para que la IA calibre su criterio con el historial real.
  const { data: historicos } = await admin
    .from("jobs_conciliacion")
    .select("id, payload_entrada, resultado, lote_extracto_id")
    .eq("empresa_id", empresa.empresa_id)
    .eq("estado", "completado")
    .not("resultado", "is", null)
    .order("completed_at", { ascending: false })
    .limit(30);
  // Los jobs de modo tabla guardan sus pares fuera del JSONB: se hidratan los
  // revisados por una persona, que son los únicos que enseñan algo.
  const ejemplos = construirEjemplos(
    (await hidratarJobsModoTabla(
      (historicos ?? []) as { id: string; lote_extracto_id?: string | null }[],
    )) as unknown as JobHistorico[],
  );

  // Arranque en frío: el criterio que la empresa declaró. Va SIEMPRE, no solo
  // cuando faltan ejemplos — el prompt le dice al modelo que las decisiones
  // reales mandan sobre lo declarado, así que sumar no resta.
  const { data: filaEmpresa } = await admin
    .from("empresas")
    .select("criterios_conciliacion")
    .eq("id", empresa.empresa_id)
    .maybeSingle();
  const criterios = criteriosParaIa(
    (filaEmpresa?.criterios_conciliacion as string[] | null) ?? [],
  );

  // ── De dónde salen las partidas ──────────────────────────────────────────
  //
  // En modo TABLA el job tiene que existir ANTES de correr la capa exacta:
  // `conciliar_exacta` parte de él para saber empresa, cuenta, período y lote.
  // Por eso aquí el orden se invierte respecto al modo payload, donde el job se
  // inserta ya con las partidas validadas.
  // ── De dónde salen las partidas: la foto, ANTES de tocar nada ────────────
  //
  // ⚠️⚠️ Se congela aquí y no se recalcula nunca. Al aprobar, los comprobantes
  // casados pasan a `cobrado`, así que "del período y sin cobrar" se desploma de
  // 452.177 a 4.382: una pantalla que lo recalculara enseñaría un número peor
  // cada vez que alguien la mirase. Es el mismo fallo que la 0033 tuvo que
  // arreglar en el resumen ejecutivo.
  //
  // Si falla, la conciliación sigue: se pierde la explicación, no el trabajo.
  const origen = await capturarOrigenPartidas(
    admin,
    empresa.empresa_id,
    req.periodo.desde,
    req.periodo.hasta,
    cuenta.moneda,
  );

  const filaJob = {
    id: jobId,
    empresa_id: empresa.empresa_id,
    cuenta_id: req.cuenta_id,
    usuario_id: usuario.id,
    periodo_desde: req.periodo.desde,
    periodo_hasta: req.periodo.hasta,
    origen_partidas: origen,
    estado: "pendiente",
    // Nace como borrador: aprobarla es un acto humano posterior (Fase B).
    estado_contable: "borrador",
    version,
    conciliacion_origen_id: anterior?.id ?? null,
    // Se promueven a columna para poder validar que un corte encadene con el
    // anterior; dentro del JSONB del payload no son consultables.
    saldo_inicial_banco: req.saldos?.saldo_extracto_inicial ?? null,
    saldo_final_banco: req.saldos?.saldo_extracto_final ?? null,
    lote_extracto_id: req.lote_extracto_id ?? null,
  };

  let internos = req.registros_internos ?? [];
  let bancarios = req.movimientos_bancarios ?? [];
  let paresExactos = 0;

  if (modoTabla) {
    const { error } = await admin.from("jobs_conciliacion").insert(filaJob);
    if (error) {
      return NextResponse.json({ error: "No se pudo crear el job." }, { status: 500 });
    }
    try {
      const residuo = await construirResiduo(admin, jobId, MAX_FILAS);
      internos = residuo.registros_internos;
      bancarios = residuo.movimientos_bancarios;
      paresExactos = residuo.paresExactos;
    } catch (e) {
      // El job ya existe, así que un fallo aquí tiene que dejarlo marcado: si no,
      // se quedaría `pendiente` para siempre reservando su período.
      const detalle = e instanceof Error ? e.message : "Fallo al preparar las partidas.";
      await admin
        .from("jobs_conciliacion")
        .update({ estado: "error", error_detalle: detalle })
        .eq("id", jobId);
      return NextResponse.json({ error: detalle }, { status: 500 });
    }

    // ⚠️ Si a alguno de los dos lados no le queda residuo, n8n no puede aportar
    // nada: no hay contra qué casar lo que sobra. Se cierra aquí en vez de
    // mandar un payload que el motor rechazaría — y el usuario ve una
    // conciliación completada, que es la verdad.
    if (internos.length === 0 || bancarios.length === 0) {
      const cuadre = calcularCuadre(req.saldos ?? {}, internos, bancarios);
      await admin
        .from("jobs_conciliacion")
        .update({
          estado: "completado",
          completed_at: new Date().toISOString(),
          fase_actual: "exacta",
          // Los pares viven en `matches_conciliacion`; el JSONB se queda con lo
          // que no crece: el resumen y el cuadre.
          resultado: {
            resumen: {
              total_internos: paresExactos + internos.length,
              total_bancarios: paresExactos + bancarios.length,
              conciliados_exactos: paresExactos,
              conciliados_difusos: 0,
              sugeridos_ia: 0,
              sin_conciliar_internos: internos.length,
              sin_conciliar_bancarios: bancarios.length,
            },
            matches: [],
            no_conciliados: [],
            cuadre,
          },
        })
        .eq("id", jobId);
      return NextResponse.json({ job_id: jobId, modo: "sql", pares: paresExactos });
    }
  }

  const payload = {
    job_id: jobId,
    metadata: {
      empresa_id: empresa.empresa_id,
      usuario_id: usuario.id,
      periodo: req.periodo,
      cuenta: {
        banco: cuenta.banco,
        numero: cuenta.numero_enmascarado ?? "****",
        moneda: cuenta.moneda,
      },
      saldos: req.saldos,
      callback_url: `${appUrl}/api/webhooks/resultado-conciliacion`,
    },
    config: { ...configEmpresa, ...(req.config ?? {}) },
    registros_internos: internos,
    movimientos_bancarios: bancarios,
    ...(ejemplos.length ? { ejemplos_aprendizaje: ejemplos } : {}),
    ...(criterios.length ? { criterios_declarados: criterios } : {}),
  };

  const validado = PayloadConciliacion.safeParse(payload);
  if (!validado.success) {
    return NextResponse.json(
      { error: "El payload no cumple el contrato.", detalle: validado.error.issues[0]?.message },
      { status: 400 },
    );
  }

  // El job: se inserta ahora en modo payload, o se completa el que ya se creó
  // en modo tabla. En los dos casos queda guardado lo que se envió.
  const { error: insError } = modoTabla
    ? await admin
        .from("jobs_conciliacion")
        .update({ payload_entrada: validado.data })
        .eq("id", jobId)
    : await admin
        .from("jobs_conciliacion")
        .insert({ ...filaJob, payload_entrada: validado.data });
  if (insError) {
    return NextResponse.json(
      { error: "No se pudo crear el job." },
      { status: 500 },
    );
  }

  // Disparar el procesamiento en n8n (webhook con token).
  const envio = await enviarAN8n(validado.data);
  if (!envio.ok) {
    if (envio.entregaIncierta) {
      // Se agotó el tiempo con la petición ya en vuelo: NO se sabe si n8n la
      // recibió. Marcar 'error' seria mentir — puede estar procesándose, y el
      // resultado llegaría después pisando ese estado. El job se queda en
      // 'pendiente' y la pantalla de progreso (Realtime + polling) resuelve
      // sola el caso bueno; si n8n nunca lo recibió, queda visible en el
      // historial para reintentarlo.
      await admin
        .from("jobs_conciliacion")
        .update({ error_detalle: envio.error })
        .eq("id", jobId);
      return NextResponse.json(
        { job_id: jobId, aviso: envio.error },
        { status: 202 },
      );
    }
    await admin
      .from("jobs_conciliacion")
      .update({ estado: "error", error_detalle: envio.error })
      .eq("id", jobId);
    return NextResponse.json({ error: envio.error }, { status: 502 });
  }

  // Comparar conteos enviados vs. recibidos.
  const enviadosInt = validado.data.registros_internos.length;
  const enviadosBanc = validado.data.movimientos_bancarios.length;
  if (
    envio.aceptacion.registros_recibidos !== enviadosInt ||
    envio.aceptacion.movimientos_recibidos !== enviadosBanc
  ) {
    const detalle = `Conteos no coinciden: enviados ${enviadosInt}/${enviadosBanc}, recibidos ${envio.aceptacion.registros_recibidos}/${envio.aceptacion.movimientos_recibidos}.`;
    await admin
      .from("jobs_conciliacion")
      .update({ estado: "error", error_detalle: detalle })
      .eq("id", jobId);
    return NextResponse.json({ error: detalle }, { status: 502 });
  }

  await admin
    .from("jobs_conciliacion")
    .update({ estado: "procesando" })
    .eq("id", jobId);

  return NextResponse.json({ job_id: jobId, modo: "n8n" });
}
