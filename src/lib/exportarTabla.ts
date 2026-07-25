/**
 * Exporta un arreglo de objetos planos a un Excel de una hoja.
 * SheetJS se carga con import() dinámico.
 */
export async function exportarTablaExcel(
  filas: Record<string, unknown>[],
  nombreArchivo: string,
  nombreHoja = "Detalle",
): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const hoja = XLSX.utils.json_to_sheet(filas.length ? filas : [{}]);
  XLSX.utils.book_append_sheet(wb, hoja, nombreHoja.slice(0, 31));
  XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
}
