// ── Capa 3: SUGERENCIAS (heurística tipo IA, con reglas estrictas) ─────────
// Solo sugiere cuando hay señales FUERTES:
//   (a) monto dentro de la banda IA:  |diferencia| <= config.tolerancia_ia_monto
//   (b) al menos 1 palabra en común entre la contraparte (interno) y la glosa
//       (banco), ignorando términos bancarios genéricos.
//   (c) mismo signo y fecha razonablemente cercana.
//
// 👉 Para IA real: reemplaza este nodo por un AI Agent / LLM que reciba
//    pendientes_internos y pendientes_bancarios y devuelva pares con
//    { ids_internos, ids_movimientos, confianza, justificacion }.

const prev = $json;
const { job_id, metadata, config, total_internos, total_bancarios } = prev;
const matches = [...prev.matches];
const internos = prev.pendientes_internos ?? [];
const bancarios = prev.pendientes_bancarios ?? [];

const tolIaMonto = Number(config?.tolerancia_ia_monto ?? 10);
const tolDias = Number(config?.tolerancia_dias ?? 0);
const umbral = Number(config?.umbral_confianza_auto ?? 0.95);

const dias = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

// Tokenizador: MAYÚSCULAS sin acentos, palabras de >=3 letras, sin términos
// bancarios genéricos.
const STOP = new Set([
  "DEPOSITO", "TRANSFERENCIA", "TRANSF", "TRANSFER", "RECIBIDA", "RECIBIDO",
  "ENVIADA", "ENVIADO", "PAGO", "PAGOS", "ABONO", "CARGO", "CUOTA",
  "REPETICION", "DEVOLUCION", "CCE", "INTERBANCARIA", "INTERBANCARIO",
  "OPERACION", "NRO", "REF", "REFERENCIA", "FACTURA", "BOLETA", "SAC", "EIRL",
  "SRL", "DEL", "LOS", "LAS", "POR", "CON",
]);
const palabras = (t) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
const comunesEntre = (a, b) => {
  const setB = new Set(palabras(b));
  return [...new Set(palabras(a).filter((w) => setB.has(w)))];
};

const bancUsado = new Set();
const intUsado = new Set();

internos.forEach((it, i) => {
  let mejorJ = -1;
  let mejorComunes = [];
  let mejorDif = Infinity;
  for (let j = 0; j < bancarios.length; j++) {
    if (bancUsado.has(j)) continue;
    const bc = bancarios[j];
    if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
    const dif = Math.abs(it.monto - bc.monto);
    if (dif > tolIaMonto) continue;
    if (dias(it.fecha, bc.fecha) > tolDias + 4) continue;
    const comunes = comunesEntre(it.contraparte, bc.glosa);
    if (comunes.length === 0) continue;
    if (
      comunes.length > mejorComunes.length ||
      (comunes.length === mejorComunes.length && dif < mejorDif)
    ) {
      mejorJ = j;
      mejorComunes = comunes;
      mejorDif = dif;
    }
  }
  if (mejorJ === -1) return;
  const bc = bancarios[mejorJ];
  const dif = Number((it.monto - bc.monto).toFixed(2));
  const cercania = 1 - Math.abs(dif) / tolIaMonto;
  const confianza = Math.min(
    0.94,
    Number((0.7 + cercania * 0.15 + Math.min(mejorComunes.length, 2) * 0.05).toFixed(2)),
  );
  matches.push({
    ids_internos: [it.id_interno],
    ids_movimientos: [bc.id_movimiento],
    metodo: "ia",
    confianza,
    diferencia_monto: dif,
    categoria_diferencia: "requiere_revision",
    justificacion: `Coincidencia por nombre (${mejorComunes.join(", ")}) y monto cercano (dif. ${dif.toFixed(2)}).`,
    estado_revision: confianza >= umbral ? "auto" : "pendiente",
  });
  intUsado.add(i);
  bancUsado.add(mejorJ);
});

return [{
  json: {
    job_id,
    metadata,
    config,
    total_internos,
    total_bancarios,
    matches,
    pendientes_internos: internos.filter((_, i) => !intUsado.has(i)),
    pendientes_bancarios: bancarios.filter((_, j) => !bancUsado.has(j)),
  },
}];
