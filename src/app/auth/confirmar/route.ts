import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { origenPublico } from "@/lib/origenPublico";

/**
 * GET /auth/confirmar?token_hash=…&type=invite|magiclink&next=/bienvenida
 *
 * Valida en el SERVIDOR el enlace de invitación que genera /usuarios y deja la
 * sesión en las cookies (patrón `verifyOtp` de Supabase SSR). Validarlo aquí y
 * no en el navegador evita depender del flujo con tokens en el fragmento de la
 * URL, que el cliente SSR no recoge.
 */
const TIPOS: EmailOtpType[] = ["invite", "magiclink", "email"];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  // ⚠️ Las redirecciones van al host PÚBLICO: `nextUrl` lleva el del contenedor.
  const origen = origenPublico(request.headers, url.origin);
  const tokenHash = url.searchParams.get("token_hash");
  const tipo = url.searchParams.get("type") as EmailOtpType | null;
  // Solo rutas internas: un `next` absoluto convertiría el enlace en una
  // redirección abierta.
  const nextParam = url.searchParams.get("next") ?? "/dashboard";
  const destino = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  const fallo = (motivo: string) => {
    return NextResponse.redirect(`${origen}/login?error=${encodeURIComponent(motivo)}`);
  };

  if (!tokenHash || !tipo || !TIPOS.includes(tipo)) {
    return fallo("El enlace no es válido. Pide uno nuevo a tu administrador.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
  if (error) {
    return fallo("El enlace caducó o ya se usó. Pide uno nuevo a tu administrador.");
  }

  return NextResponse.redirect(`${origen}${destino}`);
}
