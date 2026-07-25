import type { Kpis, PuntoMensual, FilaBanco } from "@/lib/reportes";

/**
 * Exporta el reporte agregado a Excel (3 hojas: Resumen, Por mes, Por banco).
 * SheetJS se carga con import() dinámico.
 */
export async function exportarReporteExcel(data: {
  kpis: Kpis;
  mensual: PuntoMensual[];
  bancos: FilaBanco[];
  etiqueta: string;
}): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const { kpis, mensual, bancos, etiqueta } = data;

  const resumen = [
    { Indicador: "Filtro", Valor: etiqueta },
    { Indicador: "Conciliaciones", Valor: kpis.conciliaciones },
    { Indicador: "Registros procesados", Valor: kpis.registros },
    { Indicador: "Movimientos procesados", Valor: kpis.movimientos },
    { Indicador: "Conciliados automáticamente", Valor: kpis.autoConciliados },
    { Indicador: "% Automatización", Valor: kpis.pctAutomatizacion },
    { Indicador: "Sugeridos por IA", Valor: kpis.sugeridosIa },
    { Indicador: "Sin conciliar", Valor: kpis.sinConciliar },
    { Indicador: "Períodos cuadrados", Valor: kpis.jobsCuadrados },
    { Indicador: "% Períodos cuadrados", Valor: kpis.pctCuadre },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), "Resumen");

  const porMes = mensual.map((m) => ({
    Mes: m.etiqueta,
    Conciliaciones: m.conciliaciones,
    Registros: m.registros,
    "Conciliados auto": m.autoConciliados,
    "% Automatización": m.pctAutomatizacion,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porMes), "Por mes");

  const porBanco = bancos.map((b) => ({
    Banco: b.banco,
    Conciliaciones: b.conciliaciones,
    Registros: b.registros,
    "Conciliados auto": b.autoConciliados,
    "% Automatización": b.pctAutomatizacion,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(porBanco.length ? porBanco : [{ Banco: "" }]),
    "Por banco",
  );

  XLSX.writeFile(wb, `reporte_conciliaciones_${etiqueta.replace(/\s+/g, "_")}.xlsx`);
}
