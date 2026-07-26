// ── Capa 2.5: AGRUPACIÓN 1:N / N:1 (subset-sum) ────────────────────────────
// Un depósito bancario que agrupa varios pagos internos (o un pago dividido en
// varios movimientos). Se acota fuerte para precisión: COINCIDENCIA DE NOMBRE
// OBLIGATORIA (cada miembro comparte >=1 palabra con el objetivo), suma casi
// EXACTA, grupo pequeño (<= max_combinacion), en ventana de fecha. Se proponen
// como SUGERENCIAS (estado 'pendiente') para revisión humana. Va entre Difusa y
// la capa de IA.

const prev = $json;
const { job_id, metadata, config, total_internos, total_bancarios } = prev;
const matches = [...prev.matches];
const internos = prev.pendientes_internos ?? [];
const bancarios = prev.pendientes_bancarios ?? [];

const tolSum = Math.min(Number(config?.tolerancia_monto_abs ?? 5), 0.5);
const ventana = Number(config?.ventana_ia_dias ?? 30);
const maxTam = Number(config?.max_combinacion ?? 3);

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
  return palabras(a).filter((w) => B.has(w));
};
const dias = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

function* combinaciones(items, maxT) {
  const n = items.length;
  function* rec(inicio, acc) {
    if (acc.length >= 2) yield acc.slice();
    if (acc.length >= maxT) return;
    for (let i = inicio; i < n; i++) { acc.push(items[i]); yield* rec(i + 1, acc); acc.pop(); }
  }
  yield* rec(0, []);
}

function agrupar(unos, muchos) {
  const usados = new Set();
  const grupos = [];
  for (const t of unos) {
    // Prefiltro por nombre: cada candidato debe compartir >=1 palabra con el
    // objetivo. Así toda combinación es coherente por construcción (sin esto se
    // agrupaban personas sin relación cuya suma cuadraba por casualidad).
    const cands = muchos
      .filter((m) => !usados.has(m.id) && Math.sign(m.monto) === Math.sign(t.monto) &&
        Math.abs(m.monto) <= Math.abs(t.monto) + tolSum && dias(t.fecha, m.fecha) <= ventana &&
        comunesEntre(m.texto, t.texto).length > 0)
      .sort((a, b) => dias(t.fecha, a.fecha) - dias(t.fecha, b.fecha))
      .slice(0, 12);
    if (cands.length < 2) continue;
    let mejor = null;
    for (const combo of combinaciones(cands, maxTam)) {
      const suma = combo.reduce((s, x) => s + x.monto, 0);
      if (Math.abs(suma - t.monto) > tolSum) continue;
      const dif = Number((suma - t.monto).toFixed(2));
      // Todos los miembros ya comparten nombre: preferir menos elementos y, a
      // igualdad, menor diferencia de monto.
      if (!mejor || combo.length < mejor.combo.length ||
          (combo.length === mejor.combo.length && Math.abs(dif) < Math.abs(mejor.dif))) {
        mejor = { combo, dif };
      }
    }
    if (!mejor) continue;
    grupos.push({ targetId: t.id, ids: mejor.combo.map((x) => x.id), dif: mejor.dif, n: mejor.combo.length });
    for (const x of mejor.combo) usados.add(x.id);
  }
  return grupos;
}

const itemInt = (r) => ({ id: r.id_interno, monto: r.monto, fecha: r.fecha, texto: r.contraparte ?? r.descripcion ?? null });
const itemBanc = (m) => ({ id: m.id_movimiento, monto: m.monto, fecha: m.fecha, texto: m.glosa ?? null });

const usadoInt = new Set();
const usadoBanc = new Set();

// 1 banco : N internos
for (const g of agrupar(bancarios.filter((m) => !usadoBanc.has(m.id_movimiento)).map(itemBanc),
                        internos.filter((r) => !usadoInt.has(r.id_interno)).map(itemInt))) {
  matches.push({
    ids_internos: g.ids, ids_movimientos: [g.targetId], metodo: "ia", confianza: null,
    diferencia_monto: g.dif, categoria_diferencia: "agrupacion_1aN",
    justificacion: `Agrupación: ${g.n} registros internos suman el depósito (dif. ${g.dif}).`,
    estado_revision: "pendiente",
  });
  usadoBanc.add(g.targetId);
  for (const id of g.ids) usadoInt.add(id);
}
// 1 interno : N bancos
for (const g of agrupar(internos.filter((r) => !usadoInt.has(r.id_interno)).map(itemInt),
                        bancarios.filter((m) => !usadoBanc.has(m.id_movimiento)).map(itemBanc))) {
  matches.push({
    ids_internos: [g.targetId], ids_movimientos: g.ids, metodo: "ia", confianza: null,
    diferencia_monto: -g.dif, categoria_diferencia: "agrupacion_1aN",
    justificacion: `Agrupación: el pago se refleja en ${g.n} movimientos bancarios (dif. ${-g.dif}).`,
    estado_revision: "pendiente",
  });
  usadoInt.add(g.targetId);
  for (const id of g.ids) usadoBanc.add(id);
}

return [{
  json: {
    job_id, metadata, config, total_internos, total_bancarios, matches,
    pendientes_internos: internos.filter((r) => !usadoInt.has(r.id_interno)),
    pendientes_bancarios: bancarios.filter((m) => !usadoBanc.has(m.id_movimiento)),
  },
}];
