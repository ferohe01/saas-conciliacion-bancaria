/**
 * Normalización de fechas a ISO 8601 (YYYY-MM-DD).
 *
 * Acepta los formatos que aparecen en archivos peruanos:
 *  - ISO: "2026-06-15"
 *  - dd/mm/yyyy o dd-mm-yyyy (convención local): "15/06/2026"
 *  - Objetos Date (SheetJS con cellDates)
 *  - Números de serie de Excel (p. ej. 46187)
 *
 * Convención de ambigüedad: se asume **dd/mm/yyyy** (no mm/dd). El formato
 * dd/mm/yyyy es solo de entrada; toda salida es ISO.
 */

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function isoDesdePartes(anio: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  // Rechaza fechas que "se desbordan" (ej. 31/02).
  if (
    d.getUTCFullYear() !== anio ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia
  ) {
    return null;
  }
  return `${anio}-${pad(mes)}-${pad(dia)}`;
}

/** Convierte un número de serie de Excel a ISO (base 1899-12-30). */
export function fechaDesdeSerialExcel(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Math.round(serial) * 86_400_000;
  const base = Date.UTC(1899, 11, 30);
  const d = new Date(base + ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )}`;
}

export function normalizarFecha(valor: unknown): string | null {
  if (valor == null || valor === "") return null;

  // Date nativo (SheetJS con cellDates: true).
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return `${valor.getUTCFullYear()}-${pad(valor.getUTCMonth() + 1)}-${pad(
      valor.getUTCDate(),
    )}`;
  }

  // Número → serial de Excel (rango razonable de fechas de negocio).
  if (typeof valor === "number") {
    if (valor > 20_000 && valor < 80_000) return fechaDesdeSerialExcel(valor);
    return null;
  }

  const s = String(valor).trim();
  if (!s) return null;

  // ISO YYYY-MM-DD (con posible hora).
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    return isoDesdePartes(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // dd/mm/yyyy o dd-mm-yyyy (también con año de 2 dígitos).
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (dmy) {
    const dia = Number(dmy[1]);
    const mes = Number(dmy[2]);
    let anio = Number(dmy[3]);
    if (anio < 100) anio += anio >= 70 ? 1900 : 2000;
    return isoDesdePartes(anio, mes, dia);
  }

  // Cadena numérica que en realidad es un serial de Excel.
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n > 20_000 && n < 80_000) return fechaDesdeSerialExcel(n);
  }

  return null;
}
