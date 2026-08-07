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

const tomarLibre = (lista, filtro) => {
  if (!lista) return -1;
  for (const j of lista) if (!bancUsado.has(j) && (!filtro || filtro(j))) return j;
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
// Pass 2: monto + fecha.
//
// ⚠️ NUNCA contra una referencia que se contradice. Este respaldo existe para
// datos SIN referencia (ventas al contado, extractos que no la traen). Cuando
// los dos lados SÍ la traen y no coinciden, son operaciones distintas: casarlas
// por monto+fecha es una loteria.
//
// A escala esto no es teorico. En una recaudadora de 20.000 movimientos hay
// cientos de recibos de S/ 99 el mismo dia: el pass 2 emparejo 541 pares con
// codigos de operacion que no tenian nada que ver, y los marco `auto` — o sea,
// conciliados sin que nadie los mirara. Peor aun, cada match falso se lleva el
// movimiento que le tocaba al recibo legitimo, dejandolo huerfano: el error se
// propaga y acaba inflando el descuadre del periodo.
const compatiblePorRef = (i, j) => {
  const a = normRef(internos[i].referencia);
  const b = normRef(bancarios[j].referencia_banco);
  return !a || !b || a === b; // si a alguno le falta, no hay contradiccion
};

internos.forEach((it, i) => {
  if (intUsado.has(i)) return;
  const j = tomarLibre(
    idxPorFecha.get(`${cents(it.monto)}|${it.fecha}`),
    (cand) => compatiblePorRef(i, cand),
  );
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
