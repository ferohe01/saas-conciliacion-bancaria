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
// Referencias: token alfanumérico con >=1 letra y >=1 dígito, longitud >=4.
// Se extraen del campo de referencia y del texto libre (glosa/descripción).
const esRefToken = (t) => t.length >= 4 && /[A-Z]/.test(t) && /[0-9]/.test(t);
const refsDeTexto = (texto, set) => {
  for (const tok of String(texto ?? "").toUpperCase().split(/[^A-Z0-9]+/)) if (esRefToken(tok)) set.add(tok);
};
// Forma canonica de la referencia: la misma de 01_exacta.js / ref_norm. Se
// aniade ADEMAS de la cruda, nunca en su lugar: asi ningun candidato que antes
// aparecia deja de aparecer, y los `WIN-S001-...` del ERP alcanzan a los
// `S001-...` del banco.
const limpiarRef = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const canonRef = (r) => {
  const s = String(r ?? "").trim();
  if (s === "") return "";
  const resto = s.replace(/^[A-Za-z]+[-_/ ]+/, "");
  if (resto !== s && /[A-Za-z]/.test(resto) && /[0-9]/.test(resto)
      && limpiarRef(resto).length >= 6) {
    return limpiarRef(resto);
  }
  return limpiarRef(s);
};
// ⚠️⚠️ El CAMPO de referencia es una referencia POR DEFINICION: el usuario lo
// dijo al mapear esa columna. `esRefToken` exige una letra y un digito —bien
// para extraer codigos de un texto libre, donde un numero suelto puede ser un
// importe o una fecha— pero aplicado al campo descarta los codigos de operacion
// PERUANOS, que son puramente numericos (30010182).
//
// Con eso, `comparteRef` no se cumplia nunca y la etapa de candidatos perdia su
// unico vinculo fuerte: toda retencion, detraccion o percepcion —que comparte
// codigo con su movimiento y solo difiere en el importe— quedaba fuera de la
// banda de monto y jamas llegaba al modelo. En una prueba de 233 x 221 el LLM
// recibio CERO shortlists y contesto, con razon, que no habia ningun par.
const esRefCampo = (t) => t.length >= 4;
const refCampo = (ref, set) => {
  const c = limpiarRef(String(ref ?? "")); if (esRefCampo(c)) set.add(c);
  const k = canonRef(ref); if (k !== c && esRefCampo(k)) set.add(k);
};
const refsInterno = (it) => { const s = new Set(); refCampo(it.referencia, s); refsDeTexto(it.descripcion, s); return s; };
const refsBanco = (bc) => { const s = new Set(); refCampo(bc.referencia_banco, s); refsDeTexto(bc.glosa, s); return s; };
const intersecta = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
const dias = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const catProb = (d) =>
  d < 0.005 ? "diferencia_temporal" : d <= 10 ? "comision_bancaria" : "requiere_investigacion";

function generarCandidatos(ints, bancs, tolIaMonto, ventana, K) {
  const out = [];
  const refsBc = bancs.map((bc) => refsBanco(bc));
  for (const it of ints) {
    const refsIt = refsInterno(it);
    const cands = [];
    for (let bi = 0; bi < bancs.length; bi++) {
      const bc = bancs[bi];
      if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
      const d = dias(it.fecha, bc.fecha);
      if (d > ventana) continue;
      const difAbs = Math.abs(it.monto - bc.monto);
      const comparteRef = intersecta(refsIt, refsBc[bi]);
      const comunes = comunesEntre(it.contraparte, bc.glosa);
      // Si comparte referencia, es candidato aunque no comparta nombre ni esté
      // en la banda de monto. Si no, exige nombre Y banda de monto.
      if (!comparteRef) {
        if (!comunes.length) continue;
        if (difAbs > tolIaMonto) continue;
      }
      const sim = jaccard(it.contraparte, bc.glosa);
      const cercM = 1 - Math.min(difAbs / (tolIaMonto || 1), 1);
      const cercF = 1 - Math.min(d / (ventana || 1), 1);
      const score = Number(Math.min(1, 0.5 * sim + 0.3 * cercM + 0.2 * cercF + (comparteRef ? 0.4 : 0)).toFixed(3));
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
