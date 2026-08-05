import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resumenAprendizaje, type ResumenAprendizaje } from "@/lib/aprendizaje";
import {
  metricasAprendizaje,
  type MetricasAprendizaje,
  type JobMetrica,
} from "@/lib/aprendizajeMetricas";

/**
 * Datos del módulo de Aprendizaje (solo servidor).
 *
 * La consulta estaba copiada en `/dashboard` y `/reportes`. Tres copias del
 * mismo criterio es una invitación a que se separen: el día que el backend
 * cambie cuántos jobs mira al armar el few-shot, las pantallas contarían una
 * cosa distinta de la que ocurre.
 *
 * Una sola consulta alimenta dos cosas distintas a propósito:
 *
 *   - **El pool** (`resumen`): los ⚠️ `JOBS_POOL` más recientes, que tiene que
 *     seguir al límite del backend (`iniciar/route.ts`). Lo que la pantalla
 *     enseña es exactamente lo que alimenta el prompt, no una aproximación.
 *   - **La curva** (`metricas`): historial más largo, porque una tendencia
 *     necesita más puntos que un prompt.
 */
const JOBS_POOL = 30;
const JOBS_METRICAS = 100;

export type DatosAprendizaje = {
  resumen: ResumenAprendizaje;
  metricas: MetricasAprendizaje;
};

export async function getDatosAprendizaje(): Promise<DatosAprendizaje> {
  const supabase = await createClient(); // RLS: solo la empresa del usuario
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select("id, created_at, resultado")
    .eq("estado", "completado")
    .not("resultado", "is", null)
    .order("created_at", { ascending: false })
    .limit(JOBS_METRICAS);

  const jobs = (data ?? []) as JobMetrica[];

  return {
    resumen: resumenAprendizaje(
      jobs.slice(0, JOBS_POOL) as Parameters<typeof resumenAprendizaje>[0],
    ),
    // La curva se lee de izquierda a derecha en el tiempo: hay que invertir el
    // orden de la consulta, que viene del más reciente al más antiguo.
    metricas: metricasAprendizaje([...jobs].reverse()),
  };
}

/** Solo el pool, para el gancho del panel de control. */
export async function getResumenAprendizaje(): Promise<ResumenAprendizaje> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select("resultado")
    .eq("estado", "completado")
    .not("resultado", "is", null)
    .order("created_at", { ascending: false })
    .limit(JOBS_POOL);

  return resumenAprendizaje(
    (data ?? []) as Parameters<typeof resumenAprendizaje>[0],
  );
}
