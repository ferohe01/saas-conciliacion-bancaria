"use client";

import { exportarReporteExcel } from "@/lib/exportarReporte";
import type { Kpis, PuntoMensual, FilaBanco } from "@/lib/reportes";

export function ExportarReporte({
  kpis,
  mensual,
  bancos,
  etiqueta,
}: {
  kpis: Kpis;
  mensual: PuntoMensual[];
  bancos: FilaBanco[];
  etiqueta: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        void exportarReporteExcel({ kpis, mensual, bancos, etiqueta });
      }}
      className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
    >
      Exportar a Excel
    </button>
  );
}
