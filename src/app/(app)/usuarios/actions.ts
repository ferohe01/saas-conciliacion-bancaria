"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { exigir } from "@/lib/roles-servidor";
import { ROLES, dejaSinAdministrador, rolDe } from "@/lib/roles";

/**
 * Gestión de usuarios de la empresa (0057). Todo con `service_role` y filtro
 * explícito de empresa: la política de `usuarios_empresa` solo deja leer la
 * fila propia, y escribir en ella está retirado para `authenticated`.
 */

type Resultado = { ok: boolean; error?: string };

const RolSchema = z.enum(ROLES);

async function equipo(empresaId: string) {
  const { data, error } = await createAdminClient()
    .from("usuarios_empresa")
    .select("usuario_id, rol")
    .eq("empresa_id", empresaId);
  if (error) throw new Error("No se pudo leer el equipo.");
  return (data ?? []).map((m) => ({ usuarioId: m.usuario_id as string, rol: rolDe(m.rol) }));
}

export async function cambiarRol(usuarioId: string, rol: unknown): Promise<Resultado> {
  const acceso = await exigir("gestionar_usuarios");
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const parsed = RolSchema.safeParse(rol);
  if (!parsed.success) return { ok: false, error: "Rol no válido." };

  const miembros = await equipo(acceso.empresa.empresa_id);
  if (!miembros.some((m) => m.usuarioId === usuarioId)) {
    return { ok: false, error: "Esa persona no es de tu empresa." };
  }
  if (dejaSinAdministrador(miembros, { usuarioId, nuevoRol: parsed.data })) {
    return {
      ok: false,
      error: "La empresa se quedaría sin administrador. Nombra antes a otra persona como Administrador.",
    };
  }

  const { error } = await createAdminClient()
    .from("usuarios_empresa")
    .update({ rol: parsed.data })
    .eq("empresa_id", acceso.empresa.empresa_id)
    .eq("usuario_id", usuarioId);
  if (error) return { ok: false, error: "No se pudo cambiar el rol." };
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function quitarMiembro(usuarioId: string): Promise<Resultado> {
  const acceso = await exigir("gestionar_usuarios");
  if (!acceso.ok) return { ok: false, error: acceso.error };

  const miembros = await equipo(acceso.empresa.empresa_id);
  if (!miembros.some((m) => m.usuarioId === usuarioId)) {
    return { ok: false, error: "Esa persona no es de tu empresa." };
  }
  if (dejaSinAdministrador(miembros, { usuarioId, nuevoRol: null })) {
    return {
      ok: false,
      error: "La empresa se quedaría sin administrador. Nombra antes a otra persona como Administrador.",
    };
  }

  // Se quita la MEMBRESÍA, no la cuenta: sus decisiones pasadas siguen
  // firmadas con su usuario, que es lo que pide la trazabilidad.
  const { error } = await createAdminClient()
    .from("usuarios_empresa")
    .delete()
    .eq("empresa_id", acceso.empresa.empresa_id)
    .eq("usuario_id", usuarioId);
  if (error) return { ok: false, error: "No se pudo quitar a esa persona." };
  revalidatePath("/usuarios");
  return { ok: true };
}

const InvitarSchema = z.object({
  email: z.string().trim().toLowerCase().email("Escribe un correo válido."),
  rol: RolSchema,
});

export type ResultadoInvitacion =
  | { ok: true; enlace: string; email: string }
  | { ok: false; error: string };

/**
 * Da de alta a una persona y devuelve un ENLACE de un solo uso para entrar.
 *
 * No se depende de que el Supabase self-hosted tenga correo configurado: el
 * administrador copia el enlace y lo envía por donde quiera. El enlace lleva a
 * `/auth/confirmar`, que lo valida en el servidor y abre `/bienvenida` para que
 * la persona ponga su contraseña.
 */
export async function invitarUsuario(entrada: unknown): Promise<ResultadoInvitacion> {
  const acceso = await exigir("gestionar_usuarios");
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const parsed = InvitarSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { email, rol } = parsed.data;
  const admin = createAdminClient();

  // Persona nueva → enlace de invitación. Si ya tiene cuenta (por ejemplo,
  // entró antes por SSO o la quitaron de la empresa), enlace de acceso.
  let tipo: "invite" | "magiclink" = "invite";
  let link = await admin.auth.admin.generateLink({ type: "invite", email });
  if (link.error && /already|registered|exists/i.test(link.error.message)) {
    tipo = "magiclink";
    link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  }
  if (link.error || !link.data.user || !link.data.properties?.hashed_token) {
    console.error("[usuarios] no se pudo generar la invitación:", link.error);
    return { ok: false, error: "No se pudo crear la invitación. Inténtalo de nuevo." };
  }
  const usuarioId = link.data.user.id;

  // Una persona pertenece a una sola empresa: la sesión resuelve UNA (getEmpresaActual).
  const { data: previa } = await admin
    .from("usuarios_empresa")
    .select("empresa_id")
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  if (previa && previa.empresa_id !== acceso.empresa.empresa_id) {
    return { ok: false, error: "Ese correo ya pertenece a otra empresa del sistema." };
  }
  if (!previa) {
    const { error } = await admin.from("usuarios_empresa").insert({
      usuario_id: usuarioId,
      empresa_id: acceso.empresa.empresa_id,
      rol,
    });
    if (error) return { ok: false, error: "No se pudo añadir a esa persona a la empresa." };
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const enlace =
    `${proto}://${host}/auth/confirmar?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}` +
    `&type=${tipo}&next=/bienvenida`;

  revalidatePath("/usuarios");
  return { ok: true, enlace, email };
}
