/**
 * Antigüedad de saldos: cuánto te deben (o cuánto debes), quién y desde cuándo.
 *
 * El mismo cálculo sirve para los dos lados —cambia el `tipo` y las etiquetas—
 * porque la pregunta es simétrica: quién tiene pendiente qué, y desde cuándo.
 * Duplicarlo habría significado corregir cada fallo dos veces.
 *
 * Función pura sobre lo que haya en `comprobantes`, venga de la plantilla
 * Excel, de un XML o de donde sea. El saldo lo mantiene el trigger de la
 * migración 0008; aquí solo se agrupa y se ordena.
 */

export type ComprobanteCobrar = {
  id: string;
  fecha: string | null;
  fecha_vencimiento: string | null;
  monto: number | null;
  saldo: number | null;
  tipo: string | null;
  estado: string | null;
  serie_numero: string | null;
  ruc_contraparte: string | null;
  razon_social_contraparte: string | null;
};

export type Tramo = "por_vencer" | "d1_30" | "d31_60" | "d61_90" | "d90_mas";

export const TRAMOS: { id: Tramo; label: string }[] = [
  { id: "por_vencer", label: "Por vencer" },
  { id: "d1_30", label: "1–30 días" },
  { id: "d31_60", label: "31–60 días" },
  { id: "d61_90", label: "61–90 días" },
  { id: "d90_mas", label: "+90 días" },
];

export type FilaContraparte = {
  contraparte: string;
  ruc: string | null;
  total: number;
  vencido: number;
  porTramo: Record<Tramo, number>;
  documentos: number;
};

export type ResumenAging = {
  total: number;
  vencido: number;
  porTramo: Record<Tramo, number>;
  contrapartes: FilaContraparte[];
  documentos: number;
};

const MS_DIA = 24 * 60 * 60 * 1000;
const SIN_NOMBRE = "Sin identificar";
export type TipoSaldo = "cobranza" | "pago";

function vacio(): Record<Tramo, number> {
  return { por_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mas: 0 };
}

/**
 * Días vencidos de un comprobante.
 *
 * Se cuenta desde el vencimiento; si no lo tiene —muchas ventas son al
 * contado— se usa la emisión, que es la mejor referencia disponible. Negativo
 * significa que todavía no vence.
 */
export function diasVencido(
  c: Pick<ComprobanteCobrar, "fecha" | "fecha_vencimiento">,
  hoy: Date = new Date(),
): number | null {
  const ref = c.fecha_vencimiento ?? c.fecha;
  if (!ref) return null;
  const d = new Date(`${ref}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const hoyUTC = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Math.floor((hoyUTC - d.getTime()) / MS_DIA);
}

export function tramoDe(dias: number | null): Tramo {
  if (dias === null || dias <= 0) return "por_vencer";
  if (dias <= 30) return "d1_30";
  if (dias <= 60) return "d31_60";
  if (dias <= 90) return "d61_90";
  return "d90_mas";
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Agrupa por contraparte lo que queda pendiente de un lado.
 *
 * **Nunca mezcla cobranzas con pagos.** Sumar lo que te deben con lo que debes
 * da un número que no responde a ninguna pregunta: no se sabe si está a favor
 * o en contra. Son dos preguntas distintas del negocio y se gestionan distinto
 * —a los clientes los persigues, a los proveedores los programas—, así que cada
 * lado se pide por separado.
 *
 * Solo entra lo que tiene saldo vivo: lo saldado y lo anulado no son deuda.
 */
export function calcularAging(
  comprobantes: ComprobanteCobrar[],
  hoy: Date = new Date(),
  tipo: TipoSaldo = "cobranza",
): ResumenAging {
  const porContraparte = new Map<string, FilaContraparte>();
  const total = { monto: 0, vencido: 0, tramos: vacio(), docs: 0 };

  for (const c of comprobantes) {
    // El lado contrario nunca entra. Los comprobantes sin tipo se tratan como
    // cobranza, que es como los interpreta el resto del sistema.
    const suTipo: TipoSaldo = c.tipo === "pago" ? "pago" : "cobranza";
    if (suTipo !== tipo) continue;
    if (c.estado === "anulado" || c.estado === "cobrado") continue;

    const saldo = Number(c.saldo ?? 0);
    if (!(saldo > 0.005)) continue;

    const dias = diasVencido(c, hoy);
    const tramo = tramoDe(dias);
    const nombre = (c.razon_social_contraparte ?? "").trim() || SIN_NOMBRE;

    let fila = porContraparte.get(nombre);
    if (!fila) {
      fila = {
        contraparte: nombre,
        ruc: c.ruc_contraparte ?? null,
        total: 0,
        vencido: 0,
        porTramo: vacio(),
        documentos: 0,
      };
      porContraparte.set(nombre, fila);
    }

    fila.total += saldo;
    fila.porTramo[tramo] += saldo;
    fila.documentos += 1;
    if (tramo !== "por_vencer") fila.vencido += saldo;

    total.monto += saldo;
    total.tramos[tramo] += saldo;
    total.docs += 1;
    if (tramo !== "por_vencer") total.vencido += saldo;
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
