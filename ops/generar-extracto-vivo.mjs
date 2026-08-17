/**
 * Extracto del MES EN CURSO para probar el saldo vivo (`/caja`, fase 2).
 *
 * ⚠️ Las fechas se calculan desde HOY, no van fijas en el código. Un archivo con
 * fechas escritas a mano caduca: el saldo vivo deja de anunciarse como «hoy» a
 * los 10 días (`DIAS_VIGENCIA`), así que un extracto de agosto sirve para una
 * demo en agosto y en septiembre vuelve a enseñar el aviso ámbar. Regenerarlo
 * cuesta un comando; acordarse de por qué dejó de funcionar, una tarde.
 *
 * ⚠️ NO lleva libro mayor a juego, y eso es el punto: el saldo vivo existe
 * precisamente para no tener que conciliar. Se sube desde `/caja`, no desde el
 * wizard.
 *
 * Uso:
 *   node ops/generar-extracto-vivo.mjs
 *   node ops/generar-extracto-vivo.mjs --saldo 1271478.87 --desde 2026-08-01
 *
 * Encadena con el juego de junio/julio: su saldo de partida por defecto es el
 * final de julio, así que el saldo declarado que salga en pantalla es coherente
 * con el corte aprobado.
 */

import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";

// ── Parámetros ─────────────────────────────────────────────────────────────

const arg = (nombre, porDefecto) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
};

const hoy = new Date(arg("hoy", new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
/** Saldo con el que arranca: el final del último período conciliado. */
const SALDO_BASE = Number(arg("saldo", "1271478.87"));
const SUCURSAL = "0451 - SAN ISIDRO";
/** Prefijo de código de operación. Junio usó 3001…, julio 3005…, agosto 3009… */
const PREFIJO_OP = arg("op", "3009");

// El extracto llega hasta AYER: nadie descarga movimientos del día en curso, y
// así la fecha máxima queda a 1 día — dentro de la vigencia con holgura.
const finPorDefecto = new Date(hoy.getTime() - 86_400_000);
const fin = new Date(arg("hasta", finPorDefecto.toISOString().slice(0, 10)) + "T00:00:00Z");
const inicio = new Date(
  arg("desde", `${fin.getUTCFullYear()}-${String(fin.getUTCMonth() + 1).padStart(2, "0")}-01`) +
    "T00:00:00Z",
);

const SALIDA = arg(
  "salida",
  `./data/pruebas/extracto-bcp-${["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][fin.getUTCMonth()]}-${fin.getUTCFullYear()}.xlsx`,
);

// ── Aleatoriedad determinista ──────────────────────────────────────────────
// Para que dos corridas del mismo día den el mismo archivo: si la demo se
// repite, los números no bailan.

let semilla = 20260817;
const rnd = () => {
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
  return semilla / 0x7fffffff;
};
const entre = (a, b) => a + rnd() * (b - a);
const elegir = (xs) => xs[Math.floor(rnd() * xs.length)];

// ── Vocabulario, el mismo del juego de junio y julio ───────────────────────

const CLIENTES = [
  "COMERCIAL ÑUÑEZ",
  "IMPORTACIONES PIURA",
  "JULIO CÉSAR VARGAS RÍOS",
  "AGROINDUSTRIAS DEL NORTE",
  "INVERSIONES TACNA",
  "MARÍA FERNANDA CHÁVEZ LEÓN",
  "TEXTILES GAMARRA",
  "MINIMARKET LOS OLIVOS",
  "SERVICIOS GENERALES AREQUIPA",
  "CORPORACIÓN HUANCAYO",
  "FERRETERÍA LIMA NORTE",
  "DISTRIBUCIONES PUNO",
  "AVÍCOLA EL PROGRESO",
  "ROSA ELVIRA QUISPE MAMANI",
  "PLÁSTICOS DEL PACÍFICO",
  "EDITORIAL CUSCO",
  "BOTICAS",
];

const PROVEEDORES = [
  "BACKUS Y JOHNSTON",
  "TRANSPORTES CHIMÚ",
  "ENVASES FLEXIBLES DEL PERÚ",
  "SUMINISTROS INDUSTRIALES",
  "SERVICIOS LOGÍSTICOS CALLAO",
  "REPUESTOS AUTOMOTRICES LIMA",
  "TELEFÓNICA DEL PERÚ",
  "PAPELERA NACIONAL",
];

/** Recorta como lo hace el extracto real del BCP: la glosa tiene ancho fijo. */
const glosa = (s) => s.slice(0, 40);

// ── Generación ─────────────────────────────────────────────────────────────

const filas = [];
let saldo = SALDO_BASE;
let nOp = 20;

function mov(fecha, desc, monto) {
  saldo += monto;
  nOp += Math.floor(entre(1, 6));
  filas.push({
    Fecha: fecha,
    Descripción: glosa(desc),
    Monto: monto.toFixed(2),
    Saldo: saldo.toFixed(2),
    Operación: `${PREFIJO_OP}${String(nOp).padStart(4, "0")}`,
    Sucursal: SUCURSAL,
  });
}

const ddmmyyyy = (d) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

const dias = [];
for (let d = new Date(inicio); d <= fin; d = new Date(d.getTime() + 86_400_000)) {
  // Sin domingos: el extracto de una cuenta corriente no trae movimientos.
  if (d.getUTCDay() !== 0) dias.push(new Date(d));
}
if (dias.length === 0) {
  console.error("El rango no tiene ni un día hábil. Revisa --desde y --hasta.");
  process.exit(1);
}

for (const [i, d] of dias.entries()) {
  const fecha = ddmmyyyy(d);
  const sabado = d.getUTCDay() === 6;
  // Sábado: poco movimiento, como en la realidad.
  const cuantos = sabado ? Math.floor(entre(1, 3)) : Math.floor(entre(8, 14));

  for (let k = 0; k < cuantos; k++) {
    const dado = rnd();

    if (dado < 0.58) {
      // Cobranza de cliente. Es el grueso del extracto.
      const cli = elegir(CLIENTES);
      const monto = Math.round(entre(900, 24000) * 100) / 100;
      // Un puñado llegan netos de detracción o retención, como en junio/julio:
      // el motor tiene que casarlos igual y el importe no cuadra al céntimo.
      const matiz = rnd();
      if (matiz < 0.06) mov(fecha, `ABONO TRANSF. ${cli} (NETO DETRACC)`, Math.round(monto * 0.88 * 100) / 100);
      else if (matiz < 0.1) mov(fecha, `ABONO TRANSF. ${cli} (NETO RETENC)`, Math.round(monto * 0.97 * 100) / 100);
      else if (matiz < 0.13) mov(fecha, `ABONO INTERBANCARIO ${cli} (NETO COM)`, Math.round((monto - 8.5) * 100) / 100);
      else mov(fecha, `ABONO TRANSF. ${cli}`, monto);
    } else if (dado < 0.82) {
      const prov = elegir(PROVEEDORES);
      const monto = Math.round(entre(700, 16000) * 100) / 100;
      if (rnd() < 0.12) mov(fecha, `PAGO ${prov} (INC. PERCEPCION)`, -Math.round(monto * 1.02 * 100) / 100);
      else mov(fecha, `PAGO PROVEEDOR ${prov}`, -monto);
    } else if (dado < 0.87) {
      mov(fecha, "TRASPASO ENTRE CUENTAS PROPIAS", -Math.round(entre(2000, 15000) * 100) / 100);
    } else if (dado < 0.91) {
      mov(fecha, `TRANSF. A TERCEROS BCP ${elegir(PROVEEDORES)}`, -Math.round(entre(1200, 9000) * 100) / 100);
    } else if (dado < 0.94) {
      mov(fecha, `PAGO HONORARIOS ${elegir(["CARLOS", "ANA", "MIGUEL"])} (NETO RETENC 4TA)`, -Math.round(entre(1500, 4500) * 0.92 * 100) / 100);
    } else if (dado < 0.96) {
      mov(fecha, "DEPOSITO EN EFECTIVO AG. MIRAFLORES", Math.round(entre(1500, 9000) * 100) / 100);
    } else if (dado < 0.98) {
      mov(fecha, "COMISION USO DE CANALES", -12);
    } else {
      mov(fecha, "ITF IMPUESTO TRANSACCIONES FINANCIERAS", -Math.round(entre(2, 25) * 100) / 100);
    }
  }

  // Los tributos del mes caen a mitad de mes, como manda el cronograma SUNAT.
  if (d.getUTCDate() >= 12 && d.getUTCDate() <= 18 && i > 0 && filas.length > 40) {
    const yaPagados = filas.some((r) => r.Descripción.startsWith("PAGO TRIBUTOS"));
    if (!yaPagados) {
      mov(fecha, "PAGO TRIBUTOS SUNAT IGV", -Math.round(entre(9000, 22000) * 100) / 100);
      mov(fecha, "PAGO TRIBUTOS SUNAT RENTA", -Math.round(entre(3000, 8000) * 100) / 100);
    }
  }
}

// Cierre del mes en curso: los cargos fijos del banco, al final del último día.
const ultimo = ddmmyyyy(dias[dias.length - 1]);
mov(ultimo, "MANTENIMIENTO DE CUENTA", -15);
mov(ultimo, "PORTES ESTADO DE CUENTA", -9);

// ── Comprobación antes de escribir ─────────────────────────────────────────
// El saldo corrido tiene que cuadrar con la suma de los movimientos. Si no,
// el archivo enseñaría dos verdades distintas y la prueba no valdría nada.
const suma = filas.reduce((s, r) => s + Number(r.Monto), 0);
const declarado = Number(filas[filas.length - 1].Saldo);
const esperado = Math.round((SALDO_BASE + suma) * 100) / 100;
if (Math.abs(declarado - esperado) > 0.005) {
  console.error(`El saldo corrido no cuadra: ${declarado} vs ${esperado}. No se escribe nada.`);
  process.exit(1);
}

const libro = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), "Movimientos");
writeFileSync(SALIDA, XLSX.write(libro, { type: "buffer", bookType: "xlsx" }));

const fmt = (n) => n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(`✓ ${SALIDA}`);
console.log(`  ${filas.length} movimientos · ${filas[0].Fecha} al ${ultimo}`);
console.log(`  saldo de partida   S/ ${fmt(SALDO_BASE)}`);
console.log(`  suma de movimientos S/ ${fmt(suma)}`);
console.log(`  saldo declarado    S/ ${fmt(declarado)}   ← lo que debe salir en /caja`);
console.log(`  diferencia con lo conciliado S/ ${fmt(declarado - SALDO_BASE)}`);
