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
// Referencia normalizada, igual que en la capa exacta: si dos partidas traen el
// MISMO codigo de operacion, esa es una identidad mas fuerte que un nombre.
const normRef = (r) => String(r ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const compartenPalabra = (a, b) => { for (const w of a) if (b.has(w)) return true; return false; };
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
    // Prefiltro de identidad: cada candidato debe compartir con el objetivo la
    // REFERENCIA o al menos una palabra del nombre. Sin prefiltro, un subset-sum
    // agrupa partidas sin relacion cuya suma cuadra por casualidad.
    //
    // La referencia se acepta ademas del nombre porque hay operaciones donde la
    // identidad no esta en el nombre: en una cuenta recaudadora los recibos
    // llegan sin contraparte y lo que comparten los que se pagaron juntos es el
    // codigo de operacion. Exigir nombre alli hacia imposible la agrupacion — y
    // eran justo los casos 1:N que hay que conciliar. Es el mismo criterio que
    // ya usa ia_llm_01_candidatos.js, donde compartir referencia basta.
    const cands = muchos
      .filter((m) => !usados.has(m.id) && Math.sign(m.monto) === Math.sign(t.monto) &&
        Math.abs(m.monto) <= Math.abs(t.monto) + tolSum && dias(t.fecha, m.fecha) <= ventana &&
        ((m.ref && m.ref === t.ref) || compartenPalabra(m.pal, t.pal)))
      .sort((a, b) => dias(t.fecha, a.fecha) - dias(t.fecha, b.fecha))
      .slice(0, 12);
    if (cands.length < 2) continue;
    let mejor = null;
    for (const combo of combinaciones(cands, maxTam)) {
      const suma = combo.reduce((s, x) => s + x.monto, 0);
      if (Math.abs(suma - t.monto) > tolSum) continue;
      const dif = Number((suma - t.monto).toFixed(2));
      // Todos los miembros ya comparten identidad (referencia o nombre):
      // preferir menos elementos y, a igualdad, menor diferencia de monto.
      if (!mejor || combo.length < mejor.combo.length ||
          (combo.length === mejor.combo.length && Math.abs(dif) < Math.abs(mejor.dif))) {
        mejor = { combo, dif };
      }
    }
    if (!mejor) continue;
    grupos.push({ targetId: t.id, ids: mejor.combo.map((x) => x.id), dif: mejor.dif,
                  n: mejor.combo.length,
                  porRef: Boolean(t.ref) && mejor.combo.every((x) => x.ref === t.ref) });
    for (const x of mejor.combo) usados.add(x.id);
  }
  return grupos;
}

// Los tokens y la referencia se calculan UNA vez por partida, no dentro del
// bucle: con miles de pendientes, re-tokenizar por cada par tumba el runner de
// n8n por inactividad (mismo fallo que tenia 02_difusa.js).
const itemInt = (r) => {
  const texto = r.contraparte ?? r.descripcion ?? null;
  return { id: r.id_interno, monto: r.monto, fecha: r.fecha, texto,
           pal: new Set(palabras(texto)), ref: normRef(r.referencia) };
};
const itemBanc = (m) => {
  const texto = m.glosa ?? null;
  return { id: m.id_movimiento, monto: m.monto, fecha: m.fecha, texto,
           pal: new Set(palabras(texto)), ref: normRef(m.referencia_banco) };
};

const usadoInt = new Set();
const usadoBanc = new Set();

// 1 banco : N internos
for (const g of agrupar(bancarios.filter((m) => !usadoBanc.has(m.id_movimiento)).map(itemBanc),
                        internos.filter((r) => !usadoInt.has(r.id_interno)).map(itemInt))) {
  matches.push({
    ids_internos: g.ids, ids_movimientos: [g.targetId], metodo: "ia", confianza: null,
    diferencia_monto: g.dif, categoria_diferencia: "agrupacion_1aN",
    justificacion: `Agrupación: ${g.n} registros internos suman el depósito (dif. ${g.dif}).${g.porRef ? " Comparten el mismo código de operación." : ""}`,
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
    justificacion: `Agrupación: el pago se refleja en ${g.n} movimientos bancarios (dif. ${-g.dif}).${g.porRef ? " Comparten el mismo código de operación." : ""}`,
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
