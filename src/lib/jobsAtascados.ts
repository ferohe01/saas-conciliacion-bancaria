/**
 * Detectar una conciliación que se quedó colgada.
 *
 * ── El hueco que tapa ──────────────────────────────────────────────────────
 *
 * `POST /api/conciliacion/iniciar` ya marca `error` cuando n8n no responde,
 * responde algo que no es 2xx, o acepta un número de partidas distinto del
 * enviado. Lo que NO cubre —y no puede— es que n8n **acepte con 200 y muera
 * después**: el flujo responde en su segundo nodo, así que la aceptación no
 * promete nada sobre los ocho nodos siguientes. Si el runner aborta (nos pasó
 * con el bucle cuadrático de la difusa) o el contenedor se reinicia, el job se
 * queda en `procesando` y nadie lo saca de ahí.
 *
 * ── Por qué importa más de lo que parece ───────────────────────────────────
 *
 * No es solo una pantalla girando. Un job en `pendiente` o `procesando`
 * **retiene la clave de idempotencia** (cuenta + período), así que el usuario
 * tampoco puede relanzar ese período: queda encerrado sin saber por qué.
 *
 * ── Por qué NO se marca `error` sola ───────────────────────────────────────
 *
 * Un temporizador no sabe si n8n murió o si va lento. Declarar fallida una
 * conciliación que está terminando sería inventarse un hecho, así que aquí solo
 * se **describe** lo observable —cuánto lleva— y quien mira decide. Lo que sí
 * se hace sin preguntar es dejar de bloquear el relanzamiento, porque eso no
 * afirma nada y desencalla al usuario.
 */

import type { EstadoJob } from "@/lib/contract/enums";

export type SaludJob =
  /** Dentro de lo esperable. */
  | "normal"
  /** Tarda más de lo habitual, pero es plausible: se sigue esperando. */
  | "lento"
  /** Tanto que ya no es espera: hay que dar salida al usuario. */
  | "detenido";

/**
 * Umbrales, medidos contra corridas reales en producción:
 *
 *     68.571 partidas → 23–34 s
 *     39.961 partidas → 14–49 s
 *
 * O sea que el trabajo pesado se despacha en menos de un minuto incluso en el
 * corte más grande que hemos hecho. Aun así los umbrales van MUY por encima, y
 * a propósito: la capa de IA depende de un LLM externo, y una corrida con miles
 * de adjudicaciones puede tardar minutos legítimamente. Un falso "detenida"
 * cuesta más que esperar de más — empuja a relanzar algo que iba a terminar.
 */
export const MINUTOS_LENTO = 5;
export const MINUTOS_DETENIDO = 30;

/** Estados en los que el job todavía espera algo de n8n. */
function enVuelo(estado: EstadoJob): boolean {
  return estado === "pendiente" || estado === "procesando";
}

export function minutosDesde(createdAt: string, ahora: Date = new Date()): number {
  const t = new Date(createdAt).getTime();
  // Una fecha ilegible no debe declarar nada detenido: sin dato fiable, la
  // respuesta honesta es "no lo sé", que aquí se expresa como cero minutos.
  if (!Number.isFinite(t)) return 0;
  return (ahora.getTime() - t) / 60000;
}

export function saludDelJob(
  estado: EstadoJob,
  createdAt: string,
  ahora: Date = new Date(),
): SaludJob {
  if (!enVuelo(estado)) return "normal";
  const min = minutosDesde(createdAt, ahora);
  if (min >= MINUTOS_DETENIDO) return "detenido";
  if (min >= MINUTOS_LENTO) return "lento";
  return "normal";
}

/**
 * ¿Este job debe seguir bloqueando el relanzamiento de su período?
 *
 * Un job en vuelo reserva su cuenta+período para que dos clics no creen dos
 * conciliaciones iguales. Pero pasado el umbral de "detenido" esa reserva deja
 * de proteger de nada y solo encierra: nadie hace doble clic media hora después.
 */
export function bloqueaRelanzamiento(
  estado: EstadoJob,
  createdAt: string,
  ahora: Date = new Date(),
): boolean {
  return enVuelo(estado) && saludDelJob(estado, createdAt, ahora) !== "detenido";
}
