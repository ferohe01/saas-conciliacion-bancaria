import Link from "next/link";
import { notFound } from "next/navigation";
import { cargarReporteDetalle } from "@/lib/reportesQuery";
import { filtrarAnual, filtrarMes, COLOR_METODO } from "@/lib/reportes";
import { ExportarTabla } from "@/components/reportes/ExportarTabla";
import { formatearFecha, formatearPEN } from "@/lib/parsing/resumen";
import { nombreMes } from "@/lib/periodo";
import type {
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";

const META: Record<
  string,
  { key: "exacta" | "difusa" | "ia" | "sin_conciliar"; titulo: string; color: string }
> = {
  exacta: { key: "exacta", titulo: "Conciliados por match exacto", color: COLOR_METODO.exacta },
  difusa: { key: "difusa", titulo: "Conciliados por match difuso", color: COLOR_METODO.difusa },
  ia: { key: "ia", titulo: "Sugeridos por IA", color: COLOR_METODO.ia },
  "sin-conciliar": {
    key: "sin_conciliar",
    titulo: "Partidas sin conciliar",
    color: COLOR_METODO.sin_conciliar,
  },
};

function detInterno(r: RegistroInterno | undefined, moneda: string): string {
  if (!r) return "—";
  return `${r.id_interno} · ${formatearFecha(r.fecha)} · ${formatearPEN(r.monto, moneda)}${r.contraparte ? " · " + r.contraparte : r.descripcion ? " · " + r.descripcion : ""}`;
}
function detBanco(m: MovimientoBancario | undefined, moneda: string): string {
  if (!m) return "—";
  return `${m.id_movimiento} · ${formatearFecha(m.fecha)} · ${formatearPEN(m.monto, moneda)}${m.glosa ? " · " + m.glosa : ""}`;
}

export default async function DetalleMetodoPage({
  params,
  searchParams,
}: {
  params: Promise<{ metodo: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { metodo } = await params;
  const meta = META[metodo];
  if (!meta) notFound();

  const sp = await searchParams;
  const { jobsDef, detalle } = await cargarReporteDetalle();

  const anio = Number(sp.anio) || new Date().getUTCFullYear();
  const mes = sp.mes && sp.mes !== "todos" ? Number(sp.mes) : "todos";
  const banco = sp.banco ?? "todos";
  const cuenta = sp.cuenta ?? "todos";

  const jobsFiltrados = filtrarMes(
    filtrarAnual(jobsDef, { anio, banco, cuentaId: cuenta }),
    mes,
  );

  const esSinConciliar = meta.key === "sin_conciliar";
  const columnas = esSinConciliar
    ? ["Período", "Lado", "Partida", "Categoría", "Sugerencia / Observación"]
    : ["Período", "Registro interno", "Movimiento bancario", "Diferencia", "Estado", "Observación"];

  const filas: Record<string, string>[] = [];

  for (const job of jobsFiltrados) {
    const d = detalle.get(job.id);
    if (!d) continue;
    const periodoLabel = `${nombreMes(job.mes)} ${job.anio}`;
    const internosMap = new Map(
      d.payload.registros_internos.map((r) => [r.id_interno, r]),
    );
    const movsMap = new Map(
      d.payload.movimientos_bancarios.map((m) => [m.id_movimiento, m]),
    );

    if (esSinConciliar) {
      for (const p of d.resultado.no_conciliados) {
        const partida =
          p.lado === "interno"
            ? detInterno(internosMap.get(p.id), d.moneda)
            : detBanco(movsMap.get(p.id), d.moneda);
        filas.push({
          "Período": periodoLabel,
          Lado: p.lado === "interno" ? "Interno" : "Banco",
          Partida: partida,
          "Categoría": p.categoria,
          "Sugerencia / Observación": p.sugerencia ?? "",
        });
      }
    } else {
      for (const m of d.resultado.matches) {
        if (m.metodo !== meta.key) continue;
        filas.push({
          "Período": periodoLabel,
          "Registro interno": m.ids_internos
            .map((id) => detInterno(internosMap.get(id), d.moneda))
            .join("  |  "),
          "Movimiento bancario": m.ids_movimientos
            .map((id) => detBanco(movsMap.get(id), d.moneda))
            .join("  |  "),
          Diferencia:
            m.diferencia_monto != null
              ? formatearPEN(m.diferencia_monto, d.moneda)
              : "—",
          Estado: m.estado_revision,
          "Observación": m.justificacion ?? "",
        });
      }
    }
  }

  const qs = new URLSearchParams(
    Object.entries({ anio: String(anio), mes: sp.mes ?? "todos", banco, cuenta }),
  ).toString();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/reportes?${qs}`}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Volver al reporte
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-neutral-900">
            <span
              className="inline-block h-3.5 w-3.5 rounded-sm"
              style={{ background: meta.color }}
              aria-hidden
            />
            {meta.titulo}
          </h1>
          <p className="mt-1 text-neutral-500">
            {filas.length.toLocaleString("es-PE")} registro(s) ·{" "}
            {mes === "todos" ? `Año ${anio}` : `${nombreMes(mes)} ${anio}`}
            {banco !== "todos" ? ` · ${banco}` : ""}
          </p>
        </div>
        {filas.length > 0 && (
          <ExportarTabla
            filas={filas}
            nombreArchivo={`detalle_${meta.key}_${anio}`}
            nombreHoja={meta.titulo}
          />
        )}
      </div>

      {filas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
          No hay registros en esta categoría para el filtro seleccionado.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-500">
              <tr>
                {columnas.map((c) => (
                  <th key={c} className="px-4 py-2.5 font-medium whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                <tr key={i} className="border-t border-neutral-100 align-top">
                  {columnas.map((c) => (
                    <td key={c} className="px-4 py-2.5 text-neutral-700">
                      {fila[c]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
