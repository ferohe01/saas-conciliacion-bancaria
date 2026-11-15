import { rolDe, type Rol } from "@/lib/roles";

/**
 * SSO corporativo con SAML 2.0 (migración 0058).
 *
 * Un mecanismo para todos los proveedores de identidad corporativos —Microsoft
 * Entra ID, Okta, Google Workspace…—: Supabase Auth (GoTrue) habla SAML y la
 * empresa registra su proveedor con su dominio de correo. Puro y con tests.
 */

/**
 * ⚠️⚠️ SSO DESACTIVADO A PROPÓSITO (decisión de producto, 15/11/2026).
 *
 * El sistema se vende también a pequeñas y medianas empresas, que no tienen un
 * proveedor de identidad corporativo ni lo necesitan: para ellas el botón de
 * SSO en el login solo confundía. El SSO está IMPLEMENTADO y probado —botón,
 * vuelta en /auth/callback, alta automática segura, panel en /usuarios,
 * migración 0058— y se activará cuando una empresa grande lo solicite.
 *
 * Con `false`: el login no muestra el botón, /usuarios no muestra el panel, y
 * /auth/callback y las acciones de alta/baja de proveedor no hacen nada. La
 * tabla `sso_proveedores` (0058) se queda en la base, vacía e inofensiva.
 *
 * PARA ACTIVARLO: poner `true` aquí, desplegar, y seguir ops/SSO-SAML.md
 * (activar SAML en el Supabase self-hosted). Ver CLAUDE.md § SSO.
 *
 * Se apaga con este interruptor y NO comentando el código a propósito: así
 * sigue compilando y pasando sus tests, y encenderlo es cambiar una palabra. Un
 * bloque comentado se queda atrás sin que nadie lo note y deja de compilar.
 */
export const SSO_ACTIVO = false;

/** El dominio de un correo, en minúsculas; `null` si no lo parece. */
export function dominioDe(email: string | null | undefined): string | null {
  const partes = String(email ?? "").trim().toLowerCase().split("@");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(partes[1]) ? partes[1] : null;
}

/**
 * Dominios de correo personal: no pertenecen a ninguna empresa, así que no
 * pueden tener SSO corporativo. Una sola lista para las dos caras: /usuarios no
 * deja registrar un proveedor sobre ellos, y el login explica que con esos
 * correos se entra con contraseña.
 *
 * Registrar SSO sobre `gmail.com` sería grave, no solo inútil: daría a entender
 * que cualquier cuenta de Gmail pertenece a esa empresa.
 */
const DOMINIOS_PUBLICOS = new Set([
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.es", "outlook.com", "outlook.es", "live.com", "live.com.pe", "msn.com",
  "yahoo.com", "yahoo.es", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me", "gmx.com", "zoho.com", "mail.com", "yandex.com",
]);

export function esDominioPublico(dominio: string | null | undefined): boolean {
  return dominio != null && DOMINIOS_PUBLICOS.has(dominio.trim().toLowerCase());
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
