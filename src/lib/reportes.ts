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
  mes: number; // 1..12, derivado de periodoDesde (para la tendencia mensual)
  periodoDesde: string; // ISO YYYY-MM-DD — el rango real conciliado
  periodoHasta: string; // ISO YYYY-MM-DD
  banco: string;
  cuentaId: string;
  numero: string | null;
  resumen: ResumenJob;
  diferenciaCuadre: number;
  createdAt: string; // ISO, para elegir la conciliación más reciente
  categorias?: Record<string, number>; // tipos de diferencia (reason codes)
};

/**
 * Deduplica corridas repetidas: si el MISMO rango de la MISMA cuenta se
 * concilió varias veces, se conserva solo la más reciente. El historial en
 * /conciliacion sí las conserva todas.
 *
 * ⚠️ La clave es el rango exacto (`periodoDesde`–`periodoHasta`), NO el mes.
 * Agrupar por mes parecía equivalente mientras cada mes se conciliaba de una
 * sola vez, pero descarta silenciosamente los cortes parciales: con julio
 * dividido en 1–10, 11–20 y 21–31, sobrevivía únicamente el último corte y los
 * totales del mes salían falsos, no incompletos.
 *
 * Dos corridas del mismo rango siguen colapsando en una, que es justo lo que
 * evita contar dos veces un período reprocesado.
 */
export function deduplicarUltimoPorPeriodo(jobs: JobReporte[]): JobReporte[] {
  const porClave = new Map<string, JobReporte>();
  for (const j of jobs) {
    const clave = `${j.cuentaId}|${j.periodoDesde}|${j.periodoHasta}`;
    const previo = porClave.get(clave);
    if (!previo || j.createdAt > previo.createdAt) porClave.set(clave, j);
  }
  return [...porClave.values()];
}

export type FiltroReporte = {
  anio: number;
  mes: number | "todos";
  banco: string | "todos";
  cuentaId: string | "todos";
};

/**
 * Aplica el filtro del panel a filas de job SIN normalizar a `JobReporte`.
 *
 * `filtrarAnual`/`filtrarMes` solo sirven para lo ya agregado, que en el panel
 * son únicamente las conciliaciones aprobadas. Pero el panel también muestra
 * trabajo pendiente y actividad reciente, que viven en las NO aprobadas, y eso
 * quedaba fuera de todo filtro: elegir una cuenta sin conciliaciones seguía
 * anunciando "12 sugerencias esperan tu revisión" de otra cuenta distinta.
 */
export function enFocoDelFiltro<
  T extends { periodo_desde: string; cuenta_id: string },
>(
  jobs: readonly T[],
  filtro: FiltroReporte,
  bancoDeCuenta: ReadonlyMap<string, string>,
): T[] {
  return jobs.filter((j) => {
    if (Number(j.periodo_desde.slice(0, 4)) !== filtro.anio) return false;
    if (filtro.mes !== "todos" && Number(j.periodo_desde.slice(5, 7)) !== filtro.mes) {
      return false;
    }
    if (filtro.cuentaId !== "todos" && j.cuenta_id !== filtro.cuentaId) return false;
    if (
      filtro.banco !== "todos" &&
      bancoDeCuenta.get(j.cuenta_id) !== filtro.banco
    ) {
      return false;
    }
    return true;
  });
}

// Colores categóricos (Okabe-Ito, validados para daltonismo).
export const COLOR_METODO = {
  exacta: "#009E73",
  difusa: "#0072B2",
  ia: "#CC79A7",
  sin_conciliar: "#D55E00",
} as const;

/**
 * Cómo se llama cada método EN TODA LA APLICACIÓN.
 *
 * ⚠️ Estaban escritas cuatro veces —la insignia de cada par, el panel, los
 * reportes y el detalle por tipo— y no coincidían: el panel decía «Sugerido IA»
 * y la insignia del mismo par decía «IA». Un cliente lo cazó comparando dos
 * pantallas y preguntando cuál era la buena.
 *
 * No es cosmético. El nombre del método es la unidad con la que el usuario
 * razona sobre su conciliación; si cambia de pantalla en pantalla, cada una
 * parece hablar de algo distinto y las cifras dejan de poder compararse.
 *
 * `sin_conciliar` va aquí aunque no sea un método: aparece en las mismas listas
 * y tenía el mismo problema.
 */
export const ETIQUETA_METODO = {
  exacta: "Exacta",
  difusa: "Difusa",
  ia: "Sugerido IA",
  manual: "Manual",
  sin_conciliar: "Sin conciliar",
} as const;

export type ClaveMetodo = keyof typeof ETIQUETA_METODO;

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
  /** Sueltas de cada lado. La suma sola no responde a lo que se pregunta. */
  sinConciliarInternos: number;
  sinConciliarBancarios: number;
  /** Registros + movimientos: la base con la que el % de sueltas cuadra. */
  partidas: number;
  pctSinConciliar: number;
  metodos: { exacta: number; difusa: number; ia: number; sin_conciliar: number };
  /** Pares emparejados, la base del gráfico de métodos. */
  paresConciliados: number;
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
    // ⚠️ Los dos lados POR SEPARADO, además de la suma.
    //
    // «Sin conciliar: 7.313» es la suma de 4.384 registros tuyos y 2.929
    // movimientos del banco, y a nadie le sirve así: quien mira el panel quiere
    // saber cuántas partidas SUYAS quedaron sueltas. Un cliente lo cazó a la
    // primera —«debería decir 4.384»— y tenía razón en el fondo aunque el
    // total fuera correcto.
    sinConciliarInternos: sinInt,
    sinConciliarBancarios: sinBanc,
    /** Los dos lados juntos: la única base con la que el % de sueltas cuadra. */
    partidas: registros + movimientos,
    pctSinConciliar: pct(sinConciliar, registros + movimientos),
    pctAutomatizacion: pct(autoConciliados, registros),
    jobsCuadrados: cuadrados,
    pctCuadre: pct(cuadrados, jobs.length),
    metodos: { exacta, difusa, ia, sin_conciliar: sinConciliar },
    /**
     * ⚠️ Solo lo CONCILIADO, y en pares. Es la base honesta del gráfico «cómo se
     * concilió»: un par consume una partida de cada lado, así que sumarle las
     * sueltas mezcla dos unidades y da un total (455.383) que no es ni pares ni
     * partidas. El 2 % que salía de ahí no significaba nada.
     */
    paresConciliados: exacta + difusa + ia,
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

// ── Tipos de diferencia (reason codes) ──────────────────────────────────────

export type MatchLite = {
  categoria_diferencia?: string | null;
  diferencia_monto?: number | null;
  estado_revision?: string;
};

/** Clave de tipo de diferencia (reason code) de un match. */
export function categoriaDeMatch(m: MatchLite): string {
  return (
    m.categoria_diferencia ??
    (Math.abs(Number(m.diferencia_monto ?? 0)) < 0.005
      ? "sin_diferencia"
      : "otros")
  );
}

/** Cuenta los matches de un job por tipo de diferencia (categoria). */
export function contarCategorias(matches: MatchLite[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of matches ?? []) {
    if (m.estado_revision === "rechazado") continue;
    const cat = categoriaDeMatch(m);
    out[cat] = (out[cat] ?? 0) + 1;
  }
  return out;
}

const ETIQUETA_TIPO: Record<string, string> = {
  sin_diferencia: "Sin diferencia (exacto)",
  comision_bancaria: "Comisión bancaria",
  pago_parcial: "Pago parcial",
  diferencia_temporal: "Diferencia temporal",
  diferencia_moneda: "Diferencia de moneda",
  redondeo: "Redondeo",
  requiere_revision: "Requiere revisión",
  requiere_investigacion: "Requiere investigación",
  ajuste_manual: "Ajuste manual",
  ajuste_requerido: "Ajuste requerido",
  agrupacion_1aN: "Agrupación 1:N",
  otros: "Otros",
};

export function etiquetaTipo(tipo: string): string {
  return (
    ETIQUETA_TIPO[tipo] ??
    tipo.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

/**
 * Estado de revisión de un match, en el idioma del usuario. Los reportes
 * mostraban (y exportaban a Excel) el literal crudo del contrato.
 */
const ETIQUETA_ESTADO_REVISION: Record<string, string> = {
  pendiente: "Por revisar",
  aceptado: "Aceptado por ti",
  rechazado: "Rechazado por ti",
  modificado: "Ajustado a mano",
  auto: "Conciliado automáticamente",
};

export function etiquetaEstadoRevision(estado: string): string {
  return (
    ETIQUETA_ESTADO_REVISION[estado] ??
    estado.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

export type FilaTipo = { tipo: string; label: string; valor: number };

/** Distribución por tipo de diferencia, sumada sobre los jobs, ordenada desc. */
export function porTipoDiferencia(jobs: JobReporte[]): FilaTipo[] {
  const acc: Record<string, number> = {};
  for (const j of jobs) {
    for (const [k, v] of Object.entries(j.categorias ?? {})) {
      acc[k] = (acc[k] ?? 0) + v;
    }
  }
  return Object.entries(acc)
    .map(([tipo, valor]) => ({ tipo, label: etiquetaTipo(tipo), valor }))
    .sort((a, b) => b.valor - a.valor);
}

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
