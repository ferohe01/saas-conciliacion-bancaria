import * as XLSX from "xlsx";

/**
 * Plantilla Excel para MYPES sin sistema. Genera un archivo con las columnas
 * canónicas de `comprobantes` y una fila de ejemplo, para que el usuario la
 * llene y la vuelva a subir (origen 'plantilla').
 */

export const COLUMNAS_PLANTILLA = [
  "fecha",
  "monto",
  "tipo",
  "referencia",
  "ruc_contraparte",
  "razon_social",
  "descripcion",
] as const;

const FILA_EJEMPLO: Record<(typeof COLUMNAS_PLANTILLA)[number], string> = {
  fecha: "15/06/2026",
  monto: "4950.00",
  tipo: "cobranza",
  referencia: "F001-234",
  ruc_contraparte: "20123456789",
  razon_social: "Ferretería Lima Norte EIRL",
  descripcion: "Pago factura F001-234",
};

/** Construye el workbook de la plantilla (reutilizable para tests). */
export function construirPlantilla(): XLSX.WorkBook {
  const hoja = XLSX.utils.json_to_sheet([FILA_EJEMPLO], {
    header: [...COLUMNAS_PLANTILLA],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja, "Comprobantes");
  return wb;
}

/** Descarga la plantilla en el navegador. */
export function descargarPlantilla(): void {
  const wb = construirPlantilla();
  XLSX.writeFile(wb, "plantilla_comprobantes.xlsx");
}
