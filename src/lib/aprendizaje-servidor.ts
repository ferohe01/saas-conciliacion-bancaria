import "server-only";
import { createClient } from "@/lib/supabase/server";
import { hidratarJobsModoTabla } from "@/lib/conciliacion/historico";
import {
  resumenAprendizaje,
  ejemplosActivos,
  type ResumenAprendizaje,
  type EjemploConOrigen,
  type JobHistorico,
} from "@/lib/aprendizaje";
import { normalizarCriterios } from "@/lib/criteriosIniciales";
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
  /** Criterio declarado por la empresa (arranque en frío). */
  criterios: string[];
  /** Los ejemplos exactos que se le envían a la IA, para poder curarlos. */
  ejemplos: EjemploConOrigen[];
};

export async function getDatosAprendizaje(): Promise<DatosAprendizaje> {
  const supabase = await createClient(); // RLS: solo la empresa del usuario
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select("id, created_at, payload_entrada, resultado, lote_extracto_id")
    .eq("estado", "completado")
    .not("resultado", "is", null)
    .order("created_at", { ascending: false })
    .limit(JOBS_METRICAS);

  // ⚠️ En modo tabla los pares no están en `resultado.matches`, así que sin
  // hidratar el pool saldría VACÍO justo en la empresa con medio millón de
  // partidas — la que más criterio tiene que enseñar. Solo se traen los pares
  // que revisó una persona: los `auto` no son ejemplo de nada.
  const jobs = (await hidratarJobsModoTabla(
    (data ?? []) as (JobMetrica & { lote_extracto_id?: string | null })[],
  )) as unknown as JobMetrica[];

  const { data: filaEmpresa } = await supabase
    .from("empresas")
    .select("criterios_conciliacion")
    .maybeSingle(); // RLS: solo la empresa del usuario

  return {
    criterios: normalizarCriterios(filaEmpresa?.criterios_conciliacion),
    // Mismos jobs y mismo criterio que el backend al armar el prompt: si la
    // pantalla listara otra cosa, se curarían ejemplos que la IA no lee.
    ejemplos: ejemplosActivos(
      jobs.slice(0, JOBS_POOL) as unknown as JobHistorico[],
    ),
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
