import { nombreMes } from "@/lib/periodo";

/**
 * Agregación para el módulo de reportes. Funciones puras (testeables) que toman
 * los jobs completados y calculan KPIs, distribución de métodos, tendencia
 * mensual y desglose por banco.
 */

export type ResumenJob = {
  total_internos: number;
  total_bancarios: number;
  conciliados_exactos: number;
  conciliados_difusos: number;
  sugeridos_ia: number;
  sin_conciliar_internos: number;
  sin_conciliar_bancarios: number;
};

export type JobReporte = {
  id: string;
  anio: number;
  mes: number; // 1..12
  banco: string;
  cuentaId: string;
  numero: string | null;
  resumen: ResumenJob;
  diferenciaCuadre: number;
};

export type FiltroReporte = {
  anio: number;
  mes: number | "todos";
  banco: string | "todos";
  cuentaId: string | "todos";
};

// Colores categóricos (Okabe-Ito, validados para daltonismo).
export const COLOR_METODO = {
  exacta: "#009E73",
  difusa: "#0072B2",
  ia: "#CC79A7",
  sin_conciliar: "#D55E00",
} as const;

function pct(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
}

/** Filtra por año + banco + cuenta (sin mes: útil para la tendencia anual). */
export function filtrarAnual(
  jobs: JobReporte[],
  f: Pick<FiltroReporte, "anio" | "banco" | "cuentaId">,
): JobReporte[] {
  return jobs.filter(
    (j) =>
      j.anio === f.anio &&
      (f.banco === "todos" || j.banco === f.banco) &&
      (f.cuentaId === "todos" || j.cuentaId === f.cuentaId),
  );
}

/** Aplica además el filtro de mes. */
export function filtrarMes(jobs: JobReporte[], mes: number | "todos"): JobReporte[] {
  return mes === "todos" ? jobs : jobs.filter((j) => j.mes === mes);
}

export type Kpis = {
  conciliaciones: number;
  registros: number;
  movimientos: number;
  autoConciliados: number;
  sugeridosIa: number;
  sinConciliar: number;
  pctAutomatizacion: number;
  jobsCuadrados: number;
  pctCuadre: number;
  metodos: { exacta: number; difusa: number; ia: number; sin_conciliar: number };
};

export function calcularKpis(jobs: JobReporte[]): Kpis {
  let registros = 0,
    movimientos = 0,
    exacta = 0,
    difusa = 0,
    ia = 0,
    sinInt = 0,
    sinBanc = 0,
    cuadrados = 0;

  for (const j of jobs) {
    const r = j.resumen;
    registros += r.total_internos;
    movimientos += r.total_bancarios;
    exacta += r.conciliados_exactos;
    difusa += r.conciliados_difusos;
    ia += r.sugeridos_ia;
    sinInt += r.sin_conciliar_internos;
    sinBanc += r.sin_conciliar_bancarios;
    if (Math.abs(j.diferenciaCuadre) < 0.005) cuadrados++;
  }

  const autoConciliados = exacta + difusa;
  const sinConciliar = sinInt + sinBanc;

  return {
    conciliaciones: jobs.length,
    registros,
    movimientos,
    autoConciliados,
    sugeridosIa: ia,
    sinConciliar,
    pctAutomatizacion: pct(autoConciliados, registros),
    jobsCuadrados: cuadrados,
    pctCuadre: pct(cuadrados, jobs.length),
    metodos: { exacta, difusa, ia, sin_conciliar: sinConciliar },
  };
}

export type PuntoMensual = {
  mes: number;
  etiqueta: string;
  conciliaciones: number;
  registros: number;
  autoConciliados: number;
  pctAutomatizacion: number;
};

/** Tendencia de los 12 meses del año (todos, aunque estén en cero). */
export function porMes(jobsAnio: JobReporte[]): PuntoMensual[] {
  const meses: PuntoMensual[] = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    etiqueta: nombreMes(i + 1).slice(0, 3),
    conciliaciones: 0,
    registros: 0,
    autoConciliados: 0,
    pctAutomatizacion: 0,
  }));

  for (const j of jobsAnio) {
    const m = meses[j.mes - 1];
    if (!m) continue;
    m.conciliaciones += 1;
    m.registros += j.resumen.total_internos;
    m.autoConciliados +=
      j.resumen.conciliados_exactos + j.resumen.conciliados_difusos;
  }
  for (const m of meses) m.pctAutomatizacion = pct(m.autoConciliados, m.registros);
  return meses;
}

export type FilaBanco = {
  banco: string;
  conciliaciones: number;
  registros: number;
  autoConciliados: number;
  pctAutomatizacion: number;
};

export function porBanco(jobs: JobReporte[]): FilaBanco[] {
  const map = new Map<string, FilaBanco>();
  for (const j of jobs) {
    const f =
      map.get(j.banco) ??
      map
        .set(j.banco, {
          banco: j.banco,
          conciliaciones: 0,
          registros: 0,
          autoConciliados: 0,
          pctAutomatizacion: 0,
        })
        .get(j.banco)!;
    f.conciliaciones += 1;
    f.registros += j.resumen.total_internos;
    f.autoConciliados +=
      j.resumen.conciliados_exactos + j.resumen.conciliados_difusos;
  }
  const filas = [...map.values()];
  for (const f of filas) f.pctAutomatizacion = pct(f.autoConciliados, f.registros);
  return filas.sort((a, b) => b.registros - a.registros);
}
