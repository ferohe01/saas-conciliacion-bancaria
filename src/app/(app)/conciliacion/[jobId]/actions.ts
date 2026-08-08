"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo, enLotes } from "@/lib/supabase/paginado";
import { getUsuarioActual } from "@/lib/auth";
import {
  ResultadoConciliacion,
  type Match,
} from "@/lib/contract/resultado";
import { PayloadConciliacion } from "@/lib/contract/payload";
import { cargarVistaResultado } from "@/lib/conciliacion/vista";
import {
  calcularAplicaciones,
  type RegistroPayload,
  type MovimientoPayload,
} from "@/lib/cobranzas";
import {
  afectaSaldo,
  puedeAprobarse,
  puede,
  destino,
  type AccionContable,
  type EstadoContable,
} from "@/lib/cicloContable";

/**
 * Acciones de la revisión humana. Persisten CADA decisión dentro de
 * `jobs_conciliacion.resultado` (con usuario y timestamp): esta trazabilidad es
 * la materia prima del futuro ciclo de aprendizaje de la IA — no se pierde
 * ninguna.
 *
 * La lectura del job pasa por el cliente con RLS (garantiza pertenencia); la
 * escritura usa service_role (UPDATE no está permitido por RLS a usuarios).
 */

type Ctx = {
  usuarioId: string;
  resultado: ResultadoConciliacion;
  /**
   * Ids de `matches_conciliacion` alineados por índice con
   * `resultado.matches`, o `null` si los pares viven en el JSONB.
   *
   * ⚠️ Se cargan con la MISMA consulta que usa la pantalla
   * (`cargarVistaResultado`), y eso no es casual: los componentes identifican
   * un par por su POSICIÓN en el array, así que si las dos listas no salieran
   * en el mismo orden, aceptar el tercero de la pantalla modificaría otro.
   */
  idsTabla: string[] | null;
};

async function cargarContexto(jobId: string): Promise<Ctx | { error: string }> {
  const usuario = await getUsuarioActual();
  if (!usuario) return { error: "No autenticado." };

  const supabase = await createClient(); // RLS: solo jobs de su empresa
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select("resultado, payload_entrada, lote_extracto_id")
    .eq("id", jobId)
    .maybeSingle();

  if (!data?.resultado) return { error: "Conciliación no encontrada." };

  const parsed = ResultadoConciliacion.safeParse(data.resultado);
  if (!parsed.success) return { error: "Resultado con formato inesperado." };

  if (!data.lote_extracto_id) {
    return { usuarioId: usuario.id, resultado: parsed.data, idsTabla: null };
  }

  const payload = PayloadConciliacion.safeParse(data.payload_entrada);
  const vista = await cargarVistaResultado(
    jobId,
    parsed.data,
    payload.success ? payload.data : null,
  );
  return {
    usuarioId: usuario.id,
    resultado: vista.resultado,
    idsTabla: vista.idsMatches,
  };
}

/**
 * Persiste en `matches_conciliacion` los pares que cambiaron.
 *
 * Solo los tocados: la vista carga hasta mil y reescribirlos todos por una
 * aceptación sería mil escrituras para un clic.
 */
async function guardarEnTabla(
  jobId: string,
  ctx: Ctx,
  indices: number[],
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  for (const i of indices) {
    const m = ctx.resultado.matches[i];
    const id = ctx.idsTabla?.[i];
    if (!m || !id) continue;
    // ⚠️ Se comprueba el error: `supabase-js` lo devuelve, no lo lanza, y una
    // decisión que no se guarda es peor que una que falla a la vista.
    const { error } = await admin
      .from("matches_conciliacion")
      .update({
        estado_revision: m.estado_revision,
        decisiones: m.decisiones ?? [],
        excluido_aprendizaje: m.excluido_aprendizaje ?? false,
      })
      .eq("id", id);
    if (error) {
      console.error(`[decision] no se pudo guardar el par ${id}:`, error);
      return { ok: false, error: "No se pudo guardar la decisión." };
    }
  }
  await sincronizarCobranzas(jobId, ctx.resultado);
  revalidatePath(`/conciliacion/${jobId}`);
  return { ok: true };
}

/** Guarda por el camino que corresponda: tabla o JSONB. */
async function persistir(
  jobId: string,
  ctx: Ctx,
  indices: number[],
): Promise<{ ok: boolean; error?: string }> {
  return ctx.idsTabla
    ? guardarEnTabla(jobId, ctx, indices)
    : guardar(jobId, ctx.resultado);
}

async function guardar(jobId: string, resultado: ResultadoConciliacion) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("jobs_conciliacion")
    .update({ resultado })
    .eq("id", jobId);
  if (error) return { ok: false, error: "No se pudo guardar la decisión." };

  await sincronizarCobranzas(jobId, resultado);
  revalidatePath(`/conciliacion/${jobId}`);
  return { ok: true };
}

/**
 * Refleja en el saldo de los comprobantes las decisiones de la conciliación
 * APROBADA.
 *
 * ⚠️ Solo la aprobada mueve saldo (ver `src/lib/cicloContable.ts`). Antes se
 * escribían las aplicaciones al confirmar decisiones, sin mirar el estado
 * contable: dos corridas del mismo período con decisiones confirmadas
 * descontaban el saldo del mismo comprobante dos veces, porque `job_id` forma
 * parte de la clave única de `aplicaciones_cobro`. Con el saldo atado a la
 * aprobación, el constraint de exclusión de la 0012 —que impide dos aprobadas
 * solapadas— vuelve el doble descuento imposible por construcción.
 *
 * Se REEMPLAZA el conjunto completo de aplicaciones del job en vez de ir
 * añadiendo: así el estado siempre corresponde a las decisiones actuales, y
 * deshacer una aceptación devuelve el saldo solo. Ir sumando obligaría a
 * rastrear cada cambio y acabaría desincronizado.
 *
 * El saldo lo recalcula un trigger en la base (migración 0008), no este código:
 * cualquier otro camino que escriba aplicaciones queda igual de correcto.
 *
 * Un fallo aquí NO tumba la decisión humana, que ya está guardada y es lo
 * irreemplazable; se registra para poder reconstruirlo.
 */
/**
 * Reparto de cobros cuando los pares viven en `matches_conciliacion`.
 *
 * Tres pasos, y el orden importa: primero se retira lo que dejó de estar
 * confirmado (si no, un rechazo seguiría descontando saldo), y después se
 * escribe lo que falta.
 *
 * ⚠️ **Por lotes, obligatoriamente.** Escribir las 447.795 de una vez tarda
 * 2 min 24 s —cada fila dispara el trigger que recalcula el saldo— y el
 * `statement_timeout` con el que PostgREST ejecuta es de **8 segundos**: la
 * llamada entera se cancelaría y no se escribiría nada. Lotes de 5.000 van a
 * ~2,7 s y no se degradan.
 *
 * ⚠️ El residuo (pagos parciales, agrupaciones 1:N, comisiones absorbidas) NO
 * pasa por aquí: esa aritmética decide cuánto dinero se le descuenta a quién y
 * vive en `src/lib/cobranzas.ts`, que es puro y tiene tests. Son unos miles de
 * pares, así que no hay razón de rendimiento para duplicarla en SQL — y sí una
 * muy buena para no hacerlo.
 */
const LOTE_COBROS = 5000;
/** Techo de seguridad: 450.000 pares son 90 vueltas. Si se pasa de esto, algo
 *  va mal y es mejor parar que girar para siempre. */
const MAX_VUELTAS_COBROS = 500;

async function aplicarCobrosModoTabla(
  jobId: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<SincronizacionCobros> {
  const limpieza = await admin.rpc("limpiar_cobros_desconfirmados", {
    p_job_id: jobId,
  });
  if (limpieza.error) {
    console.error(`[cobranzas] no se pudo limpiar ${jobId}:`, limpieza.error);
    return { ok: false, aplicadas: 0 };
  }

  let aplicadas = 0;
  for (let vuelta = 0; vuelta < MAX_VUELTAS_COBROS; vuelta++) {
    const { data, error } = await admin.rpc("aplicar_cobros_exactos", {
      p_job_id: jobId,
      p_limite: LOTE_COBROS,
    });
    if (error) {
      console.error(`[cobranzas] fallo aplicando cobros de ${jobId}:`, error);
      // Se devuelve lo que SÍ entró: el saldo queda a medias y quien llama
      // tiene que poder decirlo en vez de dar el cobro por hecho.
      return { ok: false, aplicadas };
    }
    const n = Number(data ?? 0);
    if (n === 0) return { ok: true, aplicadas };
    aplicadas += n;
  }
  console.error(`[cobranzas] ${jobId} no terminó de aplicar en ${MAX_VUELTAS_COBROS} vueltas`);
  return { ok: false, aplicadas };
}

/**
 * Cuánto le queda por cobrar a cada comprobante del payload, descontando lo que
 * han aplicado OTROS jobs y no este.
 *
 * Se calcula sobre el importe del comprobante y no sobre su columna `saldo`
 * porque el saldo ya incluye las aplicaciones de este mismo job, que están a
 * punto de borrarse y rehacerse.
 */
async function disponiblePorComprobante(
  jobId: string,
  registros: RegistroPayload[],
): Promise<Map<string, number>> {
  const ids = [...new Set(registros.map((r) => r.comprobante_id).filter(Boolean))];
  const disponible = new Map<string, number>();
  if (ids.length === 0) return disponible;

  const admin = createAdminClient();

  // ⚠️ Troceado + paginado. Con una conciliación de 20.000 registros, un
  // `.in()` con 20.000 ids revienta por longitud de URL, y aunque pasara,
  // PostgREST devolvería 1.000 filas y un 200 OK. Quedarse corto AQUÍ no es
  // cosmético: los saldos de los comprobantes se calcularían sobre datos
  // incompletos y quedarían mal escritos en la base.
  const comps: { id: string; monto: number }[] = [];
  const otras: { comprobante_id: string; monto_aplicado: number }[] = [];
  const revertidas: { comprobante_id: string; monto_revertido: number }[] = [];

  for (const lote of enLotes(ids as string[])) {
    const [c, o, r] = await Promise.all([
      traerTodo<{ id: string; monto: number }>((d, h) =>
        admin.from("comprobantes").select("id, monto").in("id", lote)
          .order("id", { ascending: true }).range(d, h),
      ),
      traerTodo<{ comprobante_id: string; monto_aplicado: number }>((d, h) =>
        admin
          .from("aplicaciones_cobro")
          .select("comprobante_id, monto_aplicado")
          .in("comprobante_id", lote)
          .neq("job_id", jobId)
          .order("id", { ascending: true })
          .range(d, h),
      ),
      // Un cobro que el banco revirtió deja de ocupar sitio: la factura vuelve
      // a estar disponible y puede cobrarse de nuevo. Sin esto, revertir la
      // dejaría con saldo pero incobrable.
      traerTodo<{ comprobante_id: string; monto_revertido: number }>((d, h) =>
        admin
          .from("reversiones_cobro")
          .select("comprobante_id, monto_revertido")
          .in("comprobante_id", lote)
          .neq("job_id", jobId)
          .order("id", { ascending: true })
          .range(d, h),
      ),
    ]);
    comps.push(...c); otras.push(...o); revertidas.push(...r);
  }

  const netoPorOtros = new Map<string, number>();
  for (const a of otras ?? []) {
    const id = a.comprobante_id as string;
    netoPorOtros.set(id, (netoPorOtros.get(id) ?? 0) + Number(a.monto_aplicado ?? 0));
  }
  for (const r of revertidas ?? []) {
    const id = r.comprobante_id as string;
    netoPorOtros.set(id, (netoPorOtros.get(id) ?? 0) - Number(r.monto_revertido ?? 0));
  }

  for (const c of comps ?? []) {
    const id = c.id as string;
    const importe = Math.abs(Number(c.monto ?? 0));
    disponible.set(id, Math.max(0, importe - (netoPorOtros.get(id) ?? 0)));
  }
  return disponible;
}

/** Qué pudo aplicarse de verdad. `ok:false` = el saldo NO refleja el resultado. */
type SincronizacionCobros = { ok: boolean; aplicadas: number };

async function sincronizarCobranzas(
  jobId: string,
  resultado: ResultadoConciliacion,
): Promise<SincronizacionCobros> {
  try {
    const admin = createAdminClient();
    const { data: job } = await admin
      .from("jobs_conciliacion")
      .select("empresa_id, usuario_id, estado_contable, payload_entrada, lote_extracto_id")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) return { ok: false, aplicadas: 0 };

    // Mientras no rija, no mueve un céntimo. Y si dejó de regir, se retira.
    if (!afectaSaldo(job.estado_contable as EstadoContable)) {
      const { error } = await admin
        .from("aplicaciones_cobro")
        .delete()
        .eq("job_id", jobId);
      // Si el borrado falla, un documento que YA no rige se queda descontando
      // saldo. Callarlo dejaría comprobantes cobrados por una conciliación
      // anulada, que es justo lo que este camino existe para impedir.
      if (error) {
        console.error(`[cobranzas] no se pudo retirar el saldo de ${jobId}:`, error);
        return { ok: false, aplicadas: 0 };
      }
      // Retirar el saldo cuando el documento deja de regir ES el resultado
      // correcto, no un fallo: cero aplicaciones es exactamente lo que toca.
      return { ok: true, aplicadas: 0 };
    }

    // ── Modo tabla: el reparto lo hace Postgres ─────────────────────────────
    //
    // No se puede pasar por el camino de abajo: ese REEMPLAZA el conjunto
    // completo de aplicaciones a partir de `resultado.matches`, y en modo tabla
    // ese array es una página de mil pares, no la conciliación entera. Rehacer
    // con eso borraría las de los otros 446.795.
    //
    // Aquí se toca solo lo que cambió y las exactas las escribe la base:
    // 447.795 aplicaciones desde Node serían ~900 peticiones y un cuarto de
    // hora; en SQL son lotes de 5.000 a ~2,7 s.
    if (job.lote_extracto_id) {
      return aplicarCobrosModoTabla(jobId, admin);
    }

    const payload = job.payload_entrada as {
      registros_internos?: RegistroPayload[];
      movimientos_bancarios?: MovimientoPayload[];
      config?: { tolerancia_monto_abs?: number; tolerancia_monto_pct?: number };
    } | null;
    if (!payload?.registros_internos) return { ok: false, aplicadas: 0 };

    // Si ningún registro vino de la tabla de comprobantes (fuente Excel), no
    // hay nada que actualizar.
    if (!payload.registros_internos.some((r) => r.comprobante_id)) {
      return { ok: true, aplicadas: 0 };
    }

    // Cuánto le queda por cobrar a cada comprobante, SIN contar lo que aplicó
    // este mismo job: sus aplicaciones se borran y se rehacen unas líneas más
    // abajo, así que contarlas dejaría la segunda pasada sin nada que aplicar.
    const disponible = await disponiblePorComprobante(
      jobId,
      payload.registros_internos,
    );

    // Las tolerancias van con el job, no las actuales de la empresa: si mañana
    // las cambian, lo ya conciliado no debe reinterpretarse solo.
    const aplicaciones = calcularAplicaciones(
      resultado.matches,
      payload.registros_internos,
      payload.movimientos_bancarios ?? [],
      payload.config ?? {},
      disponible,
    );

    const { error: errBorrado } = await admin
      .from("aplicaciones_cobro")
      .delete()
      .eq("job_id", jobId);
    if (errBorrado) {
      console.error(`[cobranzas] no se pudieron borrar las aplicaciones de ${jobId}:`, errBorrado);
      return { ok: false, aplicadas: 0 };
    }

    // ⚠️ POR LOTES, y comprobando el error de cada uno.
    //
    // Aquí había dos fallos que se tapaban entre sí. El INSERT iba en UNA sola
    // llamada con todas las aplicaciones —32.170 filas con el corte de 36.377
    // partidas— y Postgres lo canceló:
    //
    //     {"code":"57014","message":"canceling statement due to statement timeout"}
    //     POST /aplicaciones_cobro ... 500
    //
    // El rol `authenticator`, con el que se conecta PostgREST, lleva
    // **`statement_timeout=8s`**. Cada fila dispara además el trigger que
    // recalcula el saldo del comprobante (0008), así que el coste crece con las
    // filas y 32.170 no caben ni de lejos en 8 segundos.
    //
    // Y el resultado del insert **no se miraba**: supabase-js DEVUELVE el error,
    // no lo lanza, así que el `catch` no se enteraba. La aprobación seguía y la
    // pantalla anunciaba "ya descuenta el saldo de tus comprobantes" con cero
    // filas escritas — el peor desenlace posible aquí: una conciliación
    // aprobada que dice haber cobrado y no cobró nada, sin un error a la vista.
    //
    // 500 por lote: al ritmo medido son décimas de segundo, muy por debajo de
    // los 8 s. Subirlo acerca al límite; bajarlo multiplica los viajes.
    let aplicadas = 0;
    for (const lote of enLotes(aplicaciones, 500)) {
      const { error } = await admin.from("aplicaciones_cobro").insert(
        lote.map((a) => ({
          ...a,
          job_id: jobId,
          empresa_id: job.empresa_id,
          usuario_id: job.usuario_id,
        })),
      );
      if (error) {
        console.error(`[cobranzas] fallo al aplicar cobros de ${jobId}:`, error);
        // Se devuelve lo que sí entró: el saldo queda a medias, y quien llama
        // tiene que poder decirlo en vez de dar el cobro por hecho.
        return { ok: false, aplicadas };
      }
      aplicadas += lote.length;
    }
    return { ok: true, aplicadas };
  } catch (e) {
    console.error(
      `[cobranzas] no se pudo sincronizar el saldo de comprobantes del job ${jobId}:`,
      e,
    );
    return { ok: false, aplicadas: 0 };
  }
}

/* ------------------------------------------------------------------------- *
 * Ciclo de vida contable
 * ------------------------------------------------------------------------- */

const AccionContableSchema = z.enum(["aprobar", "observar", "anular", "reabrir"]);

type ResultadoAccion = {
  ok: boolean;
  error?: string;
  reemplazadas?: number;
  /** Cobros que llegaron a escribirse al aprobar. */
  cobrosAplicados?: number;
  /** El saldo NO refleja el resultado: hay que decirlo, no dar por hecho el cobro. */
  cobrosIncompletos?: boolean;
};

/**
 * Aprueba, observa, anula o reabre una conciliación.
 *
 * La transición ocurre dentro de una función de la base (`0013`), no aquí:
 * aprobar implica degradar a `reemplazada` las aprobadas que se solapen y
 * borrar sus aplicaciones de cobro, y hacerlo con escrituras sueltas dejaría
 * una ventana en la que el período no tiene conciliación vigente.
 */
export async function cambiarEstadoContable(
  jobId: string,
  accion: AccionContable,
): Promise<ResultadoAccion> {
  const parsed = AccionContableSchema.safeParse(accion);
  if (!parsed.success) return { ok: false, error: "Acción inválida." };

  const usuario = await getUsuarioActual();
  if (!usuario) return { ok: false, error: "No autenticado." };

  // Lectura con RLS: garantiza que el job es de su empresa.
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs_conciliacion")
    .select("id, estado, estado_contable")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { ok: false, error: "Conciliación no encontrada." };

  const estadoContable = job.estado_contable as EstadoContable;
  const admin = createAdminClient();

  if (parsed.data === "aprobar") {
    const permiso = puedeAprobarse(estadoContable, job.estado as string);
    if (!permiso.ok) return { ok: false, error: permiso.motivo };

    const { data, error } = await admin.rpc("aprobar_conciliacion", {
      p_job_id: jobId,
      p_usuario: usuario.id,
    });
    if (error) {
      console.error(`[ciclo] no se pudo aprobar ${jobId}:`, error);
      return {
        ok: false,
        error:
          "No se pudo aprobar la conciliación. Revisa que no haya otra aprobada del mismo período.",
      };
    }

    // Recién ahora rige, así que recién ahora mueve saldo.
    const ctx = await cargarContexto(jobId);
    const cobros = "error" in ctx
      ? { ok: false, aplicadas: 0 }
      : await sincronizarCobranzas(jobId, ctx.resultado);

    revalidarConciliacion(jobId);

    // ⚠️ La aprobación SÍ se hizo; lo que pudo fallar es el reparto del saldo.
    // Decirlo importa: la pantalla anunciaba "ya descuenta el saldo de tus
    // comprobantes" pasara lo que pasara, y con 32.170 filas que no se
    // escribieron eso era una afirmación falsa sobre dinero. Mejor una
    // advertencia fea que un éxito que no ocurrió.
    return {
      ok: true,
      reemplazadas: Array.isArray(data) ? data.length : 0,
      cobrosAplicados: cobros.aplicadas,
      cobrosIncompletos: !cobros.ok,
    };
  }

  if (!puede(estadoContable, parsed.data)) {
    return {
      ok: false,
      error: "Esa acción no es posible con el estado actual de la conciliación.",
    };
  }

  const { error } = await admin.rpc("cambiar_estado_contable", {
    p_job_id: jobId,
    p_estado: destino(parsed.data),
    p_usuario: usuario.id,
  });
  if (error) {
    console.error(`[ciclo] no se pudo cambiar el estado de ${jobId}:`, error);
    return { ok: false, error: "No se pudo cambiar el estado de la conciliación." };
  }

  revalidarConciliacion(jobId);
  return { ok: true };
}

/**
 * Aprobar o anular cambia el saldo de los comprobantes, así que hay que
 * refrescar también las pantallas que lo muestran, no solo la del job.
 */
function revalidarConciliacion(jobId: string) {
  revalidatePath(`/conciliacion/${jobId}`);
  revalidatePath("/conciliacion");
  revalidatePath("/dashboard");
  revalidatePath("/cobranzas");
  revalidatePath("/comprobantes");
}

const AccionSchema = z.enum(["aceptado", "rechazado", "modificado"]);

/** Registra una decisión humana sobre un match (por su índice). */
export async function registrarDecision(
  jobId: string,
  matchIndex: number,
  accion: z.infer<typeof AccionSchema>,
  nota?: string,
  motivo?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!AccionSchema.safeParse(accion).success) {
    return { ok: false, error: "Acción inválida." };
  }
  const ctx = await cargarContexto(jobId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const match = ctx.resultado.matches[matchIndex];
  if (!match) return { ok: false, error: "Match no encontrado." };

  match.estado_revision = accion;
  match.decisiones = [
    ...(match.decisiones ?? []),
    {
      usuario_id: ctx.usuarioId,
      accion,
      timestamp: new Date().toISOString(),
      nota: nota ?? null,
      // Solo tiene sentido en un rechazo: "por que aceptaste" no es una
      // pregunta que nadie se haga al revisar.
      motivo: accion === "rechazado" ? (motivo ?? null) : null,
    },
  ];

  return persistir(jobId, ctx, [matchIndex]);
}

/**
 * Registra la MISMA decisión sobre varios matches en una sola escritura.
 *
 * A 500–2000+ partidas la revisión es triaje y se despacha en lote: hacerlo con
 * `registrarDecision` sería una lectura + escritura + revalidate por match.
 * Cada decisión se persiste igual, una por una, dentro del mismo `resultado`.
 */
export async function registrarDecisiones(
  jobId: string,
  matchIndices: number[],
  accion: z.infer<typeof AccionSchema>,
  motivo?: string,
): Promise<{ ok: boolean; error?: string; aplicadas?: number }> {
  if (!AccionSchema.safeParse(accion).success) {
    return { ok: false, error: "Acción inválida." };
  }
  if (matchIndices.length === 0) {
    return { ok: false, error: "No hay sugerencias seleccionadas." };
  }
  const ctx = await cargarContexto(jobId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const timestamp = new Date().toISOString();
  let aplicadas = 0;
  for (const idx of matchIndices) {
    const match = ctx.resultado.matches[idx];
    if (!match) continue;
    match.estado_revision = accion;
    match.decisiones = [
      ...(match.decisiones ?? []),
      {
        usuario_id: ctx.usuarioId,
        accion,
        timestamp,
        nota: null,
        motivo: accion === "rechazado" ? (motivo ?? null) : null,
      },
    ];
    aplicadas++;
  }

  if (aplicadas === 0) {
    return { ok: false, error: "No se encontró ninguna de esas sugerencias." };
  }

  const res = await persistir(jobId, ctx, matchIndices);
  return res.ok ? { ok: true, aplicadas } : res;
}

/**
 * Devuelve un match a la cola de revisión.
 *
 * Hasta ahora una decisión era IRREVERSIBLE desde la interfaz: aceptada o
 * rechazada, el par caía en una tabla de solo lectura y no había forma de
 * corregirse. Y aquí una decisión no es un clic cualquiera — al aprobar mueve
 * el saldo del comprobante y encima **le enseña el criterio a la IA**, así que
 * un error de clic se propaga a las siguientes conciliaciones.
 *
 * La reapertura QUEDA REGISTRADA como una decisión más (`accion: "pendiente"`)
 * en vez de borrar la anterior: el historial es materia prima del aprendizaje y
 * no se reescribe. Efecto secundario deseado: como la última acción pasa a ser
 * "pendiente", `claseDeMatch` deja de contarla como ejemplo — un par reabierto
 * no enseña nada hasta que alguien vuelva a decidir.
 *
 * `guardar` resincroniza cobranzas, así que el saldo del comprobante vuelve
 * solo si el par ya no cuenta como confirmado.
 */
export async function reabrirDecision(
  jobId: string,
  matchIndex: number,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await cargarContexto(jobId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const match = ctx.resultado.matches[matchIndex];
  if (!match) return { ok: false, error: "Match no encontrado." };
  if (match.estado_revision === "pendiente") return { ok: true };

  match.estado_revision = "pendiente";
  match.decisiones = [
    ...(match.decisiones ?? []),
    {
      usuario_id: ctx.usuarioId,
      accion: "pendiente",
      timestamp: new Date().toISOString(),
      nota: "Devuelto a revisión",
      motivo: null,
    },
  ];

  return persistir(jobId, ctx, [matchIndex]);
}

const ManualSchema = z.object({
  ids_internos: z.array(z.string().min(1)).min(1),
  ids_movimientos: z.array(z.string().min(1)).min(1),
  diferencia_monto: z.number().finite().nullable().optional(),
  categoria_diferencia: z.string().nullable().optional(),
});

/** Crea un match manual y saca esas partidas de no_conciliados. */
export async function conciliarManual(
  jobId: string,
  entrada: z.infer<typeof ManualSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = ManualSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const ctx = await cargarContexto(jobId);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const { ids_internos, ids_movimientos, diferencia_monto, categoria_diferencia } =
    parsed.data;

  const nuevo: Match = {
    ids_internos,
    ids_movimientos,
    metodo: "manual",
    confianza: null,
    diferencia_monto: diferencia_monto ?? null,
    categoria_diferencia: categoria_diferencia ?? null,
    justificacion: "Conciliación manual del usuario.",
    estado_revision: "modificado",
    decisiones: [
      {
        usuario_id: ctx.usuarioId,
        accion: "modificado",
        timestamp: new Date().toISOString(),
        nota: null,
      },
    ],
  };
  ctx.resultado.matches.push(nuevo);

  // Sacar de no_conciliados las partidas ahora conciliadas.
  const internosSet = new Set(ids_internos);
  const movsSet = new Set(ids_movimientos);
  ctx.resultado.no_conciliados = ctx.resultado.no_conciliados.filter((p) =>
    p.lado === "interno" ? !internosSet.has(p.id) : !movsSet.has(p.id),
  );

  // Recalcular contadores de sin conciliar.
  ctx.resultado.resumen.sin_conciliar_internos =
    ctx.resultado.no_conciliados.filter((p) => p.lado === "interno").length;
  ctx.resultado.resumen.sin_conciliar_bancarios =
    ctx.resultado.no_conciliados.filter((p) => p.lado === "bancario").length;

  // ⚠️ Un match MANUAL es una fila nueva, no una modificación: en modo tabla
  // hay que insertarla, porque `persistir` solo sabe actualizar las que ya
  // existen. Sin esto, conciliar a mano no dejaría rastro.
  if (ctx.idsTabla) {
    const admin = createAdminClient();
    const { data: job } = await admin
      .from("jobs_conciliacion")
      .select("empresa_id")
      .eq("id", jobId)
      .maybeSingle();
    const { error } = await admin.from("matches_conciliacion").insert({
      job_id: jobId,
      empresa_id: job?.empresa_id,
      comprobante_ids: ids_internos,
      movimiento_ids: ids_movimientos,
      metodo: "manual",
      estado_revision: "aceptado",
      decisiones: nuevo.decisiones ?? [],
    });
    if (error) {
      console.error(`[manual] no se pudo guardar el par de ${jobId}:`, error);
      return { ok: false, error: "No se pudo guardar la conciliación manual." };
    }
    revalidatePath(`/conciliacion/${jobId}`);
    return { ok: true };
  }

  return guardar(jobId, ctx.resultado);
}

/** Lo que una aprobación se llevaría por delante. */
export type ImpactoAprobar = {
  /** Conciliaciones aprobadas que se degradarían a `reemplazada`. */
  reemplaza: { id: string; desde: string; hasta: string; version: number }[];
  /** Cobros que se borrarían: su saldo vuelve a quedar pendiente. */
  aplicaciones: number;
};

/**
 * Qué pasaría si se aprueba esta conciliación, ANTES de aprobarla.
 *
 * Aprobar no falla nunca por solapamiento: `aprobar_conciliacion` degrada a
 * `reemplazada` las aprobadas que se crucen y borra sus aplicaciones de cobro.
 * Eso es correcto —dos conciliaciones vigentes sobre el mismo día contarían el
 * saldo dos veces— pero era **invisible hasta después de hacerlo**: la pantalla
 * lo contaba en el mensaje de éxito, cuando ya no había vuelta atrás y el
 * estado `reemplazada` es terminal.
 *
 * Duele especialmente al cruzar granularidades: aprobar el corte de un día
 * sobre un mes ya aprobado deja sin cobros los otros 29 días de golpe.
 *
 * ⚠️ Reproduce el MISMO criterio de solape que la función de la base
 * (`daterange(desde, hasta, '[]') &&`, ambos extremos incluidos). Si los dos
 * dejaran de coincidir, el aviso mentiría — que es peor que no avisar.
 */
export async function impactoDeAprobar(
  jobId: string,
): Promise<ImpactoAprobar> {
  const vacio: ImpactoAprobar = { reemplaza: [], aplicaciones: 0 };
  const usuario = await getUsuarioActual();
  if (!usuario) return vacio;

  // RLS: solo ve los jobs de su empresa.
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs_conciliacion")
    .select("id, cuenta_id, periodo_desde, periodo_hasta")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return vacio;

  const { data: solapadas } = await supabase
    .from("jobs_conciliacion")
    .select("id, periodo_desde, periodo_hasta, version")
    .eq("cuenta_id", job.cuenta_id)
    .eq("estado_contable", "aprobada")
    .neq("id", jobId)
    // Dos rangos cerrados se cruzan si cada uno empieza antes de que el otro
    // acabe. Es la misma condición que el `&&` de la base, escrita en filtros.
    .lte("periodo_desde", job.periodo_hasta)
    .gte("periodo_hasta", job.periodo_desde);

  const reemplaza = (solapadas ?? []).map((j) => ({
    id: j.id as string,
    desde: j.periodo_desde as string,
    hasta: j.periodo_hasta as string,
    version: Number(j.version ?? 1),
  }));
  if (reemplaza.length === 0) return vacio;

  const { count } = await supabase
    .from("aplicaciones_cobro")
    .select("id", { count: "exact", head: true })
    .in(
      "job_id",
      reemplaza.map((r) => r.id),
    );

  return { reemplaza, aplicaciones: count ?? 0 };
}
