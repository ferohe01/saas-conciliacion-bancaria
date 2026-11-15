"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { exigir } from "@/lib/roles-servidor";
import { ROLES } from "@/lib/roles";
import { normalizarDominio } from "@/lib/sso";

/**
 * Alta y baja del proveedor SAML de la empresa (0058).
 *
 * El proveedor se registra en Supabase Auth (GoTrue) por su API admin, con
 * service_role, y se enlaza a la empresa en `sso_proveedores`. GoTrue tiene que
 * tener SAML activado (GOTRUE_SAML_ENABLED + GOTRUE_SAML_PRIVATE_KEY): ver
 * ops/SSO-SAML.md. Si no lo está, se dice así, no con un error genérico.
 */

type Resultado = { ok: boolean; error?: string };

const AltaSchema = z.object({
  dominio: z.string(),
  metadataUrl: z.string().trim().url("Pega la URL de metadatos SAML que te da tu proveedor de identidad."),
  rol: z.enum(ROLES),
});

function apiAdmin(ruta: string, init: RequestInit = {}) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "");
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return fetch(`${base}/auth/v1/admin/sso/providers${ruta}`, {
    ...init,
    headers: {
      apikey: clave,
      Authorization: `Bearer ${clave}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
}

function explicarFalloGoTrue(status: number, cuerpo: string): string {
  if (status === 404 && /saml/i.test(cuerpo)) {
    return "El acceso corporativo (SAML) no está activado en el servidor de autenticación. Hay que activarlo una vez (ops/SSO-SAML.md) antes de registrar proveedores.";
  }
  if (/metadata/i.test(cuerpo)) {
    return "No se pudo leer la URL de metadatos SAML. Comprueba que sea pública y la correcta de tu proveedor de identidad.";
  }
  if (/domain/i.test(cuerpo) && /exist|already|used/i.test(cuerpo)) {
    return "Ese dominio ya tiene un proveedor registrado.";
  }
  return `El servidor de autenticación rechazó el proveedor (${status}).`;
}

export async function registrarSso(entrada: unknown): Promise<Resultado> {
  const acceso = await exigir("gestionar_usuarios");
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const parsed = AltaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const dominio = normalizarDominio(parsed.data.dominio);
  if (!dominio) return { ok: false, error: "Escribe el dominio de correo de tu empresa, por ejemplo win.pe." };

  const admin = createAdminClient();
  const { data: previo } = await admin
    .from("sso_proveedores")
    .select("empresa_id")
    .eq("dominio", dominio)
    .maybeSingle();
  if (previo) {
    return {
      ok: false,
      error:
        previo.empresa_id === acceso.empresa.empresa_id
          ? "Tu empresa ya tiene SSO para ese dominio. Quítalo primero si quieres cambiarlo."
          : "Ese dominio ya está vinculado a otra empresa del sistema.",
    };
  }

  let res: Response;
  try {
    res = await apiAdmin("", {
      method: "POST",
      body: JSON.stringify({ type: "saml", metadata_url: parsed.data.metadataUrl, domains: [dominio] }),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar con el servidor de autenticación." };
  }
  const cuerpo = await res.text();
  if (!res.ok) {
    console.error("[sso] alta rechazada por GoTrue:", res.status, cuerpo.slice(0, 300));
    return { ok: false, error: explicarFalloGoTrue(res.status, cuerpo) };
  }
  const proveedor = JSON.parse(cuerpo) as { id?: string };
  if (!proveedor.id) return { ok: false, error: "El servidor de autenticación no devolvió el proveedor." };

  const { error } = await admin.from("sso_proveedores").insert({
    empresa_id: acceso.empresa.empresa_id,
    provider_id: proveedor.id,
    dominio,
    rol_por_defecto: parsed.data.rol,
    creado_por: acceso.usuario.id,
  });
  if (error) {
    // Se deshace en GoTrue: un proveedor sin empresa dejaría entrar a gente que
    // luego el callback no sabe dónde poner.
    await apiAdmin(`/${proveedor.id}`, { method: "DELETE" }).catch(() => undefined);
    return { ok: false, error: "No se pudo guardar el proveedor." };
  }
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function quitarSso(id: string): Promise<Resultado> {
  const acceso = await exigir("gestionar_usuarios");
  if (!acceso.ok) return { ok: false, error: acceso.error };

  const admin = createAdminClient();
  const { data: fila } = await admin
    .from("sso_proveedores")
    .select("id, provider_id")
    .eq("id", id)
    .eq("empresa_id", acceso.empresa.empresa_id)
    .maybeSingle();
  if (!fila) return { ok: false, error: "Ese proveedor no es de tu empresa." };

  const res = await apiAdmin(`/${fila.provider_id as string}`, { method: "DELETE" }).catch(() => null);
  // 404 = ya no estaba en GoTrue: se limpia igual la fila de la app.
  if (!res || (!res.ok && res.status !== 404)) {
    return { ok: false, error: "No se pudo quitar el proveedor del servidor de autenticación." };
  }
  const { error } = await admin
    .from("sso_proveedores")
    .delete()
    .eq("id", id)
    .eq("empresa_id", acceso.empresa.empresa_id);
  if (error) {
    // GoTrue ya no lo tiene: el SSO no funciona, pero la pantalla lo seguiría
    // mostrando. Se dice para que se reintente.
    return { ok: false, error: "El proveedor se desactivó, pero no se pudo quitar de la lista. Vuelve a intentarlo." };
  }
  revalidatePath("/usuarios");
  return { ok: true };
}
