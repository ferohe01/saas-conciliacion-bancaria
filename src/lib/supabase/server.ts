import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Cliente Supabase para el SERVIDOR (RSC, route handlers, server actions).
 * Usa la key `anon` + la sesión del usuario vía cookies, de modo que las
 * consultas siguen sujetas a RLS y actúan en nombre del usuario autenticado.
 *
 * Para operaciones privilegiadas que deben saltar RLS (p. ej. escribir un job
 * como el sistema), usar `createAdminClient` en `./admin`.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` desde un Server Component: se ignora. El middleware
            // se encarga de refrescar la sesión.
          }
        },
      },
    },
  );
}
