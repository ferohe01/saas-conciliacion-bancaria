import { tramoDe, diasVencido, type ComprobanteCobrar, type Tramo } from "@/lib/aging";
import { normalizar } from "@/lib/filtrosComprobantes";

/**
 * Filtrado de las vistas de saldo (por cobrar / por pagar).
 *
 * La pregunta que resuelven no es "¿de qué mes es esta factura?" sino "¿qué
 * llevo más de 60 días sin cobrar?" y "¿cuánto me debe este cliente?". Por eso
 * se filtra por TRAMO DE ANTIGÜEDAD y por contraparte, y no por período como en
 * el panel de control.
 *
 * El filtro se aplica ANTES de `calcularAging`, no después: así los totales y
 * los tramos que se muestran corresponden a lo filtrado. Filtrar la tabla
 * dejando arriba el total de todo daría dos cifras que no cuadran, que es peor
 * que no filtrar.
 */

export type FiltroSaldo = {
  tramo: Tramo | "todos";
  /** Solo lo ya vencido, sea del tramo que sea. */
  soloVencido: boolean;
  busca: string;
};

export const FILTRO_SALDO_VACIO: FiltroSaldo = {
  tramo: "todos",
  soloVencido: false,
  busca: "",
};

const TRAMOS_VALIDOS: readonly string[] = [
  "por_vencer",
  "d1_30",
  "d31_60",
  "d61_90",
  "d90_mas",
];

export function filtrarSaldo(
  filas: readonly ComprobanteCobrar[],
  f: FiltroSaldo,
  hoy: Date = new Date(),
): ComprobanteCobrar[] {
  const busca = normalizar(f.busca);

  return filas.filter((c) => {
    if (f.tramo !== "todos" || f.soloVencido) {
      const tramo = tramoDe(diasVencido(c, hoy));
      if (f.tramo !== "todos" && tramo !== f.tramo) return false;
      // "Vencido" es todo lo que ya pasó su fecha: cualquier tramo menos el
      // primero, que es justamente el de lo que aún no vence.
      if (f.soloVencido && tramo === "por_vencer") return false;
    }

    if (busca) {
      const heno = normalizar(
        `${c.serie_numero ?? ""} ${c.razon_social_contraparte ?? ""} ${c.ruc_contraparte ?? ""}`,
      );
      if (!heno.includes(busca)) return false;
    }

    return true;
  });
}

export function hayFiltroSaldo(f: FiltroSaldo): boolean {
  return f.tramo !== "todos" || f.soloVencido || f.busca.trim() !== "";
}

export function filtroSaldoDesdeParams(
  sp: Record<string, string | undefined>,
): FiltroSaldo {
  return {
    tramo: TRAMOS_VALIDOS.includes(sp.tramo ?? "")
      ? (sp.tramo as Tramo)
      : "todos",
    soloVencido: sp.vencido === "1",
    busca: sp.busca ?? "",
  };
}
