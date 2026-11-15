import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { altaPorSso, type ProveedorSso } from "@/lib/sso";

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
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/dashboard";
  const destino = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  const fallo = (motivo: string) => {
    const login = url.clone();
    login.pathname = "/login";
    login.search = `?error=${encodeURIComponent(motivo)}`;
    return NextResponse.redirect(login);
  };

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

  const ir = url.clone();
  ir.pathname = destino;
  ir.search = "";
  return NextResponse.redirect(ir);
}
