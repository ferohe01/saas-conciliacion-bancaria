import "server-only";

/**
 * La llamada al modelo de la capa de IA (lo que era el nodo «AI Agent» +
 * «OpenAI Chat Model» de n8n).
 *
 * Mismo proveedor y mismo modelo por defecto que tenía el flujo
 * (`gpt-5.6-luna`), con la misma credencial que ya usa el asistente
 * (`OPENAI_API_KEY`): una credencial y una factura. `OPENAI_MODEL_CONCILIACION`
 * permite usar otro modelo solo para conciliar sin tocar el del asistente.
 *
 * ⚠️ NUNCA lanza. Devuelve `null` si no hay clave, si el servicio se cae, agota
 * cuota, se pasa de tiempo o contesta algo raro. En n8n eso se consiguió con
 * `onError: continueRegularOutput`, después de que un modelo que no contestó
 * dejara un job en `procesando` para siempre con 447.795 pares ya resueltos.
 * La degradación correcta de una capa opcional es hacer menos, no romper.
 */

/** Dos intentos con 3 s entre ellos, como el nodo de n8n. */
const INTENTOS = 2;
const ESPERA_MS = 3_000;
/**
 * Hasta 150 adjudicaciones con su justificación: no son las 2-3 frases del
 * asistente, y un modelo con razonamiento gasta tokens antes de contestar.
 */
const TIMEOUT_MS = 180_000;
const MAX_TOKENS = 16_000;

export function iaConciliacionDisponible(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function consultarModeloConciliacion(
  system: string,
  user: string,
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const modelo =
    process.env.OPENAI_MODEL_CONCILIACION || process.env.OPENAI_MODEL || "gpt-5.6-luna";

  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: modelo,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          // El prompt pide «ÚNICAMENTE JSON»; esto lo garantiza del lado del
          // proveedor en vez de confiar en que obedezca.
          response_format: { type: "json_object" },
          max_completion_tokens: MAX_TOKENS,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error(
          `[motor/ia] el modelo respondió ${res.status} (intento ${intento}/${INTENTOS}):`,
          (await res.text()).slice(0, 300),
        );
        // 4xx que no sean 429 no se arreglan reintentando (clave, modelo).
        if (res.status !== 429 && res.status < 500) return null;
      } else {
        const data = (await res.json()) as {
          choices?: { message?: { content?: string | null } }[];
        };
        const texto = data.choices?.[0]?.message?.content?.trim();
        if (texto) return texto;
        console.error(`[motor/ia] el modelo no devolvió contenido (intento ${intento}/${INTENTOS})`);
      }
    } catch (e) {
      console.error(`[motor/ia] fallo al llamar al modelo (intento ${intento}/${INTENTOS}):`, e);
    }
    if (intento < INTENTOS) await new Promise((r) => setTimeout(r, ESPERA_MS));
  }
  return null;
}
