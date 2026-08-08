import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Desglose por tipo de diferencia de los jobs cuyos pares viven en tabla.
 *
 * Devuelve `{ jobId: { categoria: n } }`, la MISMA forma que produce
 * `contarCategorias`, para que la pantalla no tenga que saber de dónde vino.
 *
 * ⚠️ Se cuenta en la base. Los pares de un job de modo tabla son hasta medio
 * millón y no están en `resultado.matches`: traerlos para contarlos en Node es
 * exactamente lo que la parte B vino a eliminar. Sin esto, el gráfico de tipos
 * de diferencia saldría vacío para esas conciliaciones.
 */
export async function conteoCategoriasDeJobs(
  jobIds: string[],
): Promise<Record<string, Record<string, number>>> {
  if (jobIds.length === 0) return {};
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("conteo_matches", {
    p_job_ids: jobIds,
  });
  if (error) {
    console.error("[reportes] no se pudo contar los pares en tabla:", error);
    return {};
  }
  const salida: Record<string, Record<string, number>> = {};
  for (const f of (data ?? []) as {
    job_id: string;
    categoria_diferencia: string | null;
    n: number | string;
  }[]) {
    // Mismo criterio que `contarCategorias`: sin categoría es "sin diferencia".
    const cat = f.categoria_diferencia ?? "sin_diferencia";
    salida[f.job_id] ??= {};
    salida[f.job_id]![cat] = (salida[f.job_id]![cat] ?? 0) + Number(f.n);
  }
  return salida;
}
