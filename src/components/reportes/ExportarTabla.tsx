"use client";

import { exportarTablaExcel } from "@/lib/exportarTabla";

export function ExportarTabla({
  filas,
  nombreArchivo,
  nombreHoja,
}: {
  filas: Record<string, unknown>[];
  nombreArchivo: string;
  nombreHoja?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        void exportarTablaExcel(filas, nombreArchivo, nombreHoja);
      }}
      className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
    >
      Exportar a Excel
    </button>
  );
}
