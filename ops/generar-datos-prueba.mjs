import * as XLSX from "xlsx";
import { writeFileSync, mkdirSync } from "node:fs";

/* Datos de prueba para el circuito completo de julio 2026.
   Deterministas a propósito: así se puede documentar qué debe casar y cómo. */

const OUT = "./data/pruebas";
const f = (d) => `${String(d).padStart(2, "0")}/07/2026`;
const venc = (d, m = 8) => `${String(d).padStart(2, "0")}/0${m}/2026`;

const CLI = {
  minera:  ["20512345678", "Minera Andina SAC"],
  transp:  ["20587654321", "Transportes Cusco EIRL"],
  agro:    ["20599887766", "Agro Norte SAC"],
  ferre:   ["20511223344", "Ferreteria Lima Norte EIRL"],
  textil:  ["20544556677", "Textiles Arequipa SA"],
  distri:  ["20566778899", "Distribuidora Piura SAC"],
  constru: ["20522334455", "Constructora Trujillo SRL"],
  tacna:   ["20533445566", "Servicios Tacna EIRL"],
};
const PROV = {
  luz:   ["20100017491", "Electro Servicio SA"],
  alqui: ["20477778888", "Inmobiliaria San Isidro SAC"],
  papel: ["20455556666", "Suministros Oficina EIRL"],
  flete: ["20433334444", "Fletes Rapidos SAC"],
};

const comprobantes = [];
const banco = [];
let nSerie = 100;
let nOp = 4000;

const serie = () => `F001-${++nSerie}`;
const op = () => `OP${++nOp}`;

/** Añade una cobranza y devuelve su serie. */
function cobranza({ dia, monto, cli, vencDia, vencMes = 8, desc }) {
  const [ruc, razon] = CLI[cli];
  const s = serie();
  comprobantes.push({
    fecha: f(dia),
    fecha_vencimiento: venc(vencDia, vencMes),
    monto: monto.toFixed(2),
    tipo: "cobranza",
    referencia: s,
    ruc_contraparte: ruc,
    razon_social: razon,
    descripcion: desc ?? `Venta ${s}`,
  });
  return { serie: s, razon, monto };
}

function pago({ dia, monto, prov, vencDia, desc }) {
  const [ruc, razon] = PROV[prov];
  const s = `E001-${++nSerie}`;
  comprobantes.push({
    fecha: f(dia),
    fecha_vencimiento: venc(vencDia),
    monto: monto.toFixed(2),
    tipo: "pago",
    referencia: s,
    ruc_contraparte: ruc,
    razon_social: razon,
    descripcion: desc ?? `Pago ${razon}`,
  });
  return { serie: s, razon, monto };
}

function mov({ dia, glosa, monto }) {
  banco.push({ Fecha: f(dia), Descripcion: glosa, Monto: monto.toFixed(2), Saldo: "" });
}

// ── A. 18 exactas: mismo monto y la referencia en la glosa ──────────────────
const exactas = [
  [2, 4500.0, "minera", 16], [3, 1280.5, "transp", 17], [4, 3100.0, "agro", 18],
  [5, 890.0, "ferre", 19],   [6, 2450.0, "textil", 20], [7, 5600.0, "distri", 21],
  [8, 1750.0, "constru", 22],[9, 3980.0, "tacna", 23],  [10, 620.0, "minera", 24],
  [11, 7200.0, "transp", 25],[12, 1130.0, "agro", 26],  [13, 4400.0, "ferre", 27],
  [14, 2890.0, "textil", 28],[15, 960.0, "distri", 29], [16, 3350.0, "constru", 30],
  [17, 1490.0, "tacna", 31], [18, 5100.0, "minera", 1], [19, 2200.0, "transp", 2],
];
for (const [dia, monto, cli, vd] of exactas) {
  const c = cobranza({ dia, monto, cli, vencDia: vd, vencMes: vd <= 2 ? 9 : 8 });
  mov({ dia: dia + 1, glosa: `ABONO TRANSFERENCIA ${c.serie} ${c.razon}`, monto });
}

// ── B. 5 difusas: llega el monto menos comisión, sin referencia en la glosa ──
const difusas = [
  [20, 1850.0, "agro", 3.5], [21, 2640.0, "ferre", 5.0], [22, 4150.0, "textil", 3.5],
  [23, 990.0, "distri", 5.0], [24, 3720.0, "constru", 3.5],
];
for (const [dia, monto, cli, com] of difusas) {
  const c = cobranza({ dia, monto, cli, vencDia: 5, vencMes: 9 });
  mov({ dia: dia + 1, glosa: `DEPOSITO ${c.razon.toUpperCase()} ${op()}`, monto: monto - com });
}

// ── C. Agrupación 1:N — un solo depósito cubre tres facturas ─────────────────
for (const [base, cli, dia] of [[0, "tacna", 25], [1, "minera", 26]]) {
  const partes = base === 0 ? [1200.0, 800.0, 450.0] : [2000.0, 1500.0, 700.0];
  const cs = partes.map((m) => cobranza({ dia, monto: m, cli, vencDia: 10, vencMes: 9 }));
  const total = partes.reduce((a, b) => a + b, 0);
  mov({ dia: dia + 1, glosa: `ABONO ${cs[0].razon.toUpperCase()} CONSOLIDADO ${op()}`, monto: total });
}

// ── D. 2 pagos parciales: entra menos de lo facturado ───────────────────────
for (const [dia, monto, cli, pagado] of [[27, 5000.0, "transp", 3000.0], [28, 2800.0, "agro", 1000.0]]) {
  const c = cobranza({ dia, monto, cli, vencDia: 12, vencMes: 9, desc: "Venta a cuenta" });
  mov({ dia: dia + 1, glosa: `ABONO PARCIAL ${c.serie} ${c.razon}`, monto: pagado });
}

// ── E. 7 facturas SIN cobrar: se quedan pendientes en el aging ──────────────
const pendientes = [
  [6, 1600.0, "ferre", 5], [8, 2300.0, "textil", 8], [10, 750.0, "distri", 12],
  [12, 4900.0, "constru", 15], [14, 1150.0, "tacna", 20], [20, 3400.0, "minera", 25],
  [22, 680.0, "transp", 28],
];
for (const [dia, monto, cli, vd] of pendientes) cobranza({ dia, monto, cli, vencDia: vd, vencMes: 8 });

// ── F. 12 pagos a proveedores (6 con cargo en el banco, 6 sin) ──────────────
const pagosCasan = [[3, 890.0, "luz"], [5, 3500.0, "alqui"], [9, 420.0, "papel"],
                    [13, 1250.0, "flete"], [17, 910.0, "luz"], [21, 3500.0, "alqui"]];
for (const [dia, monto, prov] of pagosCasan) {
  const p = pago({ dia, monto, prov, vencDia: 10 });
  mov({ dia: dia + 1, glosa: `CARGO PAGO ${p.serie} ${p.razon}`, monto: -monto });
}
const pagosSueltos = [[7, 380.0, "papel"], [11, 1500.0, "flete"], [15, 640.0, "luz"],
                      [19, 2100.0, "alqui"], [23, 290.0, "papel"], [26, 780.0, "flete"]];
for (const [dia, monto, prov] of pagosSueltos) pago({ dia, monto, prov, vencDia: 15 });

// ── G. Movimientos del banco sin contraparte interna ────────────────────────
mov({ dia: 4, glosa: "ABONO INTERESES CUENTA AHORRO", monto: 45.2 });
mov({ dia: 11, glosa: "ABONO DEVOLUCION SUNAT 2026", monto: 1820.0 });
mov({ dia: 18, glosa: "TRANSFERENCIA ENTRE MIS CUENTAS", monto: 5000.0 });
mov({ dia: 24, glosa: "ABONO NO IDENTIFICADO OP99123", monto: 1340.0 });
mov({ dia: 5, glosa: "COMISION MANTENIMIENTO CUENTA", monto: -12.0 });
mov({ dia: 15, glosa: "ITF IMPUESTO TRANSACCIONES", monto: -8.5 });
mov({ dia: 29, glosa: "PORTES ESTADO DE CUENTA", monto: -9.0 });

// ── Saldo corrido, para que la app pueda autodetectar el saldo final ────────
banco.sort((a, b) => Number(a.Fecha.slice(0, 2)) - Number(b.Fecha.slice(0, 2)));
let saldo = 25000;
for (const m of banco) {
  saldo += Number(m.Monto);
  m.Saldo = saldo.toFixed(2);
}

const hoja = (rows, header) => XLSX.utils.json_to_sheet(rows, { header });
const libro = (rows, header, nombre, fichero) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja(rows, header), nombre);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${fichero}`, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
};

libro(comprobantes,
  ["fecha", "fecha_vencimiento", "monto", "tipo", "referencia", "ruc_contraparte", "razon_social", "descripcion"],
  "Comprobantes", "prueba_comprobantes_julio2026.xlsx");

libro(banco, ["Fecha", "Descripcion", "Monto", "Saldo"],
  "Extracto", "prueba_extracto_bcp_julio2026.xlsx");

const cob = comprobantes.filter((c) => c.tipo === "cobranza");
const pag = comprobantes.filter((c) => c.tipo === "pago");
const sum = (a) => a.reduce((s, c) => s + Number(c.monto), 0).toFixed(2);
console.log(`comprobantes : ${comprobantes.length}  (${cob.length} cobranzas S/${sum(cob)} · ${pag.length} pagos S/${sum(pag)})`);
console.log(`extracto     : ${banco.length} movimientos · saldo final S/${saldo.toFixed(2)}`);
console.log(`abonos       : ${banco.filter(m=>Number(m.Monto)>0).length} · cargos ${banco.filter(m=>Number(m.Monto)<0).length}`);
