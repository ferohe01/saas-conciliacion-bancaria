import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resumenAprendizaje, type ResumenAprendizaje } from "@/lib/aprendizaje";

/**
 * Pool de aprendizaje de la empresa (solo servidor).
 *
 * La consulta estaba copiada en `/dashboard` y `/reportes`, y ahora la necesita
 * también `/aprendizaje`. Tres copias del mismo criterio es una invitación a que
 * se separen: el día que el backend cambie cuántos jobs mira al armar el
 * few-shot, las pantallas contarían una cosa distinta de la que ocurre.
 *
 * ⚠️ `LIMITE_JOBS` tiene que seguir al del backend (`iniciar/route.ts`). Es el
 * mismo número por una razón: lo que se enseña aquí es exactamente lo que
 * alimenta el prompt, no una aproximación.
 */
const LIMITE_JOBS = 30;

export async function getResumenAprendizaje(): Promise<ResumenAprendizaje> {
  const supabase = await createClient(); // RLS: solo la empresa del usuario
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select("resultado")
    .eq("estado", "completado")
    .not("resultado", "is", null)
    .order("created_at", { ascending: false })
    .limit(LIMITE_JOBS);

  return resumenAprendizaje(
    (data ?? []) as Parameters<typeof resumenAprendizaje>[0],
  );
}
