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
  "Eres el asistente de un sistema de conciliación bancaria para empresas peruanas.",
  // ⚠️ Antes decía «quien te lee NO es contador». Era cierto cuando el producto
  // se dirigía solo a PyMEs y es falso con una empresa grande, que sí tiene
  // área contable. Se conserva el compromiso de lenguaje simple —que beneficia
  // a los dos— sin afirmar algo que ya no se sostiene.
  "Escribe en lenguaje simple y directo, en español de Perú, y tutea. Puede leerte un contador o alguien que no lo es.",
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
/**
 * Hoy, en el calendario de Lima.
 *
 * ⚠️ Sin esta línea el modelo **no sabe en qué día vive**: «este mes» y «el mes
 * pasado» son irresolubles, y al pedirle «junio» tiene que adivinar el año.
 * Con cifras de millones sobre la mesa, adivinar el año es exactamente la clase
 * de error plausible y silencioso que este producto no puede permitirse.
 *
 * Se ancla a `America/Lima` y no a la hora del servidor por el mismo motivo por
 * el que `traerResumenSaldos` manda `p_hoy` en vez de dejar que Postgres use
 * `current_date`: el servidor puede estar en otra zona, y el día 1 de cada mes
 * la diferencia cambia la respuesta.
 */
function hoyEnLima(ahora: Date): string {
  return ahora.toLocaleDateString("sv-SE", { timeZone: "America/Lima" });
}

function sistemaGeneral(hoy: string): string {
  return [
    "Eres el asistente de un sistema de conciliación bancaria para empresas peruanas.",
    // Ver la nota de `SISTEMA`: quien lee puede ser contador o no serlo.
    "Escribe en lenguaje simple y directo, en español de Perú, y tutea. Puede leerte un contador o alguien que no lo es.",
    "",
    `HOY ES ${hoy}. Resuelve con esta fecha «este mes», «el mes pasado», «el año`,
    "pasado» y cualquier período relativo. Nunca supongas el año.",
    "",
    "QUÉ PUEDES HACER:",
    "- Consultar los datos de la empresa con las herramientas disponibles.",
    "- Explicar cómo se usa el sistema.",
    "",
    "DE QUÉ NO HABLAS:",
    "- Solo de este sistema y de los datos de esta empresa. Si te preguntan de",
    "  historia, política, cultura general o cualquier cosa ajena, responde",
    "  exactamente: «Solo puedo ayudarte con tus cobros, tus pagos y tus",
    "  conciliaciones.» y nada más. No respondas la pregunta ni aunque la sepas.",
    "",
    "REGLAS:",
    "- Para cualquier dato de la empresa, USA UNA HERRAMIENTA. Nunca respondas de",
    "  memoria ni estimes: si no la consultaste, no la sabes.",
    "- No inventes NINGUNA cifra. Solo puedes repetir números que devolvieron las",
    "  consultas. Si no está ahí, no lo digas.",
    "- No calcules totales ni porcentajes nuevos. Usa los que vienen dados.",
    "- Cuando des cifras de un período, DI EL PERÍODO EXACTO que consultaste",
    "  (por ejemplo «del 01/06/2026 al 30/06/2026»). Un importe sin su rango no",
    "  se puede comprobar.",
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
}

/** Arranque del chat general. El historial se añade con `promptSeguimiento`. */
export function promptGeneral(pregunta: string, ahora = new Date()): Mensaje[] {
  return promptGeneralConHistorial([], pregunta, ahora);
}

/** Turnos de conversación admitidos en el chat general. */
export const MAX_TURNOS_GENERAL = 20;

export function promptGeneralConHistorial(
  historial: Mensaje[],
  pregunta: string,
  ahora = new Date(),
): Mensaje[] {
  return [
    { role: "system", content: sistemaGeneral(hoyEnLima(ahora)) },
    ...historial.slice(-MAX_TURNOS_GENERAL * 2),
    { role: "user", content: pregunta.slice(0, MAX_PREGUNTA) },
  ];
}
