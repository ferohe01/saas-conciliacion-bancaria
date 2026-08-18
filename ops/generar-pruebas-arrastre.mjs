/**
 * Juego de pruebas para COBROS ENTRE MESES — el caso que el juego actual no
 * tiene y que ningún test cubre.
 *
 * ── Qué demuestra ──────────────────────────────────────────────────────────
 *
 * En el juego de junio/julio existente, cada factura se cobra **el mismo día que
 * se emite**, así que el filtro «comprobantes con fecha dentro del período»
 * nunca estorba. Aquí, la mayoría de las facturas de junio se cobran en julio,
 * que es lo normal en cuanto hay crédito a 30 días.
 *
 * Con el filtro actual, el abono de julio y la factura de junio **no pueden
 * emparejarse en ninguna conciliación**: en junio el abono no existe todavía y
 * en julio la factura no entra al conjunto. Este juego lo hace medible.
 *
 * ⚠️ Y lo aísla: los pares cruzados comparten **importe y referencia exactos**,
 * así que la capa exacta los casaría sin dudar. Lo único que se lo impide es el
 * período. Si tras el cambio siguieran sin casar, la causa sería otra.
 *
 * ── Qué debe salir ─────────────────────────────────────────────────────────
 *
 * El script lo imprime al terminar, con los números de antes y después. Se
 * guardan también en LEEME-arrastre.md.
 *
 * Uso:  node ops/generar-pruebas-arrastre.mjs [--salida ./carpeta]
 */

import * as XLSX from "xlsx";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const DIR = arg("salida", "./data/pruebas-arrastre");
mkdirSync(DIR, { recursive: true });

const SALDO_INICIAL = 120_000;
const SUCURSAL = "0451 - SAN ISIDRO";

// Determinista: dos corridas dan el mismo archivo, para poder documentar cifras.
let semilla = 20260818;
const rnd = () => {
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
  return semilla / 0x7fffffff;
};
const entre = (a, b) => Math.round((a + rnd() * (b - a)) * 100) / 100;

// ── Clientes, cada uno con su costumbre de pago ────────────────────────────
//
// El retraso es en días sobre el VENCIMIENTO, y es lo que /cuando-pagan tiene
// que acabar midiendo. Se reparte a propósito por los cinco tramos de
// `puntualidad()`: antes, puntual, algo tarde, tarde.
//
// ⚠️ Los de crédito NO hacen ventas al contado, y los de mostrador no compran a
// crédito. No es un detalle de realismo: si se mezclaran, la mediana de cada
// cliente saldría entre su costumbre real y el 0 de las ventas al contado —con
// 4 y 4, un cliente de +18 días mostraría 9— y el juego dejaría de demostrar lo
// que quiere demostrar.
const CLIENTES = [
  ["Agroindustrias del Norte S.A.C.", "20609988776", -6],
  ["Julio César Vargas Ríos", "10412345678", -2],
  ["Comercial Ñuñez S.A.C.", "20487654321", 0],
  ["Servicios Generales Arequipa E.I.R.L.", "20533445566", 3],
  ["Importaciones Piura S.A.C.", "20602345671", 4],
  ["Textiles Gamarra S.A.", "20544556677", 7],
  ["Minimarket Los Olivos E.I.R.L.", "20511223344", 9],
  ["Ferretería Lima Norte E.I.R.L.", "20566778899", 12],
  ["Corporación Huancayo S.A.C.", "20522334455", 18],
  ["Distribuciones Puno S.R.L.", "20601122334", 25],
];

/**
 * Los de mostrador: pagan en el acto, así que su retraso medido es 0.
 *
 * Son pocos y se repiten a propósito. Sirven para que la pantalla enseñe el
 * caso «paga puntual, medido en N documentos» al lado del «sin historial», que
 * dan los dos 0 días y significan lo contrario.
 */
const CONTADO = [
  ["Bodega Santa Rosa E.I.R.L.", "20455667711"],
  ["Cliente mostrador", null],
  ["Farmacia San Juan S.A.C.", "20499887722"],
  ["Librería El Estudiante", "10455667733"],
];

const PROVEEDORES = [
  ["Backus y Johnston S.A.A.", "20100113610"],
  ["Transportes Chimú S.A.C.", "20455667788"],
  ["Envases Flexibles del Perú S.A.", "20477889900"],
  ["Telefónica del Perú S.A.A.", "20100017491"],
];

const dd = (d) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const dia = (mes, n) => new Date(Date.UTC(2026, mes - 1, n));
const mas = (f, n) => new Date(f.getTime() + n * 86_400_000);
/** Los bancos no mueven plata en domingo. */
const habil = (f) => (f.getUTCDay() === 0 ? mas(f, 1) : f);

const comprobantes = { 6: [], 7: [] };
const movimientos = { 6: [], 7: [] };
let nSerie = 3000;
let nOp = 40_000_000;

/**
 * Emite un comprobante y programa su cobro en el extracto.
 *
 * `pago` es la fecha real en la que el banco lo refleja. Puede caer en otro mes
 * que la emisión — que es de lo que va todo esto.
 */
function emitir({ mesEmision, fecha, vence, monto, tipo, quien, ruc, glosa, pago }) {
  const serie = tipo === "pago" ? `E001-${++nSerie}` : `F001-${++nSerie}`;
  const op = String(++nOp);
  comprobantes[mesEmision].push({
    fecha: dd(fecha),
    fecha_vencimiento: dd(vence),
    monto: monto.toFixed(2),
    tipo,
    referencia: serie,
    // ⚠️ El código con el que el banco lo refleja. Mismo importe y misma
    // referencia en los dos lados: la capa exacta casaría el par sin dudar, así
    // que si no casa, la causa es el período y solo el período.
    referencia_externa: op,
    ruc_contraparte: ruc,
    razon_social: quien,
    moneda: "PEN",
    descripcion: glosa,
  });
  if (pago) {
    const mesPago = pago.getUTCMonth() + 1;
    movimientos[mesPago].push({
      f: pago,
      desc: tipo === "pago" ? `PAGO PROVEEDOR ${quien}` : `ABONO TRANSF. ${quien}`,
      monto: tipo === "pago" ? -monto : monto,
      op,
    });
  }
  return serie;
}

// ── JUNIO ──────────────────────────────────────────────────────────────────
//
// 20 ventas al contado, que se cobran en junio, y 40 a 30 días, que se cobran
// en JULIO. Ahí está el caso.
for (let i = 0; i < 20; i++) {
  const [quien, ruc] = CONTADO[i % CONTADO.length];
  const f = habil(dia(6, 2 + ((i * 3) % 26)));
  emitir({
    mesEmision: 6, fecha: f, vence: f, monto: entre(800, 9000),
    tipo: "cobranza", quien, ruc, glosa: "Venta al contado", pago: f,
  });
}
// 60 a crédito = 6 por cliente: por encima del mínimo de 3 observaciones que
// /cuando-pagan exige para hablar de la costumbre de alguien, con margen.
for (let i = 0; i < 60; i++) {
  const [quien, ruc, retraso] = CLIENTES[i % CLIENTES.length];
  const f = habil(dia(6, 1 + ((i * 7) % 24)));
  const v = mas(f, 30);
  // El cobro real: el vencimiento más la costumbre del cliente.
  let p = habil(mas(v, retraso));
  if (p > dia(7, 31)) p = dia(7, 31); // que no se salga del extracto de julio
  emitir({
    mesEmision: 6, fecha: f, vence: v, monto: entre(1200, 28000),
    tipo: "cobranza", quien, ruc, glosa: "Venta a crédito 30 días", pago: p,
  });
}
for (let i = 0; i < 12; i++) {
  const [quien, ruc] = PROVEEDORES[i % PROVEEDORES.length];
  const f = habil(dia(6, 3 + ((i * 2) % 25)));
  // 8 se pagan en junio; 4 son cheques girados que el banco cobra en julio.
  const p = i < 8 ? f : habil(dia(7, 4 + i));
  emitir({
    mesEmision: 6, fecha: f, vence: f, monto: entre(600, 12000),
    tipo: "pago", quien, ruc, glosa: "Compra de mercadería", pago: p,
  });
}

// ── JULIO ──────────────────────────────────────────────────────────────────
//
// Igual, pero lo de crédito se cobra en AGOSTO: queda pendiente a propósito, y
// tiene que seguir quedando pendiente después del cambio.
for (let i = 0; i < 20; i++) {
  const [quien, ruc] = CONTADO[i % CONTADO.length];
  const f = habil(dia(7, 2 + ((i * 3) % 26)));
  emitir({
    mesEmision: 7, fecha: f, vence: f, monto: entre(800, 9000),
    tipo: "cobranza", quien, ruc, glosa: "Venta al contado", pago: f,
  });
}
for (let i = 0; i < 40; i++) {
  const [quien, ruc] = CLIENTES[i % CLIENTES.length];
  const f = habil(dia(7, 1 + ((i * 7) % 24)));
  emitir({
    mesEmision: 7, fecha: f, vence: mas(f, 30), monto: entre(1200, 28000),
    tipo: "cobranza", quien, ruc, glosa: "Venta a crédito 30 días", pago: null,
  });
}
for (let i = 0; i < 12; i++) {
  const [quien, ruc] = PROVEEDORES[i % PROVEEDORES.length];
  const f = habil(dia(7, 3 + ((i * 2) % 25)));
  emitir({
    mesEmision: 7, fecha: f, vence: f, monto: entre(600, 12000),
    tipo: "pago", quien, ruc, glosa: "Compra de mercadería",
    pago: i < 8 ? f : null,
  });
}

// ── Gastos del banco, que nadie registra en los libros ─────────────────────
// Son las partidas que el cuadre existe para sacar a la luz.
for (const mes of [6, 7]) {
  const fin = mes === 6 ? dia(6, 30) : dia(7, 31);
  movimientos[mes].push(
    { f: fin, desc: "MANTENIMIENTO DE CUENTA", monto: -15, op: String(++nOp) },
    { f: fin, desc: "PORTES ESTADO DE CUENTA", monto: -9, op: String(++nOp) },
    { f: fin, desc: "COMISION USO DE CANALES", monto: -12, op: String(++nOp) },
    { f: habil(dia(mes, 15)), desc: "ITF IMPUESTO TRANSACCIONES FINANCIERAS", monto: -18.4, op: String(++nOp) },
  );
}

// ── Escribir ───────────────────────────────────────────────────────────────

const NOMBRE = { 6: "junio", 7: "julio" };
let saldo = SALDO_INICIAL;
const resumen = {};

for (const mes of [6, 7]) {
  const may = comprobantes[mes];
  const mov = movimientos[mes].sort((a, b) => a.f - b.f || a.op.localeCompare(b.op));

  const filasMov = mov.map((m) => {
    saldo += m.monto;
    return {
      Fecha: dd(m.f),
      "Descripción": m.desc.slice(0, 40),
      Monto: m.monto.toFixed(2),
      Saldo: saldo.toFixed(2),
      "Operación": m.op,
      Sucursal: SUCURSAL,
    };
  });

  const neto = may.reduce((s, c) => s + (c.tipo === "pago" ? -1 : 1) * Number(c.monto), 0);
  resumen[mes] = {
    comprobantes: may.length,
    movimientos: filasMov.length,
    neto: Math.round(neto * 100) / 100,
    saldoExtracto: saldo,
    // Cuántos movimientos de este mes pagan comprobantes emitidos en OTRO mes.
    cruzados: mov.filter((m) => {
      const c = [...comprobantes[6], ...comprobantes[7]].find((x) => x.referencia_externa === m.op);
      if (!c) return false;
      const mesEmision = Number(c.fecha.slice(3, 5));
      return mesEmision !== mes;
    }).length,
  };

  const w1 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w1, XLSX.utils.json_to_sheet(may), "Comprobantes");
  writeFileSync(join(DIR, `mayor-${NOMBRE[mes]}-2026.xlsx`), XLSX.write(w1, { type: "buffer", bookType: "xlsx" }));

  const w2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w2, XLSX.utils.json_to_sheet(filasMov), "Movimientos");
  writeFileSync(join(DIR, `extracto-bcp-${NOMBRE[mes]}-2026.xlsx`), XLSX.write(w2, { type: "buffer", bookType: "xlsx" }));
}

// ── Comprobación antes de dar nada por bueno ───────────────────────────────
const ops = [...comprobantes[6], ...comprobantes[7]].map((c) => c.referencia_externa);
if (new Set(ops).size !== ops.length) {
  console.error("Hay códigos de operación repetidos. No sirve: los pares serían ambiguos.");
  process.exit(1);
}
const series = [...comprobantes[6], ...comprobantes[7]].map((c) => c.referencia);
if (new Set(series).size !== series.length) {
  console.error("Hay series repetidas. El índice único de la 0018 rechazaría filas.");
  process.exit(1);
}

const librosJun = SALDO_INICIAL + resumen[6].neto;
const librosJul = librosJun + resumen[7].neto;
const f = (n) => n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log(`✓ ${DIR}`);
console.log("");
for (const mes of [6, 7]) {
  const r = resumen[mes];
  console.log(`${NOMBRE[mes].toUpperCase()}`);
  console.log(`  comprobantes            ${r.comprobantes}`);
  console.log(`  movimientos del banco   ${r.movimientos}`);
  console.log(`  … que pagan otro mes    ${r.cruzados}   ← los que hoy no pueden casar`);
  console.log(`  neto del mayor          ${f(r.neto)}`);
  console.log(`  saldo del extracto      ${f(r.saldoExtracto)}`);
}
console.log("");
console.log("Saldo según libros (Paso 1):");
console.log(`  30/06   ${f(librosJun)}`);
console.log(`  31/07   ${f(librosJul)}`);
console.log(`  saldo extracto inicial de junio: ${f(SALDO_INICIAL)}`);
