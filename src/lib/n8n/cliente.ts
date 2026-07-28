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

/**
 * Cuánto esperar la respuesta de aceptación de n8n.
 *
 * El flujo responde en su SEGUNDO nodo ("Responder aceptado"), antes de hacer
 * nada de trabajo pesado, así que sano contesta en menos de un segundo. Si
 * tarda más de esto es que el bucle de eventos de n8n está bloqueado por otra
 * ejecución — exactamente la señal de saturación que queremos no propagar.
 *
 * Sin timeout, un n8n atascado dejaba colgado el handler de Next.js todo el
 * tiempo que hiciera falta, y en un pico eso encadena: varios handlers
 * bloqueados agotan la concurrencia y la app se ralentiza para todos, incluidos
 * los usuarios que no están conciliando.
 */
const TIMEOUT_MS = 15_000;

export type ResultadoEnvio =
  | { ok: true; aceptacion: RespuestaAceptacion }
  | {
      ok: false;
      error: string;
      /**
       * true cuando NO se sabe si n8n llegó a recibir el payload (se agotó el
       * tiempo con la petición ya en vuelo). Quien llama no debe dar el job por
       * fallido: puede estar procesándose ahora mismo.
       */
      entregaIncierta?: boolean;
    };

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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Se distinguen dos fallos que parecen el mismo y no lo son:
    //  - Timeout: la petición SALIÓ. n8n pudo recibirla y estar trabajando.
    //  - Conexión rechazada / DNS: no llegó. El job sí falló.
    const esTimeout = e instanceof Error && e.name === "TimeoutError";
    return esTimeout
      ? {
          ok: false,
          entregaIncierta: true,
          error:
            "n8n tardó demasiado en confirmar. La conciliación puede estar en marcha; revisa el historial en unos minutos.",
        }
      : { ok: false, error: "No se pudo contactar al webhook de n8n." };
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
