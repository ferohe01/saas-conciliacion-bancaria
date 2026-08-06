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
  "EFECTIVO", "MENSUALIDAD", "MATRICULA", "PENSION", "INSCRIPCION",
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO",
  "SEPTIEMBRE", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
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

// ── Precálculo: lo que no depende del par, fuera del bucle ────────────────
// Antes `comunesEntre` tokenizaba la MISMA glosa una vez por cada registro
// interno: con 20.000 x 20.000 eso son 400 millones de `normalize` + regex +
// Set, y el runner de n8n aborta a los 30 segundos ("runner became
// unresponsive"). Ahora cada glosa se tokeniza UNA vez.
const bancPrep = bancarios.map((bc) => ({
  bc,
  t: Date.parse(bc.fecha),
  pal: new Set(palabras(bc.glosa)),
}));

// Índice por monto redondeado a soles. La tolerancia acota la banda, así que
// solo hay que mirar unos pocos cubos en vez de los 20.000 movimientos.
const cubos = new Map();
bancPrep.forEach((b, j) => {
  const k = Math.round(b.bc.monto);
  if (!cubos.has(k)) cubos.set(k, []);
  cubos.get(k).push(j);
});

const MS_DIA = 86400000;

internos.forEach((it, i) => {
  const tol = Math.max(tolAbs, Math.abs(it.monto) * (tolPct / 100));
  const tIt = Date.parse(it.fecha);
  const palIt = palabras(it.contraparte);
  if (palIt.length === 0) return; // sin nombre no hay match difuso posible

  // Candidatos por banda de monto. Se ordenan por índice para conservar el
  // mismo emparejamiento que el recorrido secuencial original: gana el
  // movimiento más antiguo de la lista, no el del cubo que toque antes.
  const desde = Math.round(it.monto - tol) - 1;
  const hasta = Math.round(it.monto + tol) + 1;
  const candidatos = [];
  for (let k = desde; k <= hasta; k++) {
    const lista = cubos.get(k);
    if (lista) for (const j of lista) if (!bancUsado.has(j)) candidatos.push(j);
  }
  candidatos.sort((a, b) => a - b);

  for (const j of candidatos) {
    const { bc, t, pal } = bancPrep[j];
    if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
    const dif = Number((it.monto - bc.monto).toFixed(2));
    if (Math.abs(dif) > tol) continue;
    if (Math.abs((tIt - t) / MS_DIA) > tolDias) continue;
    const comunes = [...new Set(palIt.filter((w) => pal.has(w)))];
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
