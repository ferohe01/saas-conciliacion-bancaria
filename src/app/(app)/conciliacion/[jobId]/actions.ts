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
  revalidatePath(`/conciliacion/${jobId}`);
  return { ok: true };
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
