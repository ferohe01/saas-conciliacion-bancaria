import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** Prefijos de ruta que requieren sesión iniciada. */
const RUTAS_PROTEGIDAS = ["/dashboard", "/cuentas", "/wizard"];

/** Rutas públicas de autenticación (no redirigir si ya no hay sesión). */
const RUTAS_AUTH = ["/login", "/registro"];

function faltanCredencialesSupabase() {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Refresca la sesión de Supabase en cada request y aplica la protección de
 * rutas. Si aún no hay credenciales de Supabase (scaffold sin keys), no hace
 * nada para no romper el entorno de desarrollo.
 */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  if (faltanCredencialesSupabase()) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANTE: getUser() revalida el token contra Supabase (no confiar solo
  // en la cookie). No colocar lógica entre createServerClient y getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const esProtegida = RUTAS_PROTEGIDAS.some((p) => pathname.startsWith(p));
  const esAuth = RUTAS_AUTH.some((p) => pathname.startsWith(p));

  // Sin sesión en ruta protegida → a login.
  if (!user && esProtegida) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Con sesión en páginas de auth → al dashboard.
  if (user && esAuth) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
