import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase para el NAVEGADOR.
 * Usa exclusivamente la key `anon` (pública) — el acceso a datos queda
 * protegido por Row Level Security. Nunca usar aquí `service_role`.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
