// ── Etapa clave: GENERACIÓN DE CANDIDATOS + prompt para el LLM ─────────────
// Prepara, por cada registro interno pendiente, una lista corta (top-K) de los
// movimientos bancarios más relevantes, con features y score (blocking +
// scoring). El LLM luego solo ADJUDICA sobre esta shortlist (elige el mejor o
// "ninguno") — no busca a ciegas. Nombra este nodo exactamente "Candidatos IA"
// (el nodo de parseo lo referencia por ese nombre).

const prev = $json;
const internos = prev.pendientes_internos ?? [];
const bancarios = prev.pendientes_bancarios ?? [];
const cfg = prev.config ?? {};
// Few-shot dinámico: ejemplos de decisiones humanas previas (los arma el backend
// y viajan en el payload original del Webhook).
const wh = $('Webhook').first().json;
const ejemplos = ((wh.body ?? wh).ejemplos_aprendizaje) ?? [];
const criterios = ((wh.body ?? wh).criterios_declarados) ?? [];
const tolIa = Number(cfg.tolerancia_ia_monto ?? 10);
// ⚠️ CUANTOS registros se le pasan al LLM de una vez.
//
// La etapa de candidatos se penso para 2.000 partidas, donde la shortlist
// entera cabe en un prompt. Con el residuo de una recaudadora —4.382 internos—
// el prompt salia de 4,7 MB y ~1,2 MILLONES de tokens: ningun modelo lo acepta,
// y si lo aceptara costaria una fortuna por conciliacion.
//
// La IA esta para ADJUDICAR casos dudosos, no para revisar todo lo que sobro.
// La inmensa mayoria de esos 4.382 no tiene ningun candidato plausible —son
// recibos cobrados por otro banco— y preguntarselo al modelo no aporta nada.
// Los que no entran quedan como estan: sin conciliar, esperando criterio
// humano, que es exactamente donde estaban.
const MAX_CONSULTAS = Number(cfg.max_consultas_ia ?? 150);
// Por debajo de esto no hay duda que adjudicar: es ruido.
const SCORE_MINIMO = 0.35;
const K = Number(cfg.top_k_candidatos ?? 3);
const ventana = Number(cfg.ventana_ia_dias ?? 30); // ventana de fecha amplia para IA

// ── Utilidades de matching ────────────────────────────────────────────────
const STOP = new Set([
  "DEPOSITO", "TRANSFERENCIA", "TRANSF", "TRANSFER", "RECIBIDA", "RECIBIDO",
  "ENVIADA", "ENVIADO", "PAGO", "PAGOS", "ABONO", "CARGO", "CUOTA",
  "REPETICION", "DEVOLUCION", "CCE", "INTERBANCARIA", "INTERBANCARIO",
  "OPERACION", "NRO", "REF", "REFERENCIA", "FACTURA", "BOLETA", "SAC", "EIRL",
  "SRL", "DEL", "LOS", "LAS", "POR", "CON",
  "EFECTIVO", "MENSUALIDAD", "MATRICULA", "PENSION", "INSCRIPCION",
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO",
  "SEPTIEMBRE", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
]);
const palabras = (t) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .split(/[^A-Z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const comunesEntre = (a, b) => {
  const B = new Set(palabras(b));
  return [...new Set(palabras(a).filter((w) => B.has(w)))];
};
const jaccard = (a, b) => {
  const A = new Set(palabras(a)), B = new Set(palabras(b));
  if (!A.size && !B.size) return 0;
  let i = 0; for (const t of A) if (B.has(t)) i++;
  const u = new Set([...A, ...B]).size; return u ? i / u : 0;
};
// Referencias: token alfanumérico con >=1 letra y >=1 dígito, longitud >=4.
// Se extraen del campo de referencia y del texto libre (glosa/descripción).
const esRefToken = (t) => t.length >= 4 && /[A-Z]/.test(t) && /[0-9]/.test(t);
const refsDeTexto = (texto, set) => {
  for (const tok of String(texto ?? "").toUpperCase().split(/[^A-Z0-9]+/)) if (esRefToken(tok)) set.add(tok);
};
const refCampo = (ref, set) => {
  const c = String(ref ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); if (esRefToken(c)) set.add(c);
};
const refsInterno = (it) => { const s = new Set(); refCampo(it.referencia, s); refsDeTexto(it.descripcion, s); return s; };
const refsBanco = (bc) => { const s = new Set(); refCampo(bc.referencia_banco, s); refsDeTexto(bc.glosa, s); return s; };
const intersecta = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
const dias = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const catProb = (d) =>
  d < 0.005 ? "diferencia_temporal" : d <= 10 ? "comision_bancaria" : "requiere_investigacion";

const shortlists = [];
// Precálculo por movimiento: refs, tokens de la glosa y timestamp. Antes la
// glosa se re-tokenizaba una vez por cada registro interno (`comunesEntre` y
// `jaccard` dentro del bucle), lo que a volumen alto tumba el runner de n8n
// por inactividad. Esto se calcula UNA vez.
const refsBc = bancarios.map((bc) => refsBanco(bc));
const palBc = bancarios.map((bc) => new Set(palabras(bc.glosa)));
const tBc = bancarios.map((bc) => Date.parse(bc.fecha));
const MS_DIA = 86400000;

// Indices del prefiltro. Un candidato tiene que compartir un token de
// REFERENCIA o una palabra del nombre, asi que no hace falta recorrer los
// 3.204 movimientos por cada uno de los 4.382 internos: se buscan.
//
// No cambia la semantica —el conjunto que sale de los indices es exactamente
// el que pasaba el filtro— pero evita construir dos estructuras nuevas por cada
// uno de los 14 millones de pares, que es lo que abortaba el runner de n8n.
const porRefBc = new Map();
const porPalBc = new Map();
for (let bi = 0; bi < bancarios.length; bi++) {
  for (const t of refsBc[bi]) {
    if (!porRefBc.has(t)) porRefBc.set(t, []);
    porRefBc.get(t).push(bi);
  }
  for (const w of palBc[bi]) {
    if (!porPalBc.has(w)) porPalBc.set(w, []);
    porPalBc.get(w).push(bi);
  }
}

for (const it of internos) {
  const refsIt = refsInterno(it);
  const palIt = palabras(it.contraparte);
  const setIt = new Set(palIt);
  const tIt = Date.parse(it.fecha);
  const cands = [];

  // Candidatos posibles, por indice. Se recorren en orden creciente para que el
  // resultado sea el mismo que recorriendo la lista entera.
  const posibles = new Set();
  for (const t of refsIt) { const l = porRefBc.get(t); if (l) for (const bi of l) posibles.add(bi); }
  for (const w of setIt) { const l = porPalBc.get(w); if (l) for (const bi of l) posibles.add(bi); }

  for (const bi of [...posibles].sort((a, b) => a - b)) {
    const bc = bancarios[bi];
    if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
    const d = Math.abs((tIt - tBc[bi]) / MS_DIA);
    if (d > ventana) continue;
    const difAbs = Math.abs(it.monto - bc.monto);
    const comparteRef = intersecta(refsIt, refsBc[bi]);
    // La banda de monto se comprueba ANTES de construir nada: descarta la
    // mayoria de los pares sin asignar memoria.
    if (!comparteRef && difAbs > tolIa) continue;
    // Tokens ya calculados: solo se intersectan.
    const comunes = [...new Set(palIt.filter((w) => palBc[bi].has(w)))];
    // Si comparte referencia, es candidato aunque no comparta nombre ni esté en
    // la banda de monto. Si no, exige nombre Y banda de monto.
    if (!comparteRef && !comunes.length) continue;
    // Jaccard SIN construir la union: |A∪B| = |A| + |B| − |A∩B|. Antes se hacia
    // `new Set([...a, ...b]).size` por cada par, o sea millones de copias.
    const union = setIt.size + palBc[bi].size - comunes.length;
    const sim = union ? comunes.length / union : 0;
    const cercM = 1 - Math.min(difAbs / (tolIa || 1), 1);
    const cercF = 1 - Math.min(d / (ventana || 1), 1);
    const score = Number(Math.min(1, 0.5 * sim + 0.3 * cercM + 0.2 * cercF + (comparteRef ? 0.4 : 0)).toFixed(3));
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

// ── Prompt para el LLM (adjudicación) ─────────────────────────────────────
const system = [
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

// Bloque few-shot: patrones aprendidos de decisiones humanas reales. Los nombres
// cambian entre períodos; lo que se aprende es CUÁNTO tolera la empresa en
// monto/fecha/nombre y cuándo rechaza. Formato: monto · nombre · fecha.
const fewShot = ejemplos.length
  ? [
      "",
      "DECISIONES HUMANAS PREVIAS (aprende el criterio de esta empresa; fíjate en el",
      "patrón, no en los nombres puntuales):",
      // El motivo del rechazo es lo que convierte "este par estaba mal" en
      // "estaba mal PORQUE el nombre no calzaba": sin él, el ejemplo negativo
      // solo enseña a evitar ese par concreto, que no se va a repetir nunca.
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
// Criterio DECLARADO por la empresa. Va en su propia seccion y con otro peso:
// es lo que dicen que hacen, no lo que hicieron. Cuando ya hay decisiones
// reales, mandan las decisiones — y el texto se lo dice al modelo.
const declarado = criterios.length
  ? [
      "",
      "CRITERIO DECLARADO POR LA EMPRESA (lo que dicen de su operacion; util",
      "cuando aun hay pocas decisiones previas, pero SI hay decisiones previas",
      "esas mandan sobre esto):",
      ...criterios.map((c) => `- ${c}`),
    ].join("\n")
  : "";

const systemFinal = system + declarado + fewShot;

// Se le pregunta a la IA por los casos con DUDA REAL, y solo por los mejores.
// Ordenar por el mejor score y cortar es lo que convierte un prompt imposible
// en uno de unos pocos KB.
const conDuda = shortlists.filter((s) => (s.candidatos[0]?.score ?? 0) >= SCORE_MINIMO);
conDuda.sort((a, b) => (b.candidatos[0]?.score ?? 0) - (a.candidatos[0]?.score ?? 0));
const consultadas = conDuda.slice(0, MAX_CONSULTAS);
const omitidas = shortlists.length - consultadas.length;

const user = `Tolerancias: ${JSON.stringify(cfg)}\n\nCandidatos por registro interno:\n${JSON.stringify(consultadas)}`;

// NOTA: aquí vivía `ia_body`, un cuerpo con forma de la API de Anthropic para
// un nodo HTTP Request alternativo. Se retiró: ningún nodo lo consumía, tenía
// cableado un modelo que ya no es el configurado, y su forma no sirve para
// OpenAI. Dejarlo era invitar a que alguien lo enchufara y se llevara una
// llamada rota. El flujo usa `ia_system` / `ia_user` con el nodo AI Agent.

return [{
  json: {
    job_id: prev.job_id,
    metadata: prev.metadata,
    config: prev.config,
    total_internos: prev.total_internos,
    total_bancarios: prev.total_bancarios,
    matches: prev.matches,
    pendientes_internos: internos,
    pendientes_bancarios: bancarios,
    // Solo las consultadas: el nodo de parseo valida la respuesta contra
    // ESTAS, y aceptar una adjudicacion sobre algo que el modelo no vio seria
    // aceptar una invencion.
    shortlists: consultadas,
    // Cuantos registros con candidato NO se le preguntaron al modelo. Se
    // reporta para que la pantalla pueda decirlo: callarlo daria a entender que
    // la IA los reviso y no encontro nada.
    shortlists_omitidas: omitidas,
    ejemplos_aprendizaje: ejemplos, // trazabilidad del few-shot usado
    criterios_declarados: criterios, // trazabilidad de la semilla en frio
    ia_system: systemFinal, // nodo AI Agent (systemMessage)
    ia_user: user, // nodo AI Agent (prompt)
  },
}];
