import type { Hallazgo } from "@/lib/diagnosticoPrevio";
import type { Diagnostico } from "@/lib/diagnosticoPartida";

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
