// ── Capa 2: Conciliación DIFUSA (tolerancias + coincidencia de nombre) ─────
// Toma los pendientes de la capa exacta y concilia por cercanía de monto y
// fecha, EXIGIENDO además al menos una palabra en común entre la contraparte
// (interno) y la glosa (banco). Diferencia de monto tolerada =
// max(tolerancia_monto_abs, |monto|*pct). Fecha tolerada = tolerancia_dias.

const prev = $json;
const { job_id, metadata, config, total_internos, total_bancarios } = prev;
const matches = [...prev.matches];
const internos = prev.pendientes_internos ?? [];
const bancarios = prev.pendientes_bancarios ?? [];

const tolAbs = Number(config?.tolerancia_monto_abs ?? 0);
const tolPct = Number(config?.tolerancia_monto_pct ?? 0);
const tolDias = Number(config?.tolerancia_dias ?? 0);

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
  for (let j = 0; j < bancarios.length; j++) {
    if (bancUsado.has(j)) continue;
    const bc = bancarios[j];
    if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
    const dif = Number((it.monto - bc.monto).toFixed(2));
    const tol = Math.max(tolAbs, Math.abs(it.monto) * (tolPct / 100));
    if (Math.abs(dif) > tol) continue;
    if (dias(it.fecha, bc.fecha) > tolDias) continue;
    const comunes = comunesEntre(it.contraparte, bc.glosa);
    if (comunes.length === 0) continue; // exige coincidencia de nombre
    matches.push({
      ids_internos: [it.id_interno],
      ids_movimientos: [bc.id_movimiento],
      metodo: 'difusa',
      confianza: null,
      diferencia_monto: dif,
      categoria_diferencia: Math.abs(dif) > 0 ? 'comision_bancaria' : null,
      justificacion:
        Math.abs(dif) > 0
          ? `Coincidencia por nombre (${comunes.join(', ')}); diferencia de ${dif.toFixed(2)} compatible con comisión bancaria.`
          : `Coincidencia por nombre (${comunes.join(', ')}).`,
      estado_revision: 'auto',
    });
    intUsado.add(i);
    bancUsado.add(j);
    break;
  }
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
