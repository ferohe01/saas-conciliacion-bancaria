/**
 * La dirección pública desde la que llegó una petición, para redirigir.
 *
 * ⚠️ Dentro del contenedor, `request.nextUrl` lleva el host donde ESCUCHA el
 * servidor (`0.0.0.0:3000`), no el que usó el navegador: redirigir con
 * `nextUrl.clone()` mandaba a `https://0.0.0.0:3000/login`. Traefik deja el host
 * real en `x-forwarded-host` / `host`, y el esquema en `x-forwarded-proto`.
 */
export function origenPublico(headers: Headers, respaldo: string): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return respaldo;
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(host);
  const proto = headers.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto.split(",")[0]!.trim()}://${host.split(",")[0]!.trim()}`;
}
