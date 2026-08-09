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

/**
 * Tope para la conversación con herramientas.
 *
 * ⚠️ Mucho más alto que el otro, y no porque la respuesta sea más larga: el
 * cupo lo comparten el razonamiento del modelo y las llamadas a herramientas
 * que emite. Con 400 el modelo puede agotarlo eligiendo qué consultar y
 * devolver un mensaje VACÍO — que desde fuera se ve como "no pudo responder",
 * un mensaje que apunta al sitio equivocado.
 */
const MAX_TOKENS_HERRAMIENTAS = 1500;

/**
 * Espera por llamada en el camino con herramientas.
 *
 * Más largo que el otro porque aquí el modelo razona qué consultar antes de
 * emitir nada, y porque una pregunta puede costar hasta tres llamadas. Sigue
 * siendo un techo: si se agota, el usuario ve que tardó, no una pantalla
 * colgada.
 */
const TIMEOUT_HERRAMIENTAS_MS = 45_000;

/**
 * Esfuerzo de razonamiento en el camino con herramientas.
 *
 * ⚠️ **Obligatorio, no una optimización.** Los modelos de razonamiento (la
 * familia gpt-5) rechazan las herramientas en `/v1/chat/completions` si el
 * razonamiento está activo:
 *
 *     Function tools with reasoning_effort are not supported for gpt-5.6-luna
 *     in /v1/chat/completions. To use function tools, use /v1/responses or
 *     set reasoning_effort…
 *
 * Y desactivarlo aquí no cuesta nada: la tarea del modelo es elegir UNA
 * consulta de una lista de cinco y luego repetir cifras que ya vienen
 * calculadas. No hay nada que razonar — razonar es justo lo que no queremos que
 * haga con los números.
 *
 * Configurable porque el valor admitido depende del modelo, y hay familias
 * (gpt-4o) que no aceptan el parámetro en absoluto: si lo rechazan, se
 * reintenta sin él (ver `conversarConHerramientas`).
 */
const RAZONAMIENTO = process.env.OPENAI_REASONING_EFFORT || "none";

/** ¿El fallo se debe al parámetro de razonamiento y no a otra cosa? */
function esFalloDeRazonamiento(cuerpo: string): boolean {
  return /reasoning_effort/i.test(cuerpo);
}

/**
 * Traduce un fallo de la API a algo que se pueda accionar.
 *
 * Tres cosas distintas se veían como "El asistente no pudo responder": la
 * clave mala, el modelo inexistente y el modelo que no admite herramientas. Es
 * el mismo error de diagnóstico que costó una tarde con el webhook de n8n, y la
 * lección quedó escrita: **un mensaje que no distingue causas manda a buscar
 * donde no es.**
 */
function explicarFallo(status: number, cuerpo: string): string {
  let codigo = "";
  let detalle = "";
  try {
    const j = JSON.parse(cuerpo);
    codigo = j?.error?.code ?? j?.error?.type ?? "";
    detalle = j?.error?.message ?? "";
  } catch {
    detalle = cuerpo.slice(0, 200);
  }

  if (status === 401) return "La clave del asistente no es válida.";
  if (status === 429) return "Se agotó la cuota del asistente.";
  if (status === 404 || codigo === "model_not_found") {
    return `El modelo configurado no existe (${process.env.OPENAI_MODEL || "por defecto"}).`;
  }
  if (/tool|function/i.test(detalle)) {
    return `El modelo no admite consultas a tus datos: ${detalle.slice(0, 160)}`;
  }
  return `El asistente no pudo responder (${status}${codigo ? ` ${codigo}` : ""}).`;
}

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
      const cuerpo = await res.text();
      console.error("[asistente] respuesta no ok", res.status, cuerpo);
      return { ok: false, error: explicarFallo(res.status, cuerpo) };
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
    const reloj = setTimeout(() => control.abort(), TIMEOUT_HERRAMIENTAS_MS);
    let data: {
      choices?: {
        finish_reason?: string;
        message?: {
          content?: string | null;
          tool_calls?: MensajeApi["tool_calls"];
        };
      }[];
      usage?: { completion_tokens?: number };
    };

    try {
      const cuerpoBase = {
        model: modelo,
        messages: historial,
        tools,
        // La última ronda no puede pedir más consultas: o responde, o se
        // queda sin turno. Sin esto, un modelo indeciso agota el tope y el
        // usuario se queda sin respuesta.
        tool_choice: ronda === MAX_RONDAS - 1 ? "none" : "auto",
        max_completion_tokens: MAX_TOKENS_HERRAMIENTAS,
      };

      const pedir = (conRazonamiento: boolean) =>
        fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(
            conRazonamiento
              ? { ...cuerpoBase, reasoning_effort: RAZONAMIENTO }
              : cuerpoBase,
          ),
          signal: control.signal,
        });

      let res = await pedir(true);

      // ⚠️ Reintento sin el parámetro: hay familias de modelo que lo exigen
      // (gpt-5 con herramientas) y otras que lo rechazan (gpt-4o). Sin esta
      // vuelta, cambiar de modelo rompería el chat con un error que no dice
      // que el problema es un parámetro sobrante.
      if (!res.ok) {
        const primero = await res.text();
        if (esFalloDeRazonamiento(primero)) {
          console.warn("[asistente] reintentando sin reasoning_effort");
          res = await pedir(false);
          if (!res.ok) {
            const cuerpo = await res.text();
            console.error("[asistente] respuesta no ok", res.status, cuerpo);
            return { ok: false, error: explicarFallo(res.status, cuerpo) };
          }
        } else {
          console.error("[asistente] respuesta no ok", res.status, primero);
          return { ok: false, error: explicarFallo(res.status, primero) };
        }
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

    const eleccion = data.choices?.[0];
    const msg = eleccion?.message;
    const llamadas = msg?.tool_calls ?? [];

    if (llamadas.length === 0) {
      const texto = msg?.content?.trim();
      if (!texto) {
        // Sin texto y sin consultas: hay que decir POR QUÉ. Quedarse en "no
        // pudo responder" es el mensaje que manda a buscar donde no es.
        console.error(
          "[asistente] respuesta vacía",
          JSON.stringify({
            finish_reason: eleccion?.finish_reason,
            completion_tokens: data.usage?.completion_tokens,
            ronda,
          }),
        );
        return {
          ok: false,
          error:
            eleccion?.finish_reason === "length"
              ? "El asistente se quedó sin espacio antes de contestar. Prueba con una pregunta más concreta."
              : "El asistente no devolvió respuesta.",
        };
      }
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

  return {
    ok: false,
    error:
      "El asistente consultó tus datos pero no llegó a redactar la respuesta. " +
      "Vuelve a preguntar.",
  };
}
