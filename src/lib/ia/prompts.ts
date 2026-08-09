import type { Hallazgo } from "@/lib/diagnosticoPrevio";
import type { Diagnostico } from "@/lib/diagnosticoPartida";
import { COMO_FUNCIONA } from "./herramientas";

/**
 * Los prompts del asistente.
 *
 * Puros y con tests, y no por costumbre: aquí se decide **qué ve el modelo**, y
 * eso es a la vez el límite de coste, el límite de privacidad y el material
 * contra el que se verifica la respuesta (`verificacion.ts`).
 *
 * ── Tres reglas que no se negocian ─────────────────────────────────────────
 *
 * 1. **El contexto NO crece con los datos del cliente.** Con 452.309
 *    comprobantes ya se sabe cómo acaba meter filas en un prompt: 4,7 MB y 1,2
 *    millones de tokens, que ningún modelo acepta y que costaría una fortuna
 *    por conciliación. Aquí solo entran hallazgos ya agregados: unos cientos de
 *    caracteres, pase lo que pase.
 * 2. **El modelo no calcula.** Recibe cifras ya calculadas por Postgres o por
 *    funciones puras con tests, y solo las explica.
 * 3. **No afirma causas del motor.** Puede decir "no hay ninguna referencia en
 *    común"; no puede decir "el motor lo rechazó porque…". Es la misma línea
 *    que traza `diagnosticoPartida.ts`: se afirma lo comprobable.
 */

export type Mensaje = { role: "system" | "user" | "assistant"; content: string };

/** Tono y límites. Se repite en las dos conversaciones porque manda siempre. */
const SISTEMA = [
  "Eres el asistente de un sistema de conciliación bancaria para pymes peruanas.",
  "Quien te lee NO es contador: usa lenguaje simple, español de Perú, y tutea.",
  "",
  "REGLAS:",
  "- No inventes NINGUNA cifra. Solo puedes repetir números que aparezcan en los",
  "  datos que te doy. Si no está ahí, no lo digas.",
  "- No calcules nada. Las cifras ya vienen calculadas.",
  "- No afirmes por qué el motor decidió algo. Describe lo que se observa en los",
  "  datos y qué puede hacer la persona.",
  "- Máximo 3 frases. Vas debajo de un panel que ya muestra el detalle: aporta el",
  "  sentido y qué hacer, no repitas la lista.",
  "- Si no hay nada útil que añadir, dilo en una frase.",
].join("\n");

/**
 * Contexto de la revisión previa (Paso 3).
 *
 * Se devuelve aparte del mensaje porque `verificarCifras` compara contra este
 * string exacto. Verificar contra otra cosa haría que la comprobación dejara de
 * decir lo que promete.
 */
export function contextoRevisionPrevia(hallazgos: Hallazgo[]): string {
  return hallazgos
    .map((h) => `- [${h.severidad}] ${h.titulo}. ${h.detalle}`)
    .join("\n");
}

export function promptRevisionPrevia(hallazgos: Hallazgo[]): {
  mensajes: Mensaje[];
  contexto: string;
} {
  const contexto = contextoRevisionPrevia(hallazgos);
  return {
    contexto,
    mensajes: [
      { role: "system", content: SISTEMA },
      {
        role: "user",
        content: [
          "Voy a iniciar una conciliación. Esto es lo que el sistema comprobó",
          "sobre mis datos:",
          "",
          contexto,
          "",
          "¿Qué significa y qué me conviene hacer antes de conciliar?",
        ].join("\n"),
      },
    ],
  };
}

/** Contexto del diagnóstico de una partida. */
export function contextoPartida(d: Diagnostico): string {
  const ev = d.evidencia
    .map((e) => `  · ${e.fecha} · ${e.monto} · ${e.texto} · ref ${e.referencia}`)
    .join("\n");
  return [
    `Diagnóstico: ${d.codigo}`,
    d.titulo,
    d.detalle,
    d.accion ? `Acción sugerida: ${d.accion}` : "",
    ev ? `Movimientos relacionados:\n${ev}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function promptPartida(d: Diagnostico): {
  mensajes: Mensaje[];
  contexto: string;
} {
  const contexto = contextoPartida(d);
  return {
    contexto,
    mensajes: [
      { role: "system", content: SISTEMA },
      {
        role: "user",
        content: [
          "Una de mis facturas no se concilió. El sistema analizó por qué:",
          "",
          contexto,
          "",
          "Explícamelo en corto y dime qué hago.",
        ].join("\n"),
      },
    ],
  };
}

/** Cuántas preguntas de seguimiento se admiten sobre un mismo diagnóstico. */
export const MAX_TURNOS = 6;

/** Longitud máxima de una pregunta del usuario. */
export const MAX_PREGUNTA = 500;

/**
 * Añade una repregunta a una conversación ya empezada (fase 4).
 *
 * ⚠️ El contexto sigue siendo **el mismo diagnóstico**: el asistente no puede
 * consultar nada más. Un asistente que solo sabe de lo que tienes delante
 * acierta siempre; uno que promete saberlo todo falla el primer día y ya no se
 * vuelve a abrir.
 */
export function promptSeguimiento(
  base: Mensaje[],
  historial: Mensaje[],
  pregunta: string,
): Mensaje[] {
  return [
    ...base,
    ...historial.slice(-MAX_TURNOS * 2),
    { role: "user", content: pregunta.slice(0, MAX_PREGUNTA) },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// El asistente general (/asistente)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A diferencia de los dos asistentes acotados, aquí NO hay un análisis debajo
 * que respalde la respuesta: lo que diga el modelo es lo único que el usuario
 * ve. Eso obliga a ser más estricto, no menos.
 *
 * - Solo puede hablar de lo que devuelvan las herramientas. Si ninguna sirve,
 *   lo dice; no completa el hueco con lo que le suena.
 * - Toda cifra se verifica después contra lo que devolvieron las consultas
 *   (`verificarCifras`), así que inventar no sirve de nada: la respuesta se
 *   descarta entera.
 * - Y dice de dónde salió el dato, para que el usuario pueda ir a comprobarlo.
 *   Una cifra sin sitio donde verificarla es una cifra que hay que creerse.
 */
const SISTEMA_GENERAL = [
  "Eres el asistente de un sistema de conciliación bancaria para pymes peruanas.",
  "Quien te lee NO es contador: usa lenguaje simple, español de Perú, y tutea.",
  "",
  "QUÉ PUEDES HACER:",
  "- Consultar los datos de la empresa con las herramientas disponibles.",
  "- Explicar cómo se usa el sistema.",
  "",
  "REGLAS:",
  "- Para cualquier dato de la empresa, USA UNA HERRAMIENTA. Nunca respondas de",
  "  memoria ni estimes: si no la consultaste, no la sabes.",
  "- No inventes NINGUNA cifra. Solo puedes repetir números que devolvieron las",
  "  consultas. Si no está ahí, no lo digas.",
  "- No calcules totales ni porcentajes nuevos. Usa los que vienen dados.",
  "- Si ninguna herramienta responde lo que te piden, dilo con claridad y sugiere",
  "  dónde mirarlo en el sistema. No rellenes el hueco.",
  "- No puedes hacer cambios: ni aprobar, ni conciliar, ni borrar. Si te lo piden,",
  "  explica dónde se hace.",
  "- Di siempre en qué pantalla puede comprobar el dato (Por cobrar, Por pagar,",
  "  Resumen, Reportes, Conciliaciones).",
  "- Máximo 5 frases, salvo que te pidan detalle.",
  "",
  COMO_FUNCIONA,
].join("\n");

/** Arranque del chat general. El historial se añade con `promptSeguimiento`. */
export function promptGeneral(pregunta: string): Mensaje[] {
  return [
    { role: "system", content: SISTEMA_GENERAL },
    { role: "user", content: pregunta.slice(0, MAX_PREGUNTA) },
  ];
}

/** Turnos de conversación admitidos en el chat general. */
export const MAX_TURNOS_GENERAL = 20;

export function promptGeneralConHistorial(
  historial: Mensaje[],
  pregunta: string,
): Mensaje[] {
  return [
    { role: "system", content: SISTEMA_GENERAL },
    ...historial.slice(-MAX_TURNOS_GENERAL * 2),
    { role: "user", content: pregunta.slice(0, MAX_PREGUNTA) },
  ];
}
