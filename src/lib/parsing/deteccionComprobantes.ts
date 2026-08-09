import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";
import { detectarCon } from "./deteccion";
import {
  CAMPOS_COMPROBANTE,
  normalizarTipo,
  type CampoComprobante,
  type MapeoComprobantes,
} from "./mapeoComprobantes";

/**
 * Detección de columnas para el archivo de comprobantes del cliente.
 *
 * Comparte maquinaria con la del extracto (`detectarCon`) y cambia solo el
 * vocabulario: son dos idiomas, no dos algoritmos. Un libro de ventas peruano
 * dice "F. EMISIÓN", "RAZÓN SOCIAL" y "TOTAL"; un extracto dice "GLOSA" y
 * "OPERACIÓN".
 *
 * ⚠️ El usuario siempre puede corregirla. La detección ahorra trabajo, no
 * decide: acertar nueve columnas de diez y equivocarse en una sin que se vea
 * sería peor que no detectar nada — es exactamente cómo se llegó a la
 * conciliación al 0 %.
 */

const KEYWORDS: Record<CampoComprobante, string[]> = {
  fecha: [
    "fecha", "f. emision", "f emision", "fecha emision", "fecha de emision",
    "emision", "date", "dia",
  ],
  fecha_vencimiento: [
    "vencimiento", "f. vencimiento", "fecha vencimiento", "vence",
    "fecha de pago", "due",
  ],
  monto: [
    "monto", "importe", "total", "amount", "valor", "precio",
    "total comprobante", "importe total", "soles", "mto",
  ],
  tipo: ["tipo", "tipo documento", "tipo comprobante", "clase", "type"],
  // El número del documento: identifica la factura y no se repite.
  serie_numero: [
    "serie", "numero", "nro", "n documento", "nro documento", "num documento",
    "documento", "comprobante", "serie numero", "serie-numero", "correlativo",
    "factura",
  ],
  // Con qué casarlo en el banco: SE REPITE a propósito (ver migración 0020).
  referencia_externa: [
    "referencia", "ref", "operacion", "nro operacion", "n operacion",
    "codigo operacion", "recibo", "recibos", "deposito", "voucher",
  ],
  ruc_contraparte: ["ruc", "documento identidad", "dni", "nro documento cliente"],
  razon_social: [
    "razon social", "razon", "cliente", "proveedor", "nombre", "contraparte",
    "beneficiario", "denominacion",
  ],
  descripcion: [
    "descripcion", "detalle", "concepto", "glosa", "observacion",
    "observaciones", "nota",
  ],
};

function fraccion<T>(items: T[], pred: (x: T) => boolean): number {
  if (items.length === 0) return 0;
  return items.filter(pred).length / items.length;
}

/**
 * Puntaje por lo que hay DENTRO de la columna.
 *
 * Vale más que el nombre en los casos ambiguos: un export puede llamar "DOC" a
 * la columna de fechas, y el contenido no engaña.
 */
function puntajeContenido(campo: CampoComprobante, valores: unknown[]): number {
  const noVacios = valores.filter((v) => v != null && String(v).trim() !== "");
  if (noVacios.length === 0) return 0;

  switch (campo) {
    case "fecha":
    case "fecha_vencimiento":
      return fraccion(noVacios, (v) => normalizarFecha(v) != null) * 2.5;
    case "monto":
      // Numérico pero NO fecha: un serial o una fecha en número se leen como
      // importe y arruinarían el mapeo sin que nada lo delate.
      return (
        fraccion(
          noVacios,
          (v) => normalizarMonto(v) != null && normalizarFecha(v) == null,
        ) * 2
      );
    case "tipo":
      return fraccion(noVacios, (v) => normalizarTipo(v) != null) * 2.5;
    case "ruc_contraparte":
      // RUC peruano: 11 dígitos empezando por 10, 15, 17 o 20.
      return (
        fraccion(noVacios, (v) => /^(10|15|17|20)\d{9}$/.test(String(v).trim())) *
        2.5
      );
    default:
      return 0;
  }
}

export function detectarColumnasComprobante(
  headers: string[],
  muestras: Record<string, unknown>[],
): MapeoComprobantes {
  return detectarCon(
    CAMPOS_COMPROBANTE,
    KEYWORDS,
    puntajeContenido,
    headers,
    muestras,
  );
}
