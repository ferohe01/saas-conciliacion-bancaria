/**
 * El guardia del asistente: **ninguna cifra que el modelo no haya recibido.**
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * En este producto el fallo característico no es el error visible: es el número
 * plausible y equivocado. Ya se pagó tres veces —el corte de 1.000 filas de
 * PostgREST, el cuadre que no cerraba por S/ 20, los 541 pares falsos marcados
 * `auto`— y las tres veces el síntoma fue el mismo: una respuesta tranquilizadora
 * y falsa.
 *
 * Un asistente que redacta es exactamente el sitio donde eso vuelve a pasar, y
 * ahora con voz de autoridad. Así que la regla no es "pedirle que no invente"
 * —eso es una esperanza, no un control— sino **comprobarlo antes de enseñarlo**.
 *
 * ── Qué comprueba ──────────────────────────────────────────────────────────
 *
 * Toda cifra de la respuesta tiene que aparecer en el texto que se le mandó. Es
 * deliberadamente estricto: el modelo aquí no calcula nada, solo explica lo que
 * ya calculó Postgres. Si redondea (99,03 % → «99 %») se acepta; si aparece un
 * número que nadie le dio, la respuesta **no se muestra**.
 *
 * ⚠️ Esto es también la razón de que el asistente NO vaya en streaming: hay que
 * tener la respuesta entera para poder verificarla. Enseñarla mientras llega
 * sería enseñar texto sin comprobar, que es justo lo que esto impide.
 */

/** Números sueltos: 1.234,56 · 450,999 · 99.00 · 12 · 0.003 */
const NUMERO = /\d+(?:[.,]\d+)*/g;

/**
 * Enteros pequeños que la prosa usa sin ser un dato ("los dos lados", "tres
 * cosas"). Hasta 12 porque también cubre meses y días de la semana.
 */
const PROSA_MAX = 12;

/** Cuántos decimales se toleran al redondear una cifra del contexto. */
const REDONDEOS = [0, 1, 2];

/** 1,234 · 12,345.67 — coma como separador de miles (formato es-PE de la app). */
const MILES_COMA = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
/** 1.234 · 12.345,67 — punto como separador de miles (formato europeo). */
const MILES_PUNTO = /^\d{1,3}(\.\d{3})+(,\d+)?$/;

/**
 * Convierte un número escrito a sus lecturas posibles.
 *
 * es-PE usa la coma como separador de miles y el punto como decimal
 * (`toLocaleString("es-PE")` da "1,234.50"), pero el modelo puede escribirlo al
 * revés y no queremos rechazar una respuesta correcta por el separador.
 *
 * ⚠️ Cuando la forma es INEQUÍVOCA se toma solo esa lectura. Aceptar siempre
 * las dos abría un agujero real, encontrado por un test: "5,000" se puede leer
 * como 5, y 5 pasaba por la excepción de los enteros pequeños. O sea que
 * cualquier cifra inventada con la coma en el sitio justo se colaba — justo lo
 * que esto existe para impedir.
 */
function valores(token: string): number[] {
  const esPe = Number(token.replace(/,/g, ""));
  const euro = Number(token.replace(/\./g, "").replace(/,/g, "."));

  if (MILES_COMA.test(token)) return Number.isFinite(esPe) ? [esPe] : [];
  if (MILES_PUNTO.test(token)) return Number.isFinite(euro) ? [euro] : [];

  const out = new Set<number>();
  if (Number.isFinite(esPe)) out.add(esPe);
  if (Number.isFinite(euro)) out.add(euro);
  return [...out];
}

function extraer(texto: string): { token: string; valores: number[] }[] {
  return (texto.match(NUMERO) ?? []).map((token) => ({
    token,
    valores: valores(token),
  }));
}

/** Todas las formas admisibles de una cifra del contexto (ella y sus redondeos). */
function admisibles(contexto: string): Set<number> {
  const set = new Set<number>();
  for (const { valores: vs } of extraer(contexto)) {
    for (const v of vs) {
      set.add(v);
      for (const d of REDONDEOS) {
        const f = 10 ** d;
        set.add(Math.round(v * f) / f);
      }
    }
  }
  return set;
}

export type Verificacion = {
  ok: boolean;
  /** Las cifras de la respuesta que nadie le dio al modelo. */
  intrusas: string[];
};

/**
 * ¿Puede enseñarse esta respuesta?
 *
 * `contexto` es el texto EXACTO que se le mandó al modelo. Que sea el mismo
 * string no es un detalle: si se verificara contra otra cosa, la comprobación
 * dejaría de decir lo que promete.
 */
export function verificarCifras(
  respuesta: string,
  contexto: string,
): Verificacion {
  const permitidos = admisibles(contexto);
  const intrusas: string[] = [];

  for (const { token, valores: vs } of extraer(respuesta)) {
    // ⚠️ La excepción de prosa mira el TOKEN, no sus lecturas: si mirara los
    // valores, "5,000" se leería como 5 y se colaría por pequeño.
    const esProsa = /^\d{1,2}$/.test(token) && Number(token) <= PROSA_MAX;
    if (esProsa) continue;
    if (!vs.some((v) => permitidos.has(v))) intrusas.push(token);
  }

  return { ok: intrusas.length === 0, intrusas: [...new Set(intrusas)] };
}
