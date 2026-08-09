import "server-only";
import type { Mensaje } from "./prompts";

/**
 * Cliente del modelo (solo servidor).
 *
 * OpenAI, igual que el motor en n8n (`lmChatOpenAi`): una credencial, un
 * proveedor y una factura. Si algún día se cambia, se cambia aquí y nada más.
 *
 * ⚠️ El frontend NUNCA conoce la clave, igual que no conoce las de n8n ni el
 * `service_role`. Todo pasa por `/api/asistente`.
 *
 * ⚠️ **Sin streaming, a propósito.** La respuesta se verifica entera antes de
 * enseñarla (`verificacion.ts`); enseñarla mientras llega sería enseñar texto
 * sin comprobar, que es justo lo que la verificación impide. Son 2-3 frases:
 * no hay nada que ganar.
 */

/** El asistente es OPCIONAL: sin clave, no existe y la interfaz no lo ofrece. */
export function asistenteDisponible(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Cuánto se espera al modelo.
 *
 * Corto a propósito: esto se pide al pulsar un botón y hay un panel correcto
 * debajo. Que tarde es peor que que no esté — la explicación es un extra, no
 * el contenido.
 */
const TIMEOUT_MS = 20_000;

/** Tope de la respuesta. Se piden 3 frases; esto es la red, no el objetivo. */
const MAX_TOKENS = 400;

export type RespuestaIa =
  | { ok: true; texto: string }
  | { ok: false; error: string };

export async function preguntarAlModelo(
  mensajes: Mensaje[],
): Promise<RespuestaIa> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "El asistente no está configurado." };

  const modelo = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelo,
        messages: mensajes,
        max_completion_tokens: MAX_TOKENS,
      }),
      signal: control.signal,
    });

    if (!res.ok) {
      // El detalle va al log del servidor, no a la pantalla: puede traer datos
      // de la cuenta y al usuario no le sirve de nada.
      console.error("[asistente] respuesta no ok", res.status, await res.text());
      return { ok: false, error: "El asistente no pudo responder." };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const texto = data.choices?.[0]?.message?.content?.trim();
    if (!texto) return { ok: false, error: "El asistente no pudo responder." };

    return { ok: true, texto };
  } catch (e) {
    const abortado = e instanceof Error && e.name === "AbortError";
    console.error("[asistente] fallo de red", e);
    return {
      ok: false,
      error: abortado
        ? "El asistente tardó demasiado."
        : "No se pudo contactar con el asistente.",
    };
  } finally {
    clearTimeout(reloj);
  }
}
