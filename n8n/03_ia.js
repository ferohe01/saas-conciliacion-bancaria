// ── Capa 3: IA sobre CANDIDATOS (ruta heurística, sin LLM) ─────────────────
// Etapa de preparación de candidatos (blocking + features + score + top-K) y
// luego adjudicación: toma el mejor candidato por score de forma greedy.
// (La ruta con LLM real vive en workflow_conciliacion_ia.json.)

const prev = $json;
const { job_id, metadata, config, total_internos, total_bancarios } = prev;
const matches = [...prev.matches];
const internos = prev.pendientes_internos ?? [];
const bancarios = prev.pendientes_bancarios ?? [];

const tolIa = Number(config?.tolerancia_ia_monto ?? 10);
const umbral = Number(config?.umbral_confianza_auto ?? 0.95);
const topK = Number(config?.top_k_candidatos ?? 3);
const ventanaIa = Number(config?.ventana_ia_dias ?? 30);

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
const normRef = (r) => String(r ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const dias = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const catProb = (d) =>
  d < 0.005 ? "diferencia_temporal" : d <= 10 ? "comision_bancaria" : "requiere_investigacion";

function generarCandidatos(ints, bancs, tolIaMonto, ventana, K) {
  const out = [];
  for (const it of ints) {
    const cands = [];
    for (const bc of bancs) {
      if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
      const difAbs = Math.abs(it.monto - bc.monto);
      if (difAbs > tolIaMonto) continue;
      const d = dias(it.fecha, bc.fecha);
      if (d > ventana) continue;
      const comunes = comunesEntre(it.contraparte, bc.glosa);
      const refI = normRef(it.referencia);
      const comparteRef = refI.length > 0 && refI === normRef(bc.referencia_banco);
      // Candidato si comparte nombre O si la referencia coincide exacta.
      if (!comunes.length && !comparteRef) continue;
      const sim = jaccard(it.contraparte, bc.glosa);
      const cercM = 1 - Math.min(difAbs / (tolIaMonto || 1), 1);
      const cercF = 1 - Math.min(d / (ventana || 1), 1);
      const score = Number(Math.min(1, 0.5 * sim + 0.3 * cercM + 0.2 * cercF + (comparteRef ? 0.2 : 0)).toFixed(3));
      cands.push({
        id_movimiento: bc.id_movimiento,
        dif: Number((it.monto - bc.monto).toFixed(2)),
        dif_abs: Number(difAbs.toFixed(2)),
        dias: d,
        palabras_comunes: comunes,
        score,
        categoria_probable: catProb(difAbs),
      });
    }
    cands.sort((a, b) => b.score - a.score);
    if (cands.length) out.push({ id_interno: it.id_interno, candidatos: cands.slice(0, K) });
  }
  return out;
}

// ── Adjudicación greedy por score ─────────────────────────────────────────
const shortlists = generarCandidatos(internos, bancarios, tolIa, ventanaIa, topK);
const idxInt = new Map(internos.map((r, i) => [r.id_interno, i]));
const idxBanc = new Map(bancarios.map((m, j) => [m.id_movimiento, j]));
const intUsado = new Set();
const bancUsado = new Set();

const propuestas = shortlists
  .map((s) => ({ id: s.id_interno, best: s.candidatos[0] }))
  .filter((p) => p.best && p.best.score >= 0.4)
  .sort((a, b) => b.best.score - a.best.score);

for (const p of propuestas) {
  const i = idxInt.get(p.id);
  const j = idxBanc.get(p.best.id_movimiento);
  if (i == null || j == null || intUsado.has(i) || bancUsado.has(j)) continue;
  const it = internos[i], bc = bancarios[j];
  const confianza = Math.min(0.94, Math.max(0.6, p.best.score));
  matches.push({
    ids_internos: [it.id_interno],
    ids_movimientos: [bc.id_movimiento],
    metodo: "ia",
    confianza,
    diferencia_monto: p.best.dif,
    categoria_diferencia: p.best.categoria_probable,
    justificacion: `Candidato IA: nombre (${p.best.palabras_comunes.join(", ")}), dif. ${p.best.dif_abs}, ${p.best.dias} día(s) (score ${p.best.score}).`,
    estado_revision: confianza >= umbral ? "auto" : "pendiente",
  });
  intUsado.add(i);
  bancUsado.add(j);
}

return [{
  json: {
    job_id, metadata, config, total_internos, total_bancarios, matches,
    pendientes_internos: internos.filter((_, i) => !intUsado.has(i)),
    pendientes_bancarios: bancarios.filter((_, j) => !bancUsado.has(j)),
  },
}];
