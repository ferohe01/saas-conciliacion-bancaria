import type {
  EjemploAprendizaje,
  MovimientoBancario,
  RegistroInterno,
} from "@/lib/contract/payload";
import { normRef } from "@/lib/normalizacion/referencia";
import { palabras } from "./texto";
import { MS_DIA, type ConfigMotor, type Etapa } from "./tipos";

/**
 * Etapa clave antes de la IA: GENERACIÓN DE CANDIDATOS + prompt.
 *
 * Por cada registro interno pendiente arma una lista corta (top-K) de los
 * movimientos bancarios más relevantes, con features y score (blocking +
 * scoring). El LLM luego solo ADJUDICA sobre esta shortlist (elige el mejor o
 * "ninguno") — no busca a ciegas.
 */

export type Candidato = {
  id_movimiento: string;
  glosa: string;
  fecha: string;
  monto: number;
  dif: number;
  dias: number;
  palabras_comunes: string[];
  comparte_ref: boolean;
  score: number;
  categoria_probable: string;
};

export type Shortlist = {
  id_interno: string;
  fecha: string;
  monto: number;
  nombre: string;
  referencia: string;
  candidatos: Candidato[];
};

export type PreparacionIa = {
  /**
   * SOLO las consultadas: la adjudicación valida la respuesta contra estas, y
   * aceptar un par sobre algo que el modelo no vio sería aceptar una invención.
   */
  shortlists: Shortlist[];
  /**
   * Cuántos registros con candidato NO se le preguntaron al modelo. Callarlo
   * daría a entender que la IA los revisó y no encontró nada.
   */
  shortlistsOmitidas: number;
  system: string;
  user: string;
};

/**
 * ⚠️ CUÁNTOS registros se le pasan al LLM de una vez. Con el residuo de una
 * recaudadora —4.382 internos— el prompt salía de 4,7 MB y ~1,2 MILLONES de
 * tokens. La IA está para adjudicar casos dudosos, no para revisar todo lo que
 * sobró: la mayoría no tiene ningún candidato plausible.
 */
const MAX_CONSULTAS_POR_DEFECTO = 150;
/** Por debajo de esto no hay duda que adjudicar: es ruido. */
const SCORE_MINIMO = 0.35;

// Referencias en texto libre: token con ≥1 letra y ≥1 dígito, longitud ≥4. En
// una glosa un número suelto puede ser un importe o una fecha.
const esRefToken = (t: string) => t.length >= 4 && /[A-Z]/.test(t) && /[0-9]/.test(t);
const refsDeTexto = (texto: unknown, set: Set<string>) => {
  for (const tok of String(texto ?? "").toUpperCase().split(/[^A-Z0-9]+/)) {
    if (esRefToken(tok)) set.add(tok);
  }
};
const limpiarRef = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
// ⚠️⚠️ El CAMPO de referencia es una referencia POR DEFINICIÓN: el usuario lo
// dijo al mapear esa columna. Exigirle letra + dígito descartaba los códigos de
// operación PERUANOS, que son numéricos (30010182): `comparteRef` no se cumplía
// nunca y toda retención/detracción quedaba fuera de la banda de monto. En una
// prueba de 233 × 221 el LLM recibió CERO shortlists.
//
// La forma canónica se AÑADE a la cruda, nunca la sustituye: así ningún
// candidato que antes aparecía deja de aparecer.
const esRefCampo = (t: string) => t.length >= 4;
const refCampo = (ref: unknown, set: Set<string>) => {
  const c = limpiarRef(String(ref ?? ""));
  if (esRefCampo(c)) set.add(c);
  const k = normRef(ref);
  if (k !== c && esRefCampo(k)) set.add(k);
};
const refsInterno = (it: RegistroInterno) => {
  const s = new Set<string>();
  refCampo(it.referencia, s);
  refsDeTexto(it.descripcion, s);
  return s;
};
const refsBanco = (bc: MovimientoBancario) => {
  const s = new Set<string>();
  refCampo(bc.referencia_banco, s);
  refsDeTexto(bc.glosa, s);
  return s;
};
const intersecta = (a: Set<string>, b: Set<string>) => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};
const catProb = (d: number) =>
  d < 0.005 ? "diferencia_temporal" : d <= 10 ? "comision_bancaria" : "requiere_investigacion";

const SYSTEM_BASE = [
  "Eres un experto en conciliación bancaria peruana. Para cada REGISTRO INTERNO",
  "recibes una lista corta de CANDIDATOS bancarios ya pre-seleccionados (por",
  "monto, fecha y nombre), con features y un score. Tu tarea es ADJUDICAR: por",
  "cada registro interno elige el candidato que corresponde a la MISMA",
  'transacción real, o "ninguno" si ninguno es convincente.',
  "",
  "Reglas:",
  "- Elige a lo sumo UN candidato por registro interno (usa su id_movimiento).",
  "- Un movimiento bancario no debe usarse para dos registros distintos.",
  "- Debe haber correspondencia de identidad (nombre) y coherencia de monto/fecha.",
  '- Si dudas, responde "ninguno". Prefiere precisión sobre cobertura.',
  "- La fecha puede diferir bastante (el depósito llega tarde); prioriza monto y",
  "  nombre por sobre la cercanía de fecha.",
  "- Clasifica la diferencia en `categoria`, una de: comision_bancaria,",
  "  pago_parcial, diferencia_temporal, diferencia_moneda, redondeo,",
  "  requiere_investigacion.",
  "",
  'Responde ÚNICAMENTE JSON: {"pares":[{"id_interno":"...","id_movimiento":"...',
  ' o ninguno","confianza":0.0,"categoria":"...","justificacion":"..."}]}.',
  "Sin texto fuera del JSON, sin ```.",
].join("\n");

export function prepararIa(
  prev: Etapa,
  config: ConfigMotor,
  ejemplos: EjemploAprendizaje[] = [],
  criterios: string[] = [],
): PreparacionIa {
  const internos = prev.pendientesInternos;
  const bancarios = prev.pendientesBancarios;
  const tolIa = Number(config.tolerancia_ia_monto ?? 10);
  const maxConsultas = Number(config.max_consultas_ia ?? MAX_CONSULTAS_POR_DEFECTO);
  const K = Number(config.top_k_candidatos ?? 3);
  const ventana = Number(config.ventana_ia_dias ?? 30);

  // Precálculo por movimiento: refs, tokens de la glosa y timestamp, UNA vez.
  const refsBc = bancarios.map(refsBanco);
  const palBc = bancarios.map((bc) => new Set(palabras(bc.glosa)));
  const tBc = bancarios.map((bc) => Date.parse(bc.fecha));

  // Índices del prefiltro: un candidato tiene que compartir un token de
  // REFERENCIA o una palabra del nombre, así que se buscan.
  const porRefBc = new Map<string, number[]>();
  const porPalBc = new Map<string, number[]>();
  const meter = (map: Map<string, number[]>, k: string, bi: number) => {
    const lista = map.get(k);
    if (lista) lista.push(bi);
    else map.set(k, [bi]);
  };
  for (let bi = 0; bi < bancarios.length; bi++) {
    for (const t of refsBc[bi]!) meter(porRefBc, t, bi);
    for (const w of palBc[bi]!) meter(porPalBc, w, bi);
  }

  const shortlists: Shortlist[] = [];
  for (const it of internos) {
    const refsIt = refsInterno(it);
    const palIt = palabras(it.contraparte);
    const setIt = new Set(palIt);
    const tIt = Date.parse(it.fecha);
    const cands: Candidato[] = [];

    const posibles = new Set<number>();
    for (const t of refsIt) for (const bi of porRefBc.get(t) ?? []) posibles.add(bi);
    for (const w of setIt) for (const bi of porPalBc.get(w) ?? []) posibles.add(bi);

    // En orden creciente: el mismo resultado que recorriendo la lista entera.
    for (const bi of [...posibles].sort((a, b) => a - b)) {
      const bc = bancarios[bi]!;
      if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
      const d = Math.abs((tIt - tBc[bi]!) / MS_DIA);
      if (d > ventana) continue;
      const difAbs = Math.abs(it.monto - bc.monto);
      const comparteRef = intersecta(refsIt, refsBc[bi]!);
      // Compartir referencia salta la banda de monto: es lo que deja llegar al
      // modelo una retención que solo difiere en el importe.
      if (!comparteRef && difAbs > tolIa) continue;
      const comunes = [...new Set(palIt.filter((w) => palBc[bi]!.has(w)))];
      if (!comparteRef && !comunes.length) continue;
      // Jaccard SIN construir la unión: |A∪B| = |A| + |B| − |A∩B|.
      const union = setIt.size + palBc[bi]!.size - comunes.length;
      const sim = union ? comunes.length / union : 0;
      const cercM = 1 - Math.min(difAbs / (tolIa || 1), 1);
      const cercF = 1 - Math.min(d / (ventana || 1), 1);
      const score = Number(
        Math.min(1, 0.5 * sim + 0.3 * cercM + 0.2 * cercF + (comparteRef ? 0.4 : 0)).toFixed(3),
      );
      cands.push({
        id_movimiento: bc.id_movimiento,
        glosa: bc.glosa ?? "",
        fecha: bc.fecha,
        monto: bc.monto,
        dif: Number((it.monto - bc.monto).toFixed(2)),
        dias: d,
        palabras_comunes: comunes,
        comparte_ref: comparteRef,
        score,
        categoria_probable: catProb(difAbs),
      });
    }
    cands.sort((a, b) => b.score - a.score);
    if (cands.length) {
      shortlists.push({
        id_interno: it.id_interno,
        fecha: it.fecha,
        monto: it.monto,
        nombre: it.contraparte ?? it.descripcion ?? "",
        referencia: it.referencia ?? "",
        candidatos: cands.slice(0, K),
      });
    }
  }

  // Bloque few-shot: patrones aprendidos de decisiones humanas reales. El
  // motivo del rechazo es lo que convierte "este par estaba mal" en "estaba mal
  // PORQUE el nombre no calzaba".
  const fewShot = ejemplos.length
    ? [
        "",
        "DECISIONES HUMANAS PREVIAS (aprende el criterio de esta empresa; fíjate en el",
        "patrón, no en los nombres puntuales):",
        ...ejemplos.map(
          (e) =>
            `- [${String(e.decision).toUpperCase()}] interno {${e.interno}} ↔ banco {${e.banco}}` +
            (e.categoria ? ` (${e.categoria})` : "") +
            (e.motivo ? ` — rechazado porque ${e.motivo}` : ""),
        ),
        "Calibra tu criterio con estos ejemplos (p. ej. si suelen ACEPTAR pese a una",
        "comisión, o RECHAZAR cuando el nombre no calza pese a montos iguales). No los",
        "copies a ciegas: aplícalos solo cuando el caso sea análogo.",
      ].join("\n")
    : "";
  // Criterio DECLARADO: su propia sección y otro peso. Es lo que dicen que
  // hacen, no lo que hicieron; con decisiones reales, mandan las decisiones.
  const declarado = criterios.length
    ? [
        "",
        "CRITERIO DECLARADO POR LA EMPRESA (lo que dicen de su operacion; util",
        "cuando aun hay pocas decisiones previas, pero SI hay decisiones previas",
        "esas mandan sobre esto):",
        ...criterios.map((c) => `- ${c}`),
      ].join("\n")
    : "";

  // Se pregunta por los casos con DUDA REAL, y solo por los mejores: ordenar
  // por el mejor score y cortar convierte un prompt imposible en unos pocos KB.
  const conDuda = shortlists.filter((s) => (s.candidatos[0]?.score ?? 0) >= SCORE_MINIMO);
  conDuda.sort((a, b) => (b.candidatos[0]?.score ?? 0) - (a.candidatos[0]?.score ?? 0));
  const consultadas = conDuda.slice(0, maxConsultas);

  return {
    shortlists: consultadas,
    shortlistsOmitidas: shortlists.length - consultadas.length,
    system: SYSTEM_BASE + declarado + fewShot,
    user: `Tolerancias: ${JSON.stringify(config)}\n\nCandidatos por registro interno:\n${JSON.stringify(consultadas)}`,
  };
}
