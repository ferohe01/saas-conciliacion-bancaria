// ── IA real (2/2): Parsear respuesta del LLM y fusionar ───────────────────
// Lee la respuesta de Claude, valida los pares contra los IDs realmente
// pendientes (descarta cualquier ID inventado), fuerza 1-a-1 y mismo signo,
// y los agrega a `matches` como método "ia". Mantiene la MISMA forma de salida
// que la capa heurística, así el nodo "Ensamblar resultado" no cambia.

// El estado (pendientes, matches, config...) viene del nodo "Preparar IA".
const prep = $('Preparar IA').first().json;
const matches = [...(prep.matches ?? [])];
const internos = prep.pendientes_internos ?? [];
const bancarios = prep.pendientes_bancarios ?? [];
const umbral = Number(prep.config?.umbral_confianza_auto ?? 0.95);

// Extraer el texto JSON de la respuesta de Anthropic (bloque type=text).
const resp = $json;
let texto = "";
if (Array.isArray(resp.content)) {
  const tb = resp.content.find((b) => b && b.type === "text");
  texto = tb ? tb.text : "";
} else {
  texto =
    resp.text ??
    resp.output ??
    (resp.choices && resp.choices[0] && resp.choices[0].message
      ? resp.choices[0].message.content
      : "") ??
    "";
}
texto = String(texto)
  .trim()
  .replace(/^```json/i, "")
  .replace(/^```/, "")
  .replace(/```$/, "")
  .trim();

let pares = [];
try {
  const parsed = JSON.parse(texto);
  pares = Array.isArray(parsed) ? parsed : parsed.pares ?? [];
} catch (e) {
  pares = [];
}

const intById = new Map(internos.map((r, i) => [r.id_interno, i]));
const bancById = new Map(bancarios.map((m, j) => [m.id_movimiento, j]));
const intUsado = new Set();
const bancUsado = new Set();

for (const p of pares) {
  const idI = p.id_interno;
  const idB = p.id_movimiento;
  if (!intById.has(idI) || !bancById.has(idB)) continue; // ignora IDs inventados
  const i = intById.get(idI);
  const j = bancById.get(idB);
  if (intUsado.has(i) || bancUsado.has(j)) continue; // 1 a 1
  const it = internos[i];
  const bc = bancarios[j];
  if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue; // seguridad de signo
  const confianza = Math.max(0, Math.min(1, Number(p.confianza ?? 0.8)));
  matches.push({
    ids_internos: [idI],
    ids_movimientos: [idB],
    metodo: "ia",
    confianza,
    diferencia_monto: Number((it.monto - bc.monto).toFixed(2)),
    categoria_diferencia: "requiere_revision",
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
