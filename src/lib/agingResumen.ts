import {
  TRAMOS,
  type FilaContraparte,
  type ResumenAging,
  type Tramo,
} from "@/lib/aging";

/**
 * Convierte lo que devuelve `resumen_saldos` (migración 0021) en el mismo
 * `ResumenAging` que producía `calcularAging`.
 *
 * La suma ocurre ahora en Postgres —ver el comentario de la 0021— y aquí solo
 * se pivota: una fila por (contraparte, tramo) pasa a una fila por contraparte
 * con sus cinco tramos. Son unas decenas de filas, no medio millón.
 *
 * La forma de salida es EXACTAMENTE la de `calcularAging` a propósito: la
 * pantalla no se entera de dónde vino el cálculo, y mientras sea así se puede
 * comparar una contra otra en los tests.
 */

export type FilaResumenSaldo = {
  contraparte: string;
  ruc: string | null;
  tramo: string;
  total: number | string;
  documentos: number | string;
};

const redondear = (n: number) => Math.round(n * 100) / 100;

function vacio(): Record<Tramo, number> {
  return { por_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mas: 0 };
}

const TRAMOS_VALIDOS = new Set<string>(TRAMOS.map((t) => t.id));

export function agingDesdeResumen(filas: FilaResumenSaldo[]): ResumenAging {
  const porContraparte = new Map<string, FilaContraparte>();
  const total = { monto: 0, vencido: 0, tramos: vacio(), docs: 0 };

  for (const f of filas) {
    // Un tramo que no reconocemos se descarta en vez de romper el pivote: la
    // alternativa sería una pantalla en blanco por un valor inesperado.
    if (!TRAMOS_VALIDOS.has(f.tramo)) continue;
    const tramo = f.tramo as Tramo;
    // Postgres devuelve `numeric` como cadena para no perder precisión.
    const monto = Number(f.total ?? 0);
    const docs = Number(f.documentos ?? 0);

    let fila = porContraparte.get(f.contraparte);
    if (!fila) {
      fila = {
        contraparte: f.contraparte,
        ruc: f.ruc ?? null,
        total: 0,
        vencido: 0,
        porTramo: vacio(),
        documentos: 0,
      };
      porContraparte.set(f.contraparte, fila);
    }
    // El RUC puede venir nulo en el tramo que llegue primero y con valor en
    // otro: se queda el primero que exista.
    if (fila.ruc == null && f.ruc != null) fila.ruc = f.ruc;

    fila.total += monto;
    fila.porTramo[tramo] += monto;
    fila.documentos += docs;
    if (tramo !== "por_vencer") fila.vencido += monto;

    total.monto += monto;
    total.tramos[tramo] += monto;
    total.docs += docs;
    if (tramo !== "por_vencer") total.vencido += monto;
  }

  const contrapartes = [...porContraparte.values()]
    .map((f) => ({
      ...f,
      total: redondear(f.total),
      vencido: redondear(f.vencido),
      porTramo: Object.fromEntries(
        Object.entries(f.porTramo).map(([k, v]) => [k, redondear(v)]),
      ) as Record<Tramo, number>,
    }))
    // Primero quien más tiene vencido: por ahí se empieza a gestionar.
    .sort((a, b) => b.vencido - a.vencido || b.total - a.total);

  return {
    total: redondear(total.monto),
    vencido: redondear(total.vencido),
    porTramo: Object.fromEntries(
      Object.entries(total.tramos).map(([k, v]) => [k, redondear(v)]),
    ) as Record<Tramo, number>,
    contrapartes,
    documentos: total.docs,
  };
}
