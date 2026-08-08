import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";

/**
 * Detección automática de columnas por heurística (nombre de encabezado +
 * contenido de las primeras filas). Devuelve, para cada campo canónico, el
 * encabezado que mejor lo representa. La interfaz queda preparada para mejorar
 * esta detección con IA más adelante; el usuario siempre puede corregirla en el
 * Paso 2.
 */

export type CampoCanonico =
  | "fecha"
  | "monto"
  | "tipo"
  | "referencia"
  | "contraparte"
  | "descripcion";

export type MapeoColumnas = Partial<Record<CampoCanonico, string>>;

export const CAMPOS: CampoCanonico[] = [
  "fecha",
  "monto",
  "tipo",
  "referencia",
  "contraparte",
  "descripcion",
];

export const ETIQUETA_CAMPO: Record<CampoCanonico, string> = {
  fecha: "Fecha",
  monto: "Monto",
  tipo: "Tipo",
  referencia: "Referencia / Nº operación",
  contraparte: "Contraparte",
  descripcion: "Descripción / Glosa",
};

function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Palabras clave por campo (ya sin acentos).
const KEYWORDS: Record<CampoCanonico, string[]> = {
  fecha: ["fecha", "date", "dia", "f. emision", "f emision", "periodo"],
  monto: [
    "monto",
    "importe",
    "total",
    "amount",
    "valor",
    "cargo",
    "abono",
    "debe",
    "haber",
    "soles",
    "dolares",
  ],
  tipo: ["tipo", "type", "operacion", "movimiento", "clase"],
  referencia: [
    "referencia",
    "ref",
    "nro operacion",
    "n operacion",
    "numero",
    "nro",
    "serie",
    "documento",
    "comprobante",
    "id",
    // Una recaudadora llama "recibo" a lo que el banco trae como referencia, y
    // es LA columna por la que se concilia: sin detectarla, el usuario tiene
    // que acertar a mano cuál es, y si no lo hace la conciliación da 0%.
    "recibo",
    "recibos",
    "operacion",
  ],
  contraparte: [
    "contraparte",
    "cliente",
    "proveedor",
    "razon social",
    "razon",
    "nombre",
    "beneficiario",
    "ruc",
  ],
  descripcion: [
    "descripcion",
    "glosa",
    "detalle",
    "concepto",
    "observacion",
    "observaciones",
  ],
};

const VALORES_TIPO = new Set([
  "cobranza",
  "pago",
  "abono",
  "cargo",
  "deposito",
  "retiro",
  "ingreso",
  "egreso",
]);

function fraccion<T>(items: T[], pred: (x: T) => boolean): number {
  if (items.length === 0) return 0;
  return items.filter(pred).length / items.length;
}

function puntajeNombre(campo: CampoCanonico, header: string): number {
  const h = normalizarTexto(header);
  if (!h) return 0;
  let mejor = 0;
  for (const kw of KEYWORDS[campo]) {
    if (h === kw) mejor = Math.max(mejor, 3);
    else if (h.includes(kw)) mejor = Math.max(mejor, 2);
  }
  return mejor;
}

function puntajeContenido(
  campo: CampoCanonico,
  valores: unknown[],
): number {
  const noVacios = valores.filter((v) => v != null && String(v).trim() !== "");
  if (noVacios.length === 0) return 0;

  switch (campo) {
    case "fecha":
      return fraccion(noVacios, (v) => normalizarFecha(v) != null) * 2.5;
    case "monto": {
      // Numérico pero NO fecha (evita confundir seriales/fechas con montos).
      const numerico = fraccion(
        noVacios,
        (v) => normalizarMonto(v) != null && normalizarFecha(v) == null,
      );
      return numerico * 2;
    }
    case "tipo":
      return (
        fraccion(noVacios, (v) =>
          VALORES_TIPO.has(normalizarTexto(String(v))),
        ) * 2.5
      );
    default:
      return 0;
  }
}

export function detectarColumnas(
  headers: string[],
  muestras: Record<string, unknown>[],
): MapeoColumnas {
  // Matriz de puntajes campo×header.
  type Celda = { campo: CampoCanonico; header: string; score: number };
  const celdas: Celda[] = [];

  for (const campo of CAMPOS) {
    for (const header of headers) {
      const valores = muestras.map((f) => f[header]);
      const score =
        puntajeNombre(campo, header) + puntajeContenido(campo, valores);
      if (score > 0) celdas.push({ campo, header, score });
    }
  }

  // Asignación greedy por puntaje descendente, sin reutilizar header ni campo.
  celdas.sort((a, b) => b.score - a.score);
  const mapeo: MapeoColumnas = {};
  const headersUsados = new Set<string>();

  for (const c of celdas) {
    if (mapeo[c.campo] != null) continue;
    if (headersUsados.has(c.header)) continue;
    mapeo[c.campo] = c.header;
    headersUsados.add(c.header);
  }

  return mapeo;
}
