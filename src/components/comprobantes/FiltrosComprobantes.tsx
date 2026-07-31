"use client";

import { useState, useEffect } from "react";
import {
  BarraFiltros,
  CampoFiltro,
  SelectFiltro,
  CLASES_CAMPO,
  useFiltroUrl,
} from "@/components/ui/Filtros";
import { nombreMes } from "@/lib/periodo";
import {
  hayFiltroComprobantes,
  type FiltroComprobantes,
} from "@/lib/filtrosComprobantes";

export function FiltrosComprobantes({
  valores,
  anios,
}: {
  valores: FiltroComprobantes;
  anios: number[];
}) {
  const { set, limpiar } = useFiltroUrl();

  // El buscador no navega en cada tecla: escribir "gamarra" dispararía siete
  // navegaciones y el cursor pelearía con el re-render. Se espera a que la
  // persona deje de escribir.
  const [texto, setTexto] = useState(valores.busca);
  useEffect(() => setTexto(valores.busca), [valores.busca]);
  useEffect(() => {
    if (texto === valores.busca) return;
    const t = setTimeout(() => set("busca", texto), 300);
    return () => clearTimeout(t);
    // `set` cambia en cada render; incluirlo reiniciaría el temporizador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, valores.busca]);

  return (
    <BarraFiltros
      hayFiltro={hayFiltroComprobantes(valores)}
      onLimpiar={limpiar}
      columnas="sm:grid-cols-5"
    >
      <SelectFiltro
        label="Tipo"
        valor={valores.tipo}
        onChange={(v) => set("tipo", v)}
        opciones={[
          { valor: "todos", texto: "Todos" },
          { valor: "cobranza", texto: "Cobranzas" },
          { valor: "pago", texto: "Pagos" },
        ]}
      />
      <SelectFiltro
        label="Estado"
        valor={valores.estado}
        onChange={(v) => set("estado", v)}
        opciones={[
          { valor: "todos", texto: "Todos" },
          { valor: "pendiente", texto: "Pendientes" },
          { valor: "parcial", texto: "Parciales" },
          { valor: "cobrado", texto: "Saldados" },
          { valor: "anulado", texto: "Anulados" },
        ]}
      />
      <SelectFiltro
        label="Año"
        valor={valores.anio === "todos" ? "todos" : String(valores.anio)}
        onChange={(v) => set("anio", v, v === "todos" ? ["mes"] : [])}
        opciones={[
          { valor: "todos", texto: "Todos" },
          ...anios.map((a) => ({ valor: String(a), texto: String(a) })),
        ]}
      />
      <SelectFiltro
        label="Mes"
        valor={valores.mes === "todos" ? "todos" : String(valores.mes)}
        onChange={(v) => set("mes", v)}
        opciones={[
          { valor: "todos", texto: "Todos" },
          ...Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
            valor: String(m),
            texto: nombreMes(m),
          })),
        ]}
      />
      <CampoFiltro label="Buscar">
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Serie o nombre"
          className={CLASES_CAMPO}
        />
      </CampoFiltro>
    </BarraFiltros>
  );
}
