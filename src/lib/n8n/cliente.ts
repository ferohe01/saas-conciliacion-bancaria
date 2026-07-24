import "server-only";
import {
  RespuestaAceptacion,
  type PayloadConciliacion,
} from "@/lib/contract/payload";

/**
 * Cliente del webhook de n8n (solo servidor). Envía el payload normalizado con
 * el token secreto en el header y valida la respuesta inmediata de aceptación.
 * El frontend NUNCA llama a n8n directamente.
 */

export type ResultadoEnvio =
  | { ok: true; aceptacion: RespuestaAceptacion }
  | { ok: false; error: string };

export async function enviarAN8n(
  payload: PayloadConciliacion,
): Promise<ResultadoEnvio> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) {
    return { ok: false, error: "N8N_WEBHOOK_URL no está configurado." };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Token compartido: n8n rechaza requests sin él.
        Authorization: `Bearer ${process.env.N8N_WEBHOOK_TOKEN ?? ""}`,
        "x-n8n-token": process.env.N8N_WEBHOOK_TOKEN ?? "",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "No se pudo contactar al webhook de n8n." };
  }

  if (!res.ok) {
    return { ok: false, error: `n8n respondió ${res.status}.` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: "Respuesta de n8n no es JSON válido." };
  }

  const parsed = RespuestaAceptacion.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: "n8n no devolvió una respuesta de aceptación válida.",
    };
  }

  return { ok: true, aceptacion: parsed.data };
}
