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
const tolIa = Number(cfg.tolerancia_ia_monto ?? 10);
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
const refsBc = bancarios.map((bc) => refsBanco(bc));

for (const it of internos) {
  const refsIt = refsInterno(it);
  const cands = [];
  for (let bi = 0; bi < bancarios.length; bi++) {
    const bc = bancarios[bi];
    if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
    const d = dias(it.fecha, bc.fecha);
    if (d > ventana) continue;
    const difAbs = Math.abs(it.monto - bc.monto);
    const comparteRef = intersecta(refsIt, refsBc[bi]);
    const comunes = comunesEntre(it.contraparte, bc.glosa);
    // Si comparte referencia, es candidato aunque no comparta nombre ni esté en
    // la banda de monto. Si no, exige nombre Y banda de monto.
    if (!comparteRef) {
      if (!comunes.length) continue;
      if (difAbs > tolIa) continue;
    }
    const sim = jaccard(it.contraparte, bc.glosa);
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
      ...ejemplos.map(
        (e) =>
          `- [${String(e.decision).toUpperCase()}] interno {${e.interno}} ↔ banco {${e.banco}}` +
          (e.categoria ? ` (${e.categoria})` : ""),
      ),
      "Calibra tu criterio con estos ejemplos (p. ej. si suelen ACEPTAR pese a una",
      "comisión, o RECHAZAR cuando el nombre no calza pese a montos iguales). No los",
      "copies a ciegas: aplícalos solo cuando el caso sea análogo.",
    ].join("\n")
  : "";
const systemFinal = system + fewShot;

const user = `Tolerancias: ${JSON.stringify(cfg)}\n\nCandidatos por registro interno:\n${JSON.stringify(shortlists)}`;

const ia_body = {
  model: "claude-opus-4-8",
  max_tokens: 8000,
  system: systemFinal,
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
    ejemplos_aprendizaje: ejemplos, // trazabilidad del few-shot usado
    ia_body, // nodo HTTP Request (alternativa)
    ia_system: systemFinal, // nodo AI Agent (systemMessage)
    ia_user: user, // nodo AI Agent (prompt)
  },
}];
