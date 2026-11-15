import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { origenPublico } from "@/lib/origenPublico";
import { createAdminClient } from "@/lib/supabase/admin";
import { SSO_ACTIVO, altaPorSso, type ProveedorSso } from "@/lib/sso";

/**
 * GET /auth/callback?code=…&next=/dashboard
 *
 * Vuelta del proveedor de identidad corporativo (SSO SAML, 0058). Canjea el
 * código por la sesión (PKCE, en el servidor) y se asegura de que la persona
 * pertenezca a una empresa:
 *
 *  - Ya es miembro → entra.
 *  - Primera vez por el SSO de su empresa → se le da de alta con el rol por
 *    defecto que eligió el administrador (`altaPorSso`).
 *  - Ninguna de las dos → se cierra la sesión y se dice por qué, en vez de
 *    dejarla en una aplicación vacía.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  // ⚠️ Las redirecciones van al host PÚBLICO: `nextUrl` lleva el del contenedor.
  const origen = origenPublico(request.headers, url.origin);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/dashboard";
  const destino = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  const fallo = (motivo: string) => {
    return NextResponse.redirect(`${origen}/login?error=${encodeURIComponent(motivo)}`);
  };

  // SSO implementado pero desactivado (SSO_ACTIVO, src/lib/sso.ts).
  if (!SSO_ACTIVO) return fallo("El acceso corporativo (SSO) no está activado. Entra con tu correo y contraseña.");
  if (!code) return fallo("No se pudo completar el acceso corporativo. Vuelve a intentarlo.");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return fallo("No se pudo completar el acceso corporativo. Vuelve a intentarlo.");
  }
  const user = data.user;
  const admin = createAdminClient();

  const { data: miembro } = await admin
    .from("usuarios_empresa")
    .select("empresa_id")
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (!miembro) {
    const { data: filas } = await admin
      .from("sso_proveedores")
      .select("empresa_id, provider_id, dominio, rol_por_defecto");
    const proveedores: ProveedorSso[] = (filas ?? []).map((f) => ({
      empresaId: f.empresa_id as string,
      providerId: f.provider_id as string,
      dominio: f.dominio as string,
      rolPorDefecto: f.rol_por_defecto as string,
    }));
    const alta = altaPorSso({
      email: user.email,
      proveedorDeLaSesion: (user.app_metadata?.provider as string | undefined) ?? null,
      proveedores,
    });
    if (!alta) {
      await supabase.auth.signOut();
      return fallo(
        "Tu cuenta no está vinculada a ninguna empresa en este sistema. Pídele a tu administrador que te invite.",
      );
    }
    const { error: errAlta } = await admin.from("usuarios_empresa").insert({
      usuario_id: user.id,
      empresa_id: alta.empresaId,
      rol: alta.rol,
      nombre_completo: (user.user_metadata?.full_name as string | undefined) ?? null,
    });
    if (errAlta) {
      console.error("[sso] no se pudo dar de alta al usuario:", errAlta);
      await supabase.auth.signOut();
      return fallo("No se pudo completar tu alta en la empresa. Vuelve a intentarlo.");
    }
  }

  return NextResponse.redirect(`${origen}${destino}`);
}
