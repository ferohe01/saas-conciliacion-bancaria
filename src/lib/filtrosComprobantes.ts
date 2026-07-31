/**
 * Filtrado de comprobantes y de las vistas de saldo. Funciones puras.
 *
 * Deliberadamente NO reproduce los filtros del panel de control. Allí se filtra
 * por banco y cuenta porque una conciliación pertenece a una cuenta bancaria;
 * un comprobante no pertenece a ninguna. Y en el aging la pregunta del negocio
 * no es "¿de qué mes es esta factura?" sino "¿qué llevo más de 60 días sin
 * cobrar?", así que se filtra por tramo de antigüedad y no por período.
 */

export type FiltroComprobantes = {
  tipo: "todos" | "cobranza" | "pago";
  estado: "todos" | "pendiente" | "parcial" | "cobrado" | "anulado";
  anio: number | "todos";
  mes: number | "todos";
  busca: string;
};

export const FILTRO_COMPROBANTES_VACIO: FiltroComprobantes = {
  tipo: "todos",
  estado: "todos",
  anio: "todos",
  mes: "todos",
  busca: "",
};

type ComprobanteFiltrable = {
  fecha: string | null;
  tipo: string | null;
  estado: string | null;
  serie_numero: string | null;
  razon_social_contraparte: string | null;
};

/**
 * Normaliza para buscar: sin tildes, sin mayúsculas. Quien escribe "garcia"
 * espera encontrar a "García"; obligarle a acertar la tilde es hacerle trabajar
 * a él lo que puede hacer la máquina.
 */
export function normalizar(s: string): string {
  // `\p{Diacritic}` en vez de un rango de combinantes escrito a mano: no
  // depende de cómo se guarde este archivo y dice lo que hace.
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function filtrarComprobantes<T extends ComprobanteFiltrable>(
  filas: readonly T[],
  f: FiltroComprobantes,
): T[] {
  const busca = normalizar(f.busca);

  return filas.filter((c) => {
    // Un comprobante sin tipo se trata como cobranza, igual que en el resto
    // del sistema (ver `aging.ts`).
    const tipo = c.tipo === "pago" ? "pago" : "cobranza";
    if (f.tipo !== "todos" && tipo !== f.tipo) return false;
    if (f.estado !== "todos" && c.estado !== f.estado) return false;

    if (f.anio !== "todos" || f.mes !== "todos") {
      if (!c.fecha) return false;
      if (f.anio !== "todos" && Number(c.fecha.slice(0, 4)) !== f.anio) return false;
      if (f.mes !== "todos" && Number(c.fecha.slice(5, 7)) !== f.mes) return false;
    }

    if (busca) {
      const heno = normalizar(
        `${c.serie_numero ?? ""} ${c.razon_social_contraparte ?? ""}`,
      );
      if (!heno.includes(busca)) return false;
    }

    return true;
  });
}

export function hayFiltroComprobantes(f: FiltroComprobantes): boolean {
  return (
    f.tipo !== "todos" ||
    f.estado !== "todos" ||
    f.anio !== "todos" ||
    f.mes !== "todos" ||
    f.busca.trim() !== ""
  );
}

/** Lee el filtro de los searchParams, tolerando basura en la URL. */
export function filtroDesdeParams(
  sp: Record<string, string | undefined>,
): FiltroComprobantes {
  const tipo = sp.tipo === "cobranza" || sp.tipo === "pago" ? sp.tipo : "todos";
  const estados = ["pendiente", "parcial", "cobrado", "anulado"] as const;
  const estado = estados.includes(sp.estado as (typeof estados)[number])
    ? (sp.estado as FiltroComprobantes["estado"])
    : "todos";
  const anio = Number(sp.anio);
  const mes = Number(sp.mes);
  return {
    tipo,
    estado,
    anio: Number.isFinite(anio) && anio > 1900 ? anio : "todos",
    mes: Number.isFinite(mes) && mes >= 1 && mes <= 12 ? mes : "todos",
    busca: sp.busca ?? "",
  };
}
