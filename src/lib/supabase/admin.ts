import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con `service_role` — SALTA RLS.
 *
 * ⚠️ Solo servidor. Nunca importar desde código de cliente ni exponer la key.
 * El import de "server-only" hace que el build falle si esto se filtra a un
 * bundle de cliente.
 *
 * Uso: escrituras del sistema que no actúan en nombre de un usuario concreto
 * (crear/actualizar jobs de conciliación, callbacks de n8n). Toda validación
 * de autorización debe hacerse ANTES de usar este cliente.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
