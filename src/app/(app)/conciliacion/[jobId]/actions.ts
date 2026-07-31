"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsuarioActual } from "@/lib/auth";
import {
  ResultadoConciliacion,
  type Match,
} from "@/lib/contract/resultado";
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
};

async function cargarContexto(jobId: string): Promise<Ctx | { error: string }> {
  const usuario = await getUsuarioActual();
  if (!usuario) return { error: "No autenticado." };

  const supabase = await createClient(); // RLS: solo jobs de su empresa
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select("resultado")
    .eq("id", jobId)
    .maybeSingle();

  if (!data?.resultado) return { error: "Conciliación no encontrada." };

  const parsed = ResultadoConciliacion.safeParse(data.resultado);
  if (!parsed.success) return { error: "Resultado con formato inesperado." };

  return { usuarioId: usuario.id, resultado: parsed.data };
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
  const [{ data: comps }, { data: otras }] = await Promise.all([
    admin.from("comprobantes").select("id, monto").in("id", ids as string[]),
    admin
      .from("aplicaciones_cobro")
      .select("comprobante_id, monto_aplicado")
      .in("comprobante_id", ids as string[])
      .neq("job_id", jobId),
  ]);

  const aplicadoPorOtros = new Map<string, number>();
  for (const a of otras ?? []) {
    const id = a.comprobante_id as string;
    aplicadoPorOtros.set(
      id,
      (aplicadoPorOtros.get(id) ?? 0) + Number(a.monto_aplicado ?? 0),
    );
  }

  for (const c of comps ?? []) {
    const id = c.id as string;
    const importe = Math.abs(Number(c.monto ?? 0));
    disponible.set(id, Math.max(0, importe - (aplicadoPorOtros.get(id) ?? 0)));
  }
  return disponible;
}

async function sincronizarCobranzas(
  jobId: string,
  resultado: ResultadoConciliacion,
) {
  try {
    const admin = createAdminClient();
    const { data: job } = await admin
      .from("jobs_conciliacion")
      .select("empresa_id, usuario_id, estado_contable, payload_entrada")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) return;

    // Mientras no rija, no mueve un céntimo. Y si dejó de regir, se retira.
    if (!afectaSaldo(job.estado_contable as EstadoContable)) {
      await admin.from("aplicaciones_cobro").delete().eq("job_id", jobId);
      return;
    }

    const payload = job.payload_entrada as {
      registros_internos?: RegistroPayload[];
      movimientos_bancarios?: MovimientoPayload[];
      config?: { tolerancia_monto_abs?: number; tolerancia_monto_pct?: number };
    } | null;
    if (!payload?.registros_internos) return;

    // Si ningún registro vino de la tabla de comprobantes (fuente Excel), no
    // hay nada que actualizar.
    if (!payload.registros_internos.some((r) => r.comprobante_id)) return;

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

    await admin.from("aplicaciones_cobro").delete().eq("job_id", jobId);
    if (aplicaciones.length > 0) {
      await admin.from("aplicaciones_cobro").insert(
        aplicaciones.map((a) => ({
          ...a,
          job_id: jobId,
          empresa_id: job.empresa_id,
          usuario_id: job.usuario_id,
        })),
      );
    }
  } catch (e) {
    console.error(
      `[cobranzas] no se pudo sincronizar el saldo de comprobantes del job ${jobId}:`,
      e,
    );
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
    if (!("error" in ctx)) await sincronizarCobranzas(jobId, ctx.resultado);

    revalidarConciliacion(jobId);
    return { ok: true, reemplazadas: Array.isArray(data) ? data.length : 0 };
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
    },
  ];

  return guardar(jobId, ctx.resultado);
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
      { usuario_id: ctx.usuarioId, accion, timestamp, nota: null },
    ];
    aplicadas++;
  }

  if (aplicadas === 0) {
    return { ok: false, error: "No se encontró ninguna de esas sugerencias." };
  }

  const res = await guardar(jobId, ctx.resultado);
  return res.ok ? { ok: true, aplicadas } : res;
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

  return guardar(jobId, ctx.resultado);
}
