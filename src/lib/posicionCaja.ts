/**
 * POSICIÓN DE CAJA — «¿cuánta plata tengo?», con fecha.
 *
 * Módulo 2 de la plataforma financiera (ver `docs/diseno-posicion-caja.md`).
 * Puro y con tests: la aritmética que decide qué se muestra como disponible no
 * puede vivir en un componente.
 *
 * ⚠️⚠️ **La regla que gobierna el módulo: ninguna cifra sin su fecha de corte.**
 * El sistema solo conoce el saldo al cierre del último período conciliado, así
 * que un «tienes S/ 138.268» a 20 de agosto puede ser del 31 de julio. Eso no
 * es un defecto —es la naturaleza del dato— pero callarlo sí lo sería: es
 * exactamente el número plausible que nadie puede fechar.
 */

import { formatearFecha } from "@/lib/parsing/resumen";

/** Una cuenta tal como la devuelve `posicion_caja()` (migración 0050). */
export type CuentaCaja = {
  cuentaId: string;
  banco: string;
  numero: string | null;
  moneda: string;
  jobId: string | null;
  corteDesde: string | null;
  corteHasta: string | null;
  /** `null` = no se sabe. Distinto de 0, que es «no hay plata». */
  saldoFinal: number | null;
  entradas: number;
  salidas: number;
  movimientos: number;
  /** Cuántos cortes aprobados se sumaron para entradas y salidas. */
  cortes: number;
  movDesde: string | null;
  movHasta: string | null;
};

export type EstadoFrescura = "al_dia" | "retraso" | "desfasado" | "sin_datos";

export type Frescura = {
  dias: number | null;
  estado: EstadoFrescura;
  /** Lo que se enseña. Nunca el estado a secas. */
  texto: string;
};

/**
 * Umbrales de frescura, en días desde el cierre del último corte.
 *
 * ⚠️ Salen de suponer un cierre MENSUAL: una empresa que cierra el mes M lo
 * concilia durante los primeros días de M+1, así que el corte más reciente
 * posible ronda los 30-35 días. Con 41-70 falta un período; por encima, dos.
 *
 * Si un cliente concilia quincenalmente estos números le quedan holgados. El
 * día que haga falta, esto se vuelve configuración de empresa; hoy sería
 * inventar una perilla que nadie ha pedido.
 */
export const DIAS_AL_DIA = 40;
export const DIAS_RETRASO = 70;

const MS_DIA = 86_400_000;

export function frescuraDelCorte(hasta: string | null, hoy: Date): Frescura {
  if (!hasta) {
    return {
      dias: null,
      estado: "sin_datos",
      texto: "Sin ninguna conciliación aprobada.",
    };
  }
  const corte = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(corte)) {
    return { dias: null, estado: "sin_datos", texto: "Fecha de corte ilegible." };
  }
  const dias = Math.max(
    0,
    Math.floor((Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()) - corte) / MS_DIA),
  );
  const fecha = formatearFecha(hasta);

  if (dias <= DIAS_AL_DIA) {
    return { dias, estado: "al_dia", texto: `Al ${fecha} · tu última conciliación aprobada.` };
  }
  if (dias <= DIAS_RETRASO) {
    return {
      dias,
      estado: "retraso",
      texto: `Estas cifras son del ${fecha}. Han pasado ${dias} días: falta conciliar el último período.`,
    };
  }
  return {
    dias,
    estado: "desfasado",
    texto: `Del ${fecha}, hace ${dias} días. Faltan dos o más períodos: esto ya no describe tu caja de hoy.`,
  };
}

export type BloqueMoneda = {
  moneda: string;
  /** Suma de los saldos de las cuentas que SÍ lo declararon. */
  saldo: number;
  entradas: number;
  salidas: number;
  /** Lo que ya debes y está vencido, en esta misma moneda. */
  vencido: number;
  /** saldo − vencido. Nunca se muestra sin sus dos términos. */
  disponible: number;
  /** El corte MÁS ANTIGUO de las cuentas que componen el total. */
  corteMasAntiguo: string | null;
  frescura: Frescura;
  /** Rango real que abarcan los movimientos sumados. */
  movDesde: string | null;
  movHasta: string | null;
  cortes: number;
  /** Cuentas que aportan saldo. */
  cuentas: CuentaCaja[];
  /** Aprobadas pero sin saldo declarado: no suman, y hay que decirlo. */
  sinSaldo: CuentaCaja[];
  /** Sin ninguna conciliación aprobada. */
  sinConciliar: CuentaCaja[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Agrupa las cuentas por moneda y calcula el disponible.
 *
 * ⚠️ **Nunca suma monedas distintas.** Un total que mezcla soles y dólares no
 * responde a ninguna pregunta y nadie puede saber mirándolo que está mal —
 * misma regla que `agingPorMoneda`, y por el mismo motivo. Tampoco se filtra a
 * una sola: eso escondería el resto.
 *
 * ⚠️ **El total hereda el corte MÁS ANTIGUO** de las cuentas que lo componen.
 * Un total solo vale lo que valga su parte más vieja; quedarse con la fecha más
 * reciente sería maquillar, y promediar fechas no significa nada.
 */
export function consolidarCaja(
  cuentas: CuentaCaja[],
  vencidoPorMoneda: ReadonlyMap<string, number>,
  hoy: Date,
): BloqueMoneda[] {
  const porMoneda = new Map<string, CuentaCaja[]>();
  for (const c of cuentas) {
    const m = (c.moneda || "PEN").toUpperCase();
    const lista = porMoneda.get(m);
    if (lista) lista.push(c);
    else porMoneda.set(m, [c]);
  }

  const bloques: BloqueMoneda[] = [];
  for (const [moneda, suyas] of porMoneda) {
    const conSaldo = suyas.filter((c) => c.saldoFinal != null);
    const sinSaldo = suyas.filter((c) => c.jobId != null && c.saldoFinal == null);
    const sinConciliar = suyas.filter((c) => c.jobId == null);

    const saldo = r2(conSaldo.reduce((s, c) => s + (c.saldoFinal ?? 0), 0));
    const entradas = r2(suyas.reduce((s, c) => s + c.entradas, 0));
    const salidas = r2(suyas.reduce((s, c) => s + c.salidas, 0));
    const vencido = r2(vencidoPorMoneda.get(moneda) ?? 0);

    // El corte que manda es el más antiguo de las que aportan saldo: son las
    // únicas que están dentro del total.
    const fechasCorte = conSaldo
      .map((c) => c.corteHasta)
      .filter((f): f is string => f != null)
      .sort();
    const corteMasAntiguo = fechasCorte[0] ?? null;

    const movs = suyas
      .flatMap((c) => [c.movDesde, c.movHasta])
      .filter((f): f is string => f != null)
      .sort();

    bloques.push({
      moneda,
      saldo,
      entradas,
      salidas,
      vencido,
      disponible: r2(saldo - vencido),
      corteMasAntiguo,
      frescura: frescuraDelCorte(corteMasAntiguo, hoy),
      movDesde: movs[0] ?? null,
      movHasta: movs.at(-1) ?? null,
      cortes: suyas.reduce((s, c) => s + c.cortes, 0),
      cuentas: suyas,
      sinSaldo,
      sinConciliar,
    });
  }

  // Primero la moneda con más saldo: es por la que se empieza a mirar.
  return bloques.sort((a, b) => b.saldo - a.saldo);
}

/** ¿Hay algo que enseñar, o la empresa no ha conciliado nunca? */
export function hayPosicion(bloques: BloqueMoneda[]): boolean {
  return bloques.some((b) => b.cuentas.some((c) => c.jobId != null));
}

/**
 * Cómo rotular el rango de los movimientos.
 *
 * ⚠️ Se etiqueta lo que se SUMÓ, no el mes. Con cortes (01–05, 06–17, 18–30) el
 * saldo es el del último pero las entradas suman los tres, y decir «julio»
 * cuando solo se conciliaron dos semanas sería prometer un mes completo.
 */
export function etiquetaMovimientos(b: BloqueMoneda): string {
  if (!b.movDesde || !b.movHasta) return "sin movimientos conciliados";
  const rango = `${formatearFecha(b.movDesde)} al ${formatearFecha(b.movHasta)}`;
  return b.cortes > 1 ? `${rango} · ${b.cortes} cortes` : rango;
}
