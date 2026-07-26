// ── IA (2/2): Adjudicar la respuesta del LLM validando contra candidatos ───
// El LLM eligió, por registro interno, un candidato de la shortlist (o
// "ninguno"). Aquí se valida que el id elegido REALMENTE estaba entre los
// candidatos de ese interno (anti-alucinación fuerte), se fuerza 1-a-1 y se
// agregan como método "ia". Mantiene la misma forma de salida para "Ensamblar".

// El estado (shortlists, pendientes, matches, config) viene de "Candidatos IA".
const prep = $('Candidatos IA').first().json;
const matches = [...(prep.matches ?? [])];
const internos = prep.pendientes_internos ?? [];
const bancarios = prep.pendientes_bancarios ?? [];
const shortlists = prep.shortlists ?? [];
const umbral = Number(prep.config?.umbral_confianza_auto ?? 0.95);

// Mapa id_interno -> { candidatos válidos, categoria por movimiento }.
const candPorInterno = new Map();
for (const s of shortlists) {
  const set = new Set();
  const catPorMov = new Map();
  for (const c of s.candidatos ?? []) {
    set.add(c.id_movimiento);
    catPorMov.set(c.id_movimiento, c.categoria_probable);
  }
  candPorInterno.set(s.id_interno, { set, catPorMov });
}

// Extraer los pares de la respuesta del LLM. Se cubren todas las formas:
//  - AI Agent con Output Parser -> $json.output ya es objeto/array
//  - AI Agent sin parser        -> $json.output es texto (JSON)
//  - HTTP Anthropic             -> $json.content[] con bloque type=text
//  - OpenAI (chat completions)  -> $json.choices[0].message.content
const resp = $json;
let parsed = null;

const directo = resp.output ?? resp.json ?? null;
if (directo && typeof directo === "object") {
  parsed = directo; // ya viene parseado (Output Parser)
} else {
  let texto = "";
  if (Array.isArray(resp.content)) {
    const tb = resp.content.find((b) => b && b.type === "text");
    texto = tb ? tb.text : "";
  } else {
    texto =
      resp.output ??
      resp.text ??
      (resp.choices && resp.choices[0] && resp.choices[0].message
        ? resp.choices[0].message.content
        : "") ??
      "";
  }
  texto = String(texto).trim()
    .replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  try {
    parsed = JSON.parse(texto);
  } catch (e) {
    parsed = null;
  }
}

const pares =
  Array.isArray(parsed) ? parsed : parsed && parsed.pares ? parsed.pares : [];

const idxInt = new Map(internos.map((r, i) => [r.id_interno, i]));
const idxBanc = new Map(bancarios.map((m, j) => [m.id_movimiento, j]));
const intUsado = new Set();
const bancUsado = new Set();

for (const p of pares) {
  const idI = p.id_interno;
  const idB = p.id_movimiento;
  if (!idB || idB === "ninguno") continue;
  const cand = candPorInterno.get(idI);
  if (!cand || !cand.set.has(idB)) continue; // debía estar entre los candidatos
  const i = idxInt.get(idI);
  const j = idxBanc.get(idB);
  if (i == null || j == null || intUsado.has(i) || bancUsado.has(j)) continue;
  const it = internos[i], bc = bancarios[j];
  const confianza = Math.max(0, Math.min(1, Number(p.confianza ?? 0.8)));
  matches.push({
    ids_internos: [idI],
    ids_movimientos: [idB],
    metodo: "ia",
    confianza,
    diferencia_monto: Number((it.monto - bc.monto).toFixed(2)),
    categoria_diferencia: p.categoria ?? cand.catPorMov.get(idB) ?? "requiere_investigacion",
    justificacion: p.justificacion ?? "Sugerido por IA.",
    estado_revision: confianza >= umbral ? "auto" : "pendiente",
  });
  intUsado.add(i);
  bancUsado.add(j);
}

return [{
  json: {
    job_id: prep.job_id,
    metadata: prep.metadata,
    config: prep.config,
    total_internos: prep.total_internos,
    total_bancarios: prep.total_bancarios,
    matches,
    pendientes_internos: internos.filter((_, i) => !intUsado.has(i)),
    pendientes_bancarios: bancarios.filter((_, j) => !bancUsado.has(j)),
  },
}];
