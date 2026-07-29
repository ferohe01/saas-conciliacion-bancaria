import "server-only";
import { createClient } from "@/lib/supabase/server";
import { tieneModulo, type ModuloId, type SuscripcionModulo } from "@/lib/modulos";

/**
 * Lectura de módulos contratados (solo servidor).
 *
 * `lib/modulos.ts` queda puro y sin dependencias para poder testearlo y usarlo
 * también en componentes cliente; aquí vive lo que toca la base.
 */

export async function getSuscripcionesModulo(): Promise<SuscripcionModulo[]> {
  const supabase = await createClient(); // RLS: solo la empresa del usuario
  const { data } = await supabase
    .from("suscripciones_modulo")
    .select("modulo, activo_hasta");
  return (data ?? []) as SuscripcionModulo[];
}

/**
 * Control de acceso a un módulo, para usar en server actions y route handlers.
 *
 * Es el punto donde el límite se hace cumplir. Ocultar un enlace en la
 * interfaz no es un control: el endpoint sigue estando ahí para quien lo
 * llame directo — la misma lección del período de prueba.
 *
 *     const permitido = await empresaTieneModulo("cobranzas");
 *     if (!permitido) return { ok: false, error: "Módulo no contratado." };
 */
export async function empresaTieneModulo(id: ModuloId): Promise<boolean> {
  return tieneModulo(id, await getSuscripcionesModulo());
}
