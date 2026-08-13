import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerOrigen, type OrigenPartidas, type ResultadoMotor } from "./origenPartidas";

/**
 * Lectura y captura de la foto del origen de las partidas.
 *
 * Vive aparte de las funciones puras porque `server-only` impide siquiera
 * importar el módulo desde un test, y la cascada —que es donde puede estar el
 * error caro— sí tiene que poder probarse.
 */

/**
 * Cuenta de dónde salen las partidas del período, para congelarlo en el job.
 *
 * ⚠️ Va con `admin`: `origen_partidas` está concedida solo a `service_role`, y
 * acepta `p_empresa_id` porque la llama el backend con la empresa que ya
 * resolvió de la sesión. Las funciones que invoca el navegador nunca aceptan ese
 * parámetro (sería un `?empresa_id=` en manos de cualquiera).
 *
 * ⚠️ NUNCA lanza. Es una explicación, no un requisito: quedarse sin ella no
 * puede impedir una conciliación. Devuelve `null` y la pantalla lo dice.
 */
export async function capturarOrigenPartidas(
  admin: SupabaseClient,
  empresaId: string,
  desde: string,
  hasta: string,
  moneda: string | null,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.rpc("origen_partidas", {
    p_empresa_id: empresaId,
    p_desde: desde,
    p_hasta: hasta,
    p_moneda: moneda ?? "PEN",
  });
  if (error) {
    console.error("[conciliacion] no se pudo capturar el origen de partidas:", error);
    return null;
  }
  const fila = (data as Record<string, unknown>[] | null)?.[0];
  return fila ?? null;
}

/** El `resumen` de un job, en la forma que espera la cascada. */
export function motorDelResumen(resultado: unknown): ResultadoMotor | null {
  const r = (resultado as { resumen?: Record<string, unknown> } | null)?.resumen;
  if (!r) return null;
  const internos = Number(r.total_internos ?? 0);
  const sin = Number(r.sin_conciliar_internos ?? 0);
  if (!Number.isFinite(internos) || !Number.isFinite(sin)) return null;
  return { internos, conciliados: internos - sin };
}

/** La foto guardada en el job, ya normalizada. */
export function origenDelJob(fila: unknown): OrigenPartidas | null {
  return leerOrigen(fila as Record<string, unknown> | null);
}
