import type { JobReporte, PuntoMensual } from "@/lib/reportes";

/**
 * Cálculos de presentación del panel de control. Puros: trabajan sobre lo que
 * la página ya trae (conciliaciones aprobadas), sin consultas nuevas.
 */

/** Cuánto cambió la automatización contra el mes calendario anterior. */
export type Variacion = {
  /** Puntos porcentuales: actual − anterior, a un decimal. */
  puntos: number;
  mesActual: number;
  mesAnterior: number;
};

/**
 * Variación de la automatización del mes que se mira contra el anterior.
 *
 * Con un mes elegido se compara ese; con «todo el año», el último mes que tiene
 * conciliaciones. Devuelve `null` —y la pantalla no enseña flecha— cuando no
 * hay contra qué comparar: enero, o un mes anterior sin conciliaciones. Una
 * variación contra un mes vacío no es una subida, es la ausencia de dato.
 */
export function variacionAutomatizacion(
  serie: PuntoMensual[],
  mes: number | "todos",
): Variacion | null {
  const objetivo =
    mes !== "todos"
      ? mes
      : [...serie].reverse().find((p) => p.registros > 0)?.mes;
  if (!objetivo || objetivo <= 1) return null;

  const actual = serie[objetivo - 1];
  const anterior = serie[objetivo - 2];
  if (!actual || !anterior || actual.registros === 0 || anterior.registros === 0) {
    return null;
  }
  return {
    puntos: Math.round((actual.pctAutomatizacion - anterior.pctAutomatizacion) * 10) / 10,
    mesActual: actual.mes,
    mesAnterior: anterior.mes,
  };
}

/** La conciliación más reciente por fecha de cierre (y, a igualdad, la última creada). */
export function ultimoPeriodo(jobs: readonly JobReporte[]): JobReporte | null {
  let mejor: JobReporte | null = null;
  for (const j of jobs) {
    if (
      !mejor ||
      j.periodoHasta > mejor.periodoHasta ||
      (j.periodoHasta === mejor.periodoHasta && j.createdAt > mejor.createdAt)
    ) {
      mejor = j;
    }
  }
  return mejor;
}

/** Un cuadre cierra cuando la diferencia es menor que medio céntimo. */
export const cuadra = (diferencia: number) => Math.abs(diferencia) < 0.005;

/** Símbolo de la moneda de la cuenta. Un código desconocido se muestra tal cual. */
export function simboloMoneda(moneda: string | null | undefined): string {
  if (!moneda || moneda === "PEN") return "S/";
  if (moneda === "USD") return "US$";
  return moneda;
}

/** «S/ 1.234,50» — siempre dos decimales; el signo lo pone quien lo muestra. */
export function formatoDinero(monto: number, moneda?: string | null): string {
  return `${simboloMoneda(moneda)} ${Math.abs(monto).toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
