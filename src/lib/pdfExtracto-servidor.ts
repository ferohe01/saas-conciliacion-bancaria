import "server-only";
import { LecturaPdf, PROMPT_SISTEMA_PDF } from "@/lib/pdfExtracto";

/**
 * Lee un estado de cuenta en PDF con el modelo de OpenAI (la misma credencial y
 * el mismo modelo que la capa de IA del motor).
 *
 * El PDF viaja como archivo adjunto al mensaje (`type: "file"`): el modelo ve
 * las páginas tal cual, tablas incluidas, sin pasar por una extracción de texto
 * que desordenaría las columnas. La respuesta se valida con zod; lo que no
 * encaje es un fallo explicado, nunca movimientos a medias.
 */

const TIMEOUT_MS = 240_000;
const MAX_TOKENS = 32_000;

export type ResultadoLectura =
  | { ok: true; lectura: LecturaPdf }
  | { ok: false; error: string };

export async function leerPdfConIa(bytes: Uint8Array, nombre: string): Promise<ResultadoLectura> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ok: false, error: "La lectura de PDF con IA no está configurada en este servidor. Sube el extracto en Excel o CSV." };
  }
  const modelo = process.env.OPENAI_MODEL_CONCILIACION || process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const base64 = Buffer.from(bytes).toString("base64");

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: "system", content: PROMPT_SISTEMA_PDF },
          {
            role: "user",
            content: [
              { type: "file", file: { filename: nombre, file_data: `data:application/pdf;base64,${base64}` } },
              { type: "text", text: "Transcribe este estado de cuenta al JSON indicado." },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error("[pdf] fallo al llamar al modelo:", e);
    return { ok: false, error: "No se pudo leer el PDF: el servicio de IA no respondió. Vuelve a intentarlo o súbelo en Excel o CSV." };
  }

  if (!res.ok) {
    const cuerpo = await res.text();
    console.error("[pdf] el modelo respondió", res.status, cuerpo.slice(0, 300));
    return {
      ok: false,
      error:
        res.status === 429
          ? "Se agotó la cuota del servicio de IA. Sube el extracto en Excel o CSV."
          : "El servicio de IA no pudo leer este PDF. Súbelo en Excel o CSV.",
    };
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  };
  const eleccion = data.choices?.[0];
  if (eleccion?.finish_reason === "length") {
    return { ok: false, error: "El PDF tiene demasiados movimientos para leerlo de una vez. Súbelo en Excel o CSV." };
  }
  let json: unknown;
  try {
    json = JSON.parse(eleccion?.message?.content ?? "");
  } catch {
    return { ok: false, error: "La lectura del PDF no devolvió datos válidos. Súbelo en Excel o CSV." };
  }
  const parsed = LecturaPdf.safeParse(json);
  if (!parsed.success) {
    console.error("[pdf] respuesta con forma inesperada:", parsed.error.issues[0]);
    return { ok: false, error: "La lectura del PDF no devolvió datos válidos. Súbelo en Excel o CSV." };
  }
  return { ok: true, lectura: parsed.data };
}
