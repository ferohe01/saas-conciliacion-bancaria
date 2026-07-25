// ── Capa 1: Conciliación EXACTA ────────────────────────────────────────────
// Lee el payload del Webhook (body). Match exacto = mismo monto + misma
// referencia; respaldo por mismo monto + misma fecha. Signos ya normalizados
// por la app (cobranza/abono +, pago/cargo −).

const src = $('Webhook').first().json;
const payload = src.body ?? src;

const internos = payload.registros_internos ?? [];
const bancarios = payload.movimientos_bancarios ?? [];

const cents = (m) => Math.round(Number(m) * 100);
const normRef = (r) => String(r ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const idxPorRef = new Map();
const idxPorFecha = new Map();
const push = (map, k, v) => {
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(v);
};
bancarios.forEach((b, j) => {
  const c = cents(b.monto);
  const ref = normRef(b.referencia_banco);
  if (ref) push(idxPorRef, `${c}|${ref}`, j);
  push(idxPorFecha, `${c}|${b.fecha}`, j);
});

const bancUsado = new Set();
const intUsado = new Set();
const matches = [];

const tomarLibre = (lista) => {
  if (!lista) return -1;
  for (const j of lista) if (!bancUsado.has(j)) return j;
  return -1;
};
const registrar = (i, j) => {
  intUsado.add(i);
  bancUsado.add(j);
  matches.push({
    ids_internos: [internos[i].id_interno],
    ids_movimientos: [bancarios[j].id_movimiento],
    metodo: 'exacta',
    confianza: null,
    diferencia_monto: 0,
    categoria_diferencia: null,
    justificacion: null,
    estado_revision: 'auto',
  });
};

// Pass 1: monto + referencia (ID de pago)
internos.forEach((it, i) => {
  const ref = normRef(it.referencia);
  if (!ref) return;
  const j = tomarLibre(idxPorRef.get(`${cents(it.monto)}|${ref}`));
  if (j !== -1) registrar(i, j);
});
// Pass 2: monto + fecha
internos.forEach((it, i) => {
  if (intUsado.has(i)) return;
  const j = tomarLibre(idxPorFecha.get(`${cents(it.monto)}|${it.fecha}`));
  if (j !== -1) registrar(i, j);
});

return [{
  json: {
    job_id: payload.job_id,
    metadata: payload.metadata,
    config: payload.config,
    total_internos: internos.length,
    total_bancarios: bancarios.length,
    matches,
    pendientes_internos: internos.filter((_, i) => !intUsado.has(i)),
    pendientes_bancarios: bancarios.filter((_, j) => !bancUsado.has(j)),
  },
}];
