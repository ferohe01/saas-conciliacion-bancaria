"use client";

import { useState, useEffect } from "react";
import {
  BarraFiltros,
  CampoFiltro,
  SelectFiltro,
  CLASES_CAMPO,
  useFiltroUrl,
} from "@/components/ui/Filtros";
import { TRAMOS } from "@/lib/aging";
import { hayFiltroSaldo, type FiltroSaldo } from "@/lib/filtrosSaldo";

/**
 * Filtros de "por cobrar" y "por pagar". No hay período ni estado: el aging ya
 * excluye por diseño lo saldado y lo anulado, y la pregunta aquí es de
 * antigüedad, no de mes de emisión.
 */
export function FiltrosSaldo({
  valores,
  etiquetaBusqueda,
}: {
  valores: FiltroSaldo;
  etiquetaBusqueda: string;
}) {
  const { set, limpiar } = useFiltroUrl();

  const [texto, setTexto] = useState(valores.busca);
  useEffect(() => setTexto(valores.busca), [valores.busca]);
  useEffect(() => {
    if (texto === valores.busca) return;
    const t = setTimeout(() => set("busca", texto), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, valores.busca]);

  return (
    <BarraFiltros
      hayFiltro={hayFiltroSaldo(valores)}
      onLimpiar={limpiar}
      columnas="sm:grid-cols-3"
    >
      <SelectFiltro
        label="Antigüedad"
        valor={valores.tramo}
        // Elegir un tramo concreto y "solo vencido" a la vez se contradice, así
        // que el tramo manda y limpia la casilla.
        onChange={(v) => set("tramo", v, v === "todos" ? [] : ["vencido"])}
        opciones={[
          { valor: "todos", texto: "Todas" },
          ...TRAMOS.map((t) => ({ valor: t.id, texto: t.label })),
        ]}
      />

      <CampoFiltro label="Solo vencido">
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-800 transition-colors hover:bg-neutral-50 has-[:focus-visible]:border-blue-500 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-200">
          <input
            type="checkbox"
            checked={valores.soloVencido}
            onChange={(e) =>
              set("vencido", e.target.checked ? "1" : "", ["tramo"])
            }
            className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-200"
          />
          Ya pasó su fecha
        </label>
      </CampoFiltro>

      <CampoFiltro label="Buscar">
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={etiquetaBusqueda}
          className={CLASES_CAMPO}
        />
      </CampoFiltro>
    </BarraFiltros>
  );
}
