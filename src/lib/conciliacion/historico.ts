import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enLotes } from "@/lib/supabase/paginado";
import type { JobHistorico } from "@/lib/aprendizaje";

/**
 * Hidrata los jobs de MODO TABLA para que el aprendizaje y los reportes los
 * vean como siempre.
 *
 * ── El problema ────────────────────────────────────────────────────────────
 *
 * `construirEjemplos` y los reportes leen `job.resultado.matches` y resuelven
 * las partidas contra `job.payload_entrada`. En modo tabla los pares viven en
 * `matches_conciliacion` y ese array queda vacío, así que el pool de ejemplos
 * saldría vacío **justo en la empresa con medio millón de partidas** — la que
 * más criterio tiene que enseñar.
 *
 * ── Qué se trae ────────────────────────────────────────────────────────────
 *
 * Solo los pares con decisión humana. Los `auto` no son ejemplo de nada: nadie
 * los miró, y usarlos enseñaría a la IA un criterio que ninguna persona aplicó.
 * Es la misma razón por la que no entran en la tasa de acierto.
 *
 * Eso además hace el problema pequeño: los revisados son decenas o cientos,
 * aunque detrás haya 447.795 pares.
 *
 * ⚠️ Los ids son los UUID reales, y las partidas se reconstruyen con ESE mismo
 * id. `construirEjemplos` no distingue: solo necesita que el id del match
 * aparezca en las listas de partidas.
 */

type FilaRevisada = {
  job_id: string;
  comprobante_ids: string[];
  movimiento_ids: string[];
  metodo: string;
  estado_revision: string;
  confianza: number | null;
  categoria_diferencia: string | null;
  diferencia_monto: number | string | null;
  decisiones: unknown;
  excluido_aprendizaje: boolean;
};

type JobCrudo = {
  id: string;
  lote_extracto_id?: string | null;
  payload_entrada?: unknown;
  resultado?: unknown;
};

export async function hidratarJobsModoTabla<T extends JobCrudo>(
  jobs: T[],
): Promise<(T & JobHistorico)[]> {
  const deTabla = jobs.filter((j) => j.lote_extracto_id);
  if (deTabla.length === 0) return jobs as (T & JobHistorico)[];

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("matches_revisados", {
    p_job_ids: deTabla.map((j) => j.id),
  });
  if (error) {
    console.error("[historico] no se pudieron leer los pares revisados:", error);
    return jobs as (T & JobHistorico)[];
  }

  const revisados = (data ?? []) as FilaRevisada[];
  if (revisados.length === 0) return jobs as (T & JobHistorico)[];

  const idsComp = [...new Set(revisados.flatMap((m) => m.comprobante_ids))];
  const idsMov = [...new Set(revisados.flatMap((m) => m.movimiento_ids))];

  const comps = new Map<string, { id_interno: string; monto: number; contraparte: string | null; fecha: string }>();
  for (const lote of enLotes(idsComp)) {
    const { data: filas } = await admin
      .from("comprobantes")
      .select("id, fecha, monto, tipo, razon_social_contraparte")
      .in("id", lote);
    for (const c of filas ?? []) {
      const monto = Math.abs(Number(c.monto ?? 0));
      comps.set(c.id as string, {
        id_interno: c.id as string,
        monto: c.tipo === "pago" ? -monto : monto,
        contraparte: c.razon_social_contraparte as string | null,
        fecha: String(c.fecha),
      });
    }
  }

  const movs = new Map<string, { id_movimiento: string; monto: number; glosa: string | null; fecha: string }>();
  for (const lote of enLotes(idsMov)) {
    const { data: filas } = await admin
      .from("movimientos_extracto")
      .select("id, fecha, monto, glosa")
      .in("id", lote);
    for (const m of filas ?? []) {
      movs.set(m.id as string, {
        id_movimiento: m.id as string,
        monto: Number(m.monto ?? 0),
        glosa: m.glosa as string | null,
        fecha: String(m.fecha),
      });
    }
  }

  const porJob = new Map<string, FilaRevisada[]>();
  for (const m of revisados) {
    if (!porJob.has(m.job_id)) porJob.set(m.job_id, []);
    porJob.get(m.job_id)!.push(m);
  }

  return jobs.map((j) => {
    const suyos = porJob.get(j.id);
    if (!j.lote_extracto_id || !suyos) return j as T & JobHistorico;

    const usadosComp = [...new Set(suyos.flatMap((m) => m.comprobante_ids))];
    const usadosMov = [...new Set(suyos.flatMap((m) => m.movimiento_ids))];

    return {
      ...j,
      payload_entrada: {
        registros_internos: usadosComp
          .map((id) => comps.get(id))
          .filter((x): x is NonNullable<typeof x> => Boolean(x)),
        movimientos_bancarios: usadosMov
          .map((id) => movs.get(id))
          .filter((x): x is NonNullable<typeof x> => Boolean(x)),
      },
      resultado: {
        ...(typeof j.resultado === "object" && j.resultado !== null ? j.resultado : {}),
        matches: suyos.map((m) => ({
          ids_internos: m.comprobante_ids,
          ids_movimientos: m.movimiento_ids,
          metodo: m.metodo,
          estado_revision: m.estado_revision,
          confianza: m.confianza == null ? null : Number(m.confianza),
          categoria_diferencia: m.categoria_diferencia,
          diferencia_monto:
            m.diferencia_monto == null ? null : Number(m.diferencia_monto),
          decisiones: m.decisiones ?? [],
          excluido_aprendizaje: m.excluido_aprendizaje,
        })),
      },
    } as unknown as T & JobHistorico;
  });
}
