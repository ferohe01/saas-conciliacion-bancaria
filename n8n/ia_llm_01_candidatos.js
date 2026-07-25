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
const tolIa = Number(cfg.tolerancia_ia_monto ?? 10);
const tolDias = Number(cfg.tolerancia_dias ?? 3);
const K = 3;

// ── Utilidades de matching ────────────────────────────────────────────────
const STOP = new Set([
  "DEPOSITO", "TRANSFERENCIA", "TRANSF", "TRANSFER", "RECIBIDA", "RECIBIDO",
  "ENVIADA", "ENVIADO", "PAGO", "PAGOS", "ABONO", "CARGO", "CUOTA",
  "REPETICION", "DEVOLUCION", "CCE", "INTERBANCARIA", "INTERBANCARIO",
  "OPERACION", "NRO", "REF", "REFERENCIA", "FACTURA", "BOLETA", "SAC", "EIRL",
  "SRL", "DEL", "LOS", "LAS", "POR", "CON",
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
const normRef = (r) => String(r ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const dias = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const catProb = (d) =>
  d < 0.005 ? "diferencia_temporal" : d <= 10 ? "comision_bancaria" : "requiere_investigacion";

const ventana = tolDias + 4;
const shortlists = [];

for (const it of internos) {
  const cands = [];
  for (const bc of bancarios) {
    if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
    const difAbs = Math.abs(it.monto - bc.monto);
    if (difAbs > tolIa) continue;
    const d = dias(it.fecha, bc.fecha);
    if (d > ventana) continue;
    const comunes = comunesEntre(it.contraparte, bc.glosa);
    if (!comunes.length) continue;
    const sim = jaccard(it.contraparte, bc.glosa);
    const refI = normRef(it.referencia);
    const comparteRef = refI.length > 0 && refI === normRef(bc.referencia_banco);
    const cercM = 1 - Math.min(difAbs / (tolIa || 1), 1);
    const cercF = 1 - Math.min(d / (ventana || 1), 1);
    const score = Number((0.5 * sim + 0.3 * cercM + 0.2 * cercF + (comparteRef ? 0.1 : 0)).toFixed(3));
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
  "- Clasifica la diferencia en `categoria`, una de: comision_bancaria,",
  "  pago_parcial, diferencia_temporal, redondeo, requiere_investigacion.",
  "",
  'Responde ÚNICAMENTE JSON: {"pares":[{"id_interno":"...","id_movimiento":"...',
  ' o ninguno","confianza":0.0,"categoria":"...","justificacion":"..."}]}.',
  "Sin texto fuera del JSON, sin ```.",
].join("\n");

const user = `Tolerancias: ${JSON.stringify(cfg)}\n\nCandidatos por registro interno:\n${JSON.stringify(shortlists)}`;

const ia_body = {
  model: "claude-opus-4-8",
  max_tokens: 8000,
  system,
  messages: [{ role: "user", content: user }],
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["pares"],
        properties: {
          pares: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id_interno", "id_movimiento", "confianza", "categoria", "justificacion"],
              properties: {
                id_interno: { type: "string" },
                id_movimiento: { type: "string" },
                confianza: { type: "number" },
                categoria: { type: "string" },
                justificacion: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

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
    shortlists, // para validar la respuesta del LLM
    ia_body, // nodo HTTP Request (alternativa)
    ia_system: system, // nodo AI Agent (systemMessage)
    ia_user: user, // nodo AI Agent (prompt)
  },
}];
