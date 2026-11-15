import { rolDe, type Rol } from "@/lib/roles";

/**
 * SSO corporativo con SAML 2.0 (migración 0058).
 *
 * Un mecanismo para todos los proveedores de identidad corporativos —Microsoft
 * Entra ID, Okta, Google Workspace…—: Supabase Auth (GoTrue) habla SAML y la
 * empresa registra su proveedor con su dominio de correo. Puro y con tests.
 */

/** El dominio de un correo, en minúsculas; `null` si no lo parece. */
export function dominioDe(email: string | null | undefined): string | null {
  const partes = String(email ?? "").trim().toLowerCase().split("@");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(partes[1]) ? partes[1] : null;
}

/** Un dominio escrito por el administrador, normalizado; `null` si no vale. */
export function normalizarDominio(entrada: string): string | null {
  const d = entrada.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
}

export type ProveedorSso = {
  empresaId: string;
  providerId: string;
  dominio: string;
  rolPorDefecto: string;
};

/**
 * ¿Se da de alta automáticamente a quien acaba de entrar por SSO, y con qué rol?
 *
 * ⚠️⚠️ Solo si la sesión vino DE VERDAD del proveedor SAML de esa empresa
 * (`app_metadata.provider` = `sso:<provider id>`), no solo porque su correo
 * termine en el dominio. Si bastara el dominio, cualquiera podría registrarse
 * con contraseña usando `alguien@empresa.com` —sin que la empresa lo
 * verificara— y entrar a ella. El proveedor de identidad es quien da fe de que
 * esa persona trabaja allí.
 */
export function altaPorSso(args: {
  email: string | null | undefined;
  proveedorDeLaSesion: string | null | undefined;
  proveedores: ProveedorSso[];
}): { empresaId: string; rol: Rol } | null {
  const dominio = dominioDe(args.email);
  if (!dominio) return null;
  const p = args.proveedores.find((x) => x.dominio === dominio);
  if (!p) return null;
  if (args.proveedorDeLaSesion !== `sso:${p.providerId}`) return null;
  return { empresaId: p.empresaId, rol: rolDe(p.rolPorDefecto) };
}

/**
 * Lo que el administrador tiene que pegar en su proveedor de identidad para
 * dar de alta la aplicación. Salen de la URL pública de Supabase.
 */
export function datosParaElProveedor(urlSupabase: string): {
  entityId: string;
  acsUrl: string;
  metadataUrl: string;
} {
  const base = urlSupabase.replace(/\/+$/, "");
  return {
    entityId: `${base}/auth/v1/sso/saml/metadata`,
    acsUrl: `${base}/auth/v1/sso/saml/acs`,
    metadataUrl: `${base}/auth/v1/sso/saml/metadata?download=true`,
  };
}
