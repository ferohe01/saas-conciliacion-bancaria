import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";
import type { MapeoColumnas } from "./deteccion";

/** Resumen calculado de un archivo cargado (feedback inmediato del Paso 1). */
export type ResumenArchivo = {
  registros: number;
  sumaTotal: number; // suma de |monto| de las filas con monto válido
  fechasISO: string[]; // fechas válidas detectadas (ISO)
  fechaMin: string | null;
  fechaMax: string | null;
};

export function calcularResumen(
  filas: Record<string, unknown>[],
  mapeo: MapeoColumnas,
): ResumenArchivo {
  let sumaTotal = 0;
  const fechasISO: string[] = [];

  for (const fila of filas) {
    if (mapeo.monto) {
      const m = normalizarMonto(fila[mapeo.monto]);
      if (m != null) sumaTotal += Math.abs(m);
    }
    if (mapeo.fecha) {
      const f = normalizarFecha(fila[mapeo.fecha]);
      if (f) fechasISO.push(f);
    }
  }

  fechasISO.sort(); // ISO ordena lexicográficamente

  return {
    registros: filas.length,
    sumaTotal,
    fechasISO,
    fechaMin: fechasISO[0] ?? null,
    fechaMax: fechasISO[fechasISO.length - 1] ?? null,
  };
}

/** Formatea un monto en soles para pantalla: "S/ 312,450.00". */
export function formatearPEN(monto: number, moneda = "PEN"): string {
  const simbolo = moneda === "USD" ? "US$ " : "S/ ";
  return (
    simbolo +
    monto.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Formatea una fecha ISO a dd/mm/yyyy para pantalla. */
export function formatearFecha(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
