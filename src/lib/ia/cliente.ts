import "server-only";
import type { Mensaje } from "./prompts";
import { HERRAMIENTAS } from "./herramientas";

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

// ─────────────────────────────────────────────────────────────────────────────
// Conversación con herramientas (el asistente general)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuántas rondas de consulta se permiten antes de exigir una respuesta.
 *
 * Tres bastan para "cuánto me deben y cuánto debo" (dos consultas) más un
 * remate. Sin tope, un modelo confundido puede encadenar llamadas indefinidamente
 * y cada una cuesta dinero y segundos.
 */
const MAX_RONDAS = 3;

type MensajeApi = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
};

export type RespuestaConHerramientas =
  | {
      ok: true;
      texto: string;
      /**
       * Todo lo que devolvieron las herramientas, concatenado.
       *
       * ⚠️ Es la lista de cifras admitidas: `verificarCifras` compara contra
       * esto. Si el modelo cita un número que ninguna consulta devolvió, la
       * respuesta no se muestra.
       */
      contexto: string;
      /** Qué consultó, para poder enseñarlo al usuario. */
      consultas: string[];
    }
  | { ok: false; error: string };

/**
 * Conversa dejando que el modelo elija entre las herramientas disponibles.
 *
 * ⚠️ **El modelo no consulta nada: pide que se consulte.** Los argumentos que
 * compone se validan en `ejecutarHerramienta`, que es quien habla con la base —
 * siempre con el cliente de sesión y sin aceptar jamás un `empresa_id`.
 */
export async function conversarConHerramientas(
  mensajes: Mensaje[],
  ejecutar: (nombre: string, args: Record<string, unknown>) => Promise<string>,
): Promise<RespuestaConHerramientas> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "El asistente no está configurado." };

  const modelo = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const historial: MensajeApi[] = mensajes.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const resultados: string[] = [];
  const consultas: string[] = [];

  const tools = HERRAMIENTAS.map((h) => ({
    type: "function" as const,
    function: {
      name: h.nombre,
      description: h.descripcion,
      parameters: h.parametros,
    },
  }));

  for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);
    let data: {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: MensajeApi["tool_calls"];
        };
      }[];
    };

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: modelo,
          messages: historial,
          tools,
          // La última ronda no puede pedir más consultas: o responde, o se
          // queda sin turno. Sin esto, un modelo indeciso agota el tope y el
          // usuario se queda sin respuesta.
          tool_choice: ronda === MAX_RONDAS - 1 ? "none" : "auto",
          max_completion_tokens: MAX_TOKENS,
        }),
        signal: control.signal,
      });
      if (!res.ok) {
        console.error("[asistente] respuesta no ok", res.status, await res.text());
        return { ok: false, error: "El asistente no pudo responder." };
      }
      data = await res.json();
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

    const msg = data.choices?.[0]?.message;
    const llamadas = msg?.tool_calls ?? [];

    if (llamadas.length === 0) {
      const texto = msg?.content?.trim();
      if (!texto) return { ok: false, error: "El asistente no pudo responder." };
      return { ok: true, texto, contexto: resultados.join("\n\n"), consultas };
    }

    historial.push({
      role: "assistant",
      content: msg?.content ?? null,
      tool_calls: llamadas,
    });

    for (const c of llamadas) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.function.arguments || "{}");
      } catch {
        // Argumentos ilegibles: se ejecuta sin ellos y la herramienta decide.
      }
      const salida = await ejecutar(c.function.name, args);
      resultados.push(salida);
      consultas.push(c.function.name);
      historial.push({ role: "tool", tool_call_id: c.id, content: salida });
    }
  }

  return { ok: false, error: "El asistente no pudo responder." };
}
