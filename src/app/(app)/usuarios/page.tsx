import { createAdminClient } from "@/lib/supabase/admin";
import { exigir } from "@/lib/roles-servidor";
import { rolDe } from "@/lib/roles";
import { EncabezadoPagina, Tarjeta } from "@/components/ui";
import { UsuariosPanel, type Miembro } from "@/components/app/UsuariosPanel";

/**
 * /usuarios — quién trabaja en la empresa y con qué rol (0057).
 *
 * Solo el administrador. Se lee con `service_role` y filtro explícito de
 * empresa: la política de `usuarios_empresa` solo deja ver la fila propia, y
 * los correos viven en `auth.users`, que la key pública no puede leer.
 */
export default async function UsuariosPage() {
  const acceso = await exigir("gestionar_usuarios");
  if (!acceso.ok) {
    return (
      <div className="space-y-6">
        <EncabezadoPagina titulo="Usuarios" />
        <Tarjeta tono="atencion">
          <p className="text-sm text-amber-900">{acceso.error}</p>
        </Tarjeta>
      </div>
    );
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("usuarios_empresa")
    .select("usuario_id, rol, nombre_completo, created_at")
    .eq("empresa_id", acceso.empresa.empresa_id)
    .order("created_at", { ascending: true });

  // Pocas personas por empresa: un `getUserById` por miembro es lo simple.
  const miembros: Miembro[] = await Promise.all(
    (data ?? []).map(async (m) => {
      const { data: u } = await admin.auth.admin.getUserById(m.usuario_id as string);
      return {
        usuarioId: m.usuario_id as string,
        email: u.user?.email ?? "(sin correo)",
        nombre: (m.nombre_completo as string | null) ?? null,
        rol: rolDe(m.rol),
        ultimoAcceso: u.user?.last_sign_in_at ?? null,
        // Entró por SSO si su identidad viene de un proveedor SAML.
        sso: (u.user?.identities ?? []).some((i) => i.provider.startsWith("sso")),
      };
    }),
  );

  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Usuarios"
        descripcion="Quién trabaja en tu empresa y qué puede hacer cada persona. Quien inicia una conciliación no puede aprobarla si hay otra persona que pueda hacerlo."
      />
      <UsuariosPanel miembros={miembros} yo={acceso.usuario.id} />
    </div>
  );
}
