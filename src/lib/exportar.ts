import type { WorkBook } from "xlsx";
import type { ResultadoConciliacion } from "@/lib/contract/resultado";

/**
 * Exporta el resultado de una conciliación a Excel con 3 hojas:
 *   1. Cuadre   — cuadre de saldos en formato contable.
 *   2. Matches  — pares conciliados con método y estado.
 *   3. Sin conciliar — partidas pendientes por categoría.
 *
 * SheetJS se carga con import() dinámico (fuera del bundle inicial).
 */

/** Construye el workbook (separado de la descarga para poder testearlo). */
export async function construirWorkbookResultado(
  resultado: ResultadoConciliacion,
): Promise<WorkBook> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // Hoja 1: Cuadre
  const c = resultado.cuadre;
  const cuadre = [
    { Concepto: "Saldo extracto final", Monto: c.saldo_extracto_final },
    { Concepto: "+ Depósitos en tránsito", Monto: c.depositos_en_transito },
    { Concepto: "− Cheques no cobrados", Monto: c.cheques_no_cobrados },
    { Concepto: "− Abonos no registrados en libros", Monto: c.abonos_no_registrados },
    { Concepto: "+ Cargos no registrados en libros", Monto: c.cargos_no_registrados },
    { Concepto: "= Saldo banco ajustado", Monto: c.saldo_banco_ajustado },
    { Concepto: "Saldo según libros", Monto: c.saldo_libros_final },
    { Concepto: "Diferencia", Monto: c.diferencia },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cuadre), "Cuadre");

  // Hoja 2: Matches
  const matches = resultado.matches.map((m) => ({
    ids_internos: m.ids_internos.join(", "),
    ids_movimientos: m.ids_movimientos.join(", "),
    metodo: m.metodo,
    confianza: m.confianza ?? "",
    diferencia_monto: m.diferencia_monto ?? "",
    categoria_diferencia: m.categoria_diferencia ?? "",
    estado_revision: m.estado_revision,
    justificacion: m.justificacion ?? "",
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      matches.length ? matches : [{ ids_internos: "", ids_movimientos: "" }],
    ),
    "Matches",
  );

  // Hoja 3: No conciliados
  const noConc = resultado.no_conciliados.map((p) => ({
    id: p.id,
    lado: p.lado,
    categoria: p.categoria,
    sugerencia: p.sugerencia ?? "",
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      noConc.length ? noConc : [{ id: "", lado: "", categoria: "" }],
    ),
    "Sin conciliar",
  );

  return wb;
}

/** Descarga el resultado como archivo Excel en el navegador. */
export async function exportarResultadoExcel(
  resultado: ResultadoConciliacion,
  jobId: string,
): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = await construirWorkbookResultado(resultado);
  XLSX.writeFile(wb, `conciliacion_${jobId}.xlsx`);
}
