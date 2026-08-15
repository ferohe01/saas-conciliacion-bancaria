import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmpresaActual, getUsuarioActual } from "@/lib/auth";
import { enLotes } from "@/lib/supabase/paginado";
import { LectorCsv, type FilaCsv } from "@/lib/parsing/csv";
import { normalizarMovimiento } from "@/lib/normalizacion/canonico";
import { normalizarMonto } from "@/lib/normalizacion/monto";
import type { MapeoColumnas } from "@/lib/parsing/deteccion";

/**
 * Ingesta del EXTRACTO BANCARIO en servidor, por lotes (parte B, etapa 1).
 *
 * ── Qué desbloquea ─────────────────────────────────────────────────────────
 *
 * Hasta aquí el extracto se parseaba en el navegador y sus filas viajaban
 * dentro del payload a n8n. Con una cuenta recaudadora —450.999 movimientos en
 * un mes— eso ni siquiera llega a enviarse: el navegador tendría que abrir un
 * Excel de 23 MB y construir un JSON de ~175 MB en memoria.
 *
 * Aquí sube el ARCHIVO y el servidor lo lee a trozos, normaliza fila a fila y
 * va insertando. Memoria constante, sin tope de filas para CSV.
 *
 * ── Por qué llega también el mapeo ─────────────────────────────────────────
 *
 * Qué columna es la fecha y cuál el monto lo decide la persona en el Paso 2,
 * mirando una previsualización. Esa previsualización sigue siendo del navegador
 * —son las primeras filas, no pesa— y lo que viaja aquí es el mapeo YA
 * confirmado. Se mantiene el principio de siempre: lo que el usuario confirma
 * en pantalla es exactamente lo que se procesa.
 *
 * ⚠️ La normalización la hace `normalizarMovimiento`, la MISMA función que usa
 * el camino del navegador. Con dos copias, la convención de signos acabaría
 * divergiendo entre un extracto grande y uno pequeño — y un cargo interpretado
 * como abono no se ve en pantalla, se ve en el cuadre tres semanas después.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

/** Filas por INSERT. Con el statement_timeout de 8 s de Postgres, sobra margen. */
const LOTE = 1000;

/** Tope para XLSX, que se descomprime entero en memoria. El CSV no tiene tope. */
const MAX_FILAS_XLSX = 50_000;

const Cuerpo = z.object({
  cuenta_id: z.string().uuid(),
  // El período elegido, para poder avisar de un archivo que no le corresponde.
  // Lo cuenta el servidor porque es quien ve TODAS las fechas: el navegador
  // solo tiene las primeras filas y podría dar por bueno un archivo entero
  // mirando su cabecera.
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mapeo: z.object({
    fecha: z.string().optional(),
    monto: z.string().optional(),
    descripcion: z.string().optional(),
    referencia: z.string().optional(),
    contraparte: z.string().optional(),
    tipo: z.string().optional(),
    saldo: z.string().optional(),
  }),
  /**
   * Para qué se sube. `wizard` es conciliar; `caja` es ver el saldo de hoy sin
   * conciliar (fase 2). Solo lo segundo cuenta como saldo vivo, y por eso la
   * distinción se guarda en vez de inferirse: «el último lote sin job» dejaría
   * que un wizard abandonado mandara sobre la caja.
   */
  origen: z.enum(["wizard", "caja"]).default("wizard"),
});

type Fila = {
  empresa_id: string;
  cuenta_id: string;
  lote_id: string;
  fecha: string;
  monto: number;
  referencia_banco: string | null;
  glosa: string | null;
  /** El saldo corriente que declara el banco en esa fila, si la trae. */
  saldo: number | null;
  orden: number;
};

export async function POST(request: Request) {
  const empresa = await getEmpresaActual();
  if (!empresa) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "No llegó ningún archivo." }, { status: 400 });
  }

  const parsed = Cuerpo.safeParse({
    cuenta_id: form?.get("cuenta_id"),
    mapeo: JSON.parse(String(form?.get("mapeo") ?? "{}")),
    desde: form?.get("desde") ?? undefined,
    hasta: form?.get("hasta") ?? undefined,
    origen: form?.get("origen") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Falta la cuenta o el mapeo de columnas." },
      { status: 400 },
    );
  }
  const { cuenta_id, desde, hasta, origen } = parsed.data;

  // La cuenta debe ser de su empresa. RLS lo garantiza en esta lectura.
  const supabase = await createClient();
  const { data: cuenta } = await supabase
    .from("cuentas_bancarias")
    .select("id, mapeo_columnas")
    .eq("id", cuenta_id)
    .maybeSingle();
  if (!cuenta) {
    return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });
  }

  /**
   * Desde la caja no hay Paso 2 donde mapear columnas, así que se usa el
   * formato que la cuenta ya aprendió conciliando.
   *
   * ⚠️ NO se abre aquí una segunda pantalla de mapeo. Elegir columnas es la
   * decisión que más se equivoca —y el error no se ve: sale un 0 %—, así que
   * se hace UNA vez, mirando la previsualización del wizard, y aquí se
   * reutiliza. Si la cuenta no tiene formato guardado, esto no adivina: manda
   * a conciliar una vez, que es donde se enseña lo que se está interpretando.
   */
  const guardado = (cuenta.mapeo_columnas as { extracto?: Record<string, string> } | null)
    ?.extracto;
  const mapeo =
    parsed.data.mapeo.fecha && parsed.data.mapeo.monto
      ? parsed.data.mapeo
      : ((guardado ?? {}) as typeof parsed.data.mapeo);
  if (!mapeo.fecha || !mapeo.monto) {
    return NextResponse.json(
      {
        error:
          "Esta cuenta todavía no tiene un formato de extracto guardado. Concilia una vez con el asistente: ahí eliges qué columna es la fecha y cuál el importe, y a partir de entonces se recuerda.",
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const lote_id = randomUUID();
  let insertados = 0;
  let invalidas = 0;
  let orden = 0;
  // El saldo de la ÚLTIMA fila con valor. El navegador ya no puede detectarlo
  // —solo ve las primeras filas— y adivinarlo mal corrompe el cuadre en
  // silencio, así que lo devuelve quien ve el archivo entero.
  let saldoFinal: number | null = null;
  let sumaMontos = 0;
  let fueraDePeriodo = 0;
  let fechaMin: string | null = null;
  let fechaMax: string | null = null;
  let pendientes: Fila[] = [];

  const descargar = async (): Promise<string | null> => {
    if (pendientes.length === 0) return null;
    for (const parte of enLotes(pendientes, LOTE)) {
      // ⚠️ Se comprueba el error. `supabase-js` lo DEVUELVE, no lo lanza: sin
      // esto, un extracto podría quedar cargado a medias y la conciliación
      // saldría "correcta" sobre datos incompletos.
      const { error } = await admin.from("movimientos_extracto").insert(parte);
      if (error) {
        console.error(`[extracto] fallo al insertar el lote ${lote_id}:`, error);
        return "No se pudieron guardar los movimientos del extracto.";
      }
      insertados += parte.length;
    }
    pendientes = [];
    return null;
  };

  const admitir = (cruda: Record<string, unknown>) => {
    const m = normalizarMovimiento(cruda, mapeo as MapeoColumnas, orden);
    if (!m) {
      invalidas++;
      return;
    }
    // ⚠️ El saldo corriente se GUARDA, no solo se acumula en memoria. La
    // columna existe desde la 0022 y hasta ahora nunca se escribía: el saldo
    // de la última fila se calculaba aquí, viajaba al wizard y moría si nadie
    // llegaba a iniciar la conciliación. Es el dato que hace posible el saldo
    // vivo (fase 2), y el saldo por día que necesitará la proyección.
    let saldoFila: number | null = null;
    if (mapeo.saldo) {
      saldoFila = normalizarMonto(cruda[mapeo.saldo]);
      if (saldoFila != null) saldoFinal = saldoFila;
    }
    sumaMontos += m.monto;
    if (fechaMin === null || m.fecha < fechaMin) fechaMin = m.fecha;
    if (fechaMax === null || m.fecha > fechaMax) fechaMax = m.fecha;
    if ((desde && m.fecha < desde) || (hasta && m.fecha > hasta)) fueraDePeriodo++;
    pendientes.push({
      empresa_id: empresa.empresa_id,
      cuenta_id,
      lote_id,
      fecha: m.fecha,
      monto: m.monto,
      referencia_banco: m.referencia_banco ?? null,
      glosa: m.glosa ?? null,
      saldo: saldoFila,
      orden,
    });
    orden++;
  };

  try {
    if (archivo.name.toLowerCase().endsWith(".csv")) {
      // ── El camino que escala: trozo → filas → insertar → soltar ──
      const lector = new LectorCsv();
      const decoder = new TextDecoder("utf-8");
      const reader = archivo.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const f of lector.trozo(decoder.decode(value, { stream: true }))) {
          admitir(f as unknown as Record<string, unknown>);
        }
        if (pendientes.length >= LOTE) {
          const err = await descargar();
          if (err) return NextResponse.json({ error: err }, { status: 400 });
        }
      }
      for (const f of lector.fin() as FilaCsv[]) {
        admitir(f as unknown as Record<string, unknown>);
      }
    } else {
      // ── XLSX: hay que descomprimirlo entero antes de ver la primera fila ──
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await archivo.arrayBuffer(), { cellDates: true });
      const hoja = wb.SheetNames[0];
      if (!hoja) {
        return NextResponse.json({ error: "El archivo no tiene hojas." }, { status: 400 });
      }
      const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[hoja]!, {
        defval: null,
        raw: false,
      });
      if (filas.length > MAX_FILAS_XLSX) {
        return NextResponse.json(
          {
            error: `Este Excel trae ${filas.length.toLocaleString("es-PE")} movimientos y el máximo es ${MAX_FILAS_XLSX.toLocaleString("es-PE")}. Guárdalo como CSV: ese formato no tiene tope porque se lee por partes.`,
          },
          { status: 413 },
        );
      }
      for (const f of filas) admitir(f);
    }

    const err = await descargar();
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  } catch (e) {
    console.error(`[extracto] no se pudo leer ${archivo.name}:`, e);
    return NextResponse.json(
      { error: `No pudimos leer "${archivo.name}". Revisa que sea un Excel o CSV sin contraseña.` },
      { status: 400 },
    );
  }

  if (insertados === 0) {
    // Un lote vacío no sirve para conciliar y dejarlo pasar produciría un job
    // sin movimientos que parecería un fallo del motor.
    return NextResponse.json(
      {
        error:
          "No se pudo interpretar ningún movimiento. Revisa que las columnas de fecha y monto sean las correctas.",
      },
      { status: 400 },
    );
  }

  // ⚠️ Estadísticas frescas antes de que alguien concilie esto.
  //
  // Acabamos de meter cientos de miles de filas y el planificador aún cree que
  // la tabla tiene el tamaño de antes. Con datos viejos elige planes que se
  // pasan del `statement_timeout` en la MISMA consulta que iba bien —pasó con
  // `residuo_internos`, de 1,68 s a cancelarse, sin que cambiara una línea de
  // código. Autovacuum lo haría solo, pero tarda, y la ventana en la que no lo
  // ha hecho es justo cuando se concilia lo recién importado.
  //
  // Si falla no se interrumpe la carga: los datos están, y lo peor que puede
  // pasar es una conciliación lenta.
  const { error: errAnalisis } = await admin.rpc("analizar_tablas_conciliacion");
  if (errAnalisis) {
    console.error("[extracto] no se pudieron refrescar las estadísticas:", errAnalisis);
  }

  // La ficha de la carga (0051). Sin ella no hay forma de saber cuál es el
  // extracto vigente de una cuenta: `lote_id` es un uuid suelto y los lotes de
  // wizards abandonados se acumulan sin que nadie los borre.
  //
  // Si falla no se interrumpe nada: los movimientos están cargados y sirven
  // para conciliar, que es el camino principal. Lo que se pierde es el saldo
  // vivo, y decir «no se pudo importar» sobre 450.000 filas ya escritas sería
  // mentir sobre el estado.
  const { error: errFicha } = await admin.from("extractos_cargados").insert({
    lote_id,
    empresa_id: empresa.empresa_id,
    cuenta_id,
    fecha_min: fechaMin,
    fecha_max: fechaMax,
    filas: insertados,
    saldo_declarado: saldoFinal,
    origen,
    subido_por: (await getUsuarioActual())?.id ?? null,
  });
  if (errFicha) {
    console.error(`[extracto] no se pudo registrar la carga ${lote_id}:`, errFicha);
  }

  return NextResponse.json({
    ok: true,
    lote_id,
    insertados,
    invalidas,
    // Conteo y sumas REALES, no estimadas sobre una previsualización.
    saldo_final: saldoFinal,
    suma_montos: Number(sumaMontos.toFixed(2)),
    fuera_de_periodo: fueraDePeriodo,
    fecha_min: fechaMin,
    fecha_max: fechaMax,
  });
}
