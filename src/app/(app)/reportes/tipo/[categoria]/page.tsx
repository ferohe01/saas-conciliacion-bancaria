import Link from "next/link";
import { cargarReporteDetalle, cargarParesDeTabla } from "@/lib/reportesQuery";
import {
  filtrarAnual,
  filtrarMes,
  categoriaDeMatch,
  etiquetaTipo,
  etiquetaEstadoRevision,
  ETIQUETA_METODO,
} from "@/lib/reportes";
import { EstadoVacio } from "@/components/ui";
import { ExportarTabla } from "@/components/reportes/ExportarTabla";
import { formatearFecha, formatearPEN } from "@/lib/parsing/resumen";
import { nombreMes } from "@/lib/periodo";
import type {
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";

const METODO_LABEL: Record<string, string> = {
  exacta: ETIQUETA_METODO.exacta,
  difusa: ETIQUETA_METODO.difusa,
  ia: ETIQUETA_METODO.ia,
  manual: "Manual",
};

function detInterno(r: RegistroInterno | undefined, moneda: string): string {
  if (!r) return "—";
  return `${r.id_interno} · ${formatearFecha(r.fecha)} · ${formatearPEN(r.monto, moneda)}${r.contraparte ? " · " + r.contraparte : r.descripcion ? " · " + r.descripcion : ""}`;
}
/** Una partida ya hidratada desde su tabla (modo tabla). */
function detParte(
  p: { fecha: string; monto: number; texto: string } | undefined,
  moneda: string,
): string {
  if (!p) return "—";
  return `${formatearFecha(p.fecha)} · ${formatearPEN(p.monto, moneda)}${p.texto ? " · " + p.texto : ""}`;
}
function detBanco(m: MovimientoBancario | undefined, moneda: string): string {
  if (!m) return "—";
  return `${m.id_movimiento} · ${formatearFecha(m.fecha)} · ${formatearPEN(m.monto, moneda)}${m.glosa ? " · " + m.glosa : ""}`;
}

export default async function DetalleTipoPage({
  params,
  searchParams,
}: {
  params: Promise<{ categoria: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { categoria } = await params;
  const titulo = etiquetaTipo(categoria);

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

  const columnas = [
    "Período",
    "Método",
    "Registro interno",
    "Movimiento bancario",
    "Diferencia",
    "Estado",
    "Observación",
  ];

  const filas: Record<string, string>[] = [];
  let recortado = false;
  /** Mismo tope que el detalle por método, por el mismo motivo. */
  const TOPE = 1000;

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

    // ⚠️ MODO TABLA: los pares viven en `matches_conciliacion`. Leerlos del
    // resultado dejaba esta pantalla en cero, igual que el detalle por método.
    if (d.loteExtractoId) {
      const { pares, total } = await cargarParesDeTabla(job.id, null, TOPE);
      if (pares.length < total) recortado = true;
      for (const p of pares) {
        if (p.estado_revision === "rechazado") continue;
        if (
          categoriaDeMatch({
            categoria_diferencia: p.categoria_diferencia,
            diferencia_monto: p.diferencia_monto,
          }) !== categoria
        ) {
          continue;
        }
        filas.push({
          "Período": periodoLabel,
          "Método": METODO_LABEL[p.metodo] ?? p.metodo,
          "Registro interno": p.ids_internos
            .map((id) => detParte(p.internos.get(id), d.moneda))
            .join("  |  "),
          "Movimiento bancario": p.ids_movimientos
            .map((id) => detParte(p.movimientos.get(id), d.moneda))
            .join("  |  "),
          Diferencia:
            p.diferencia_monto != null
              ? formatearPEN(p.diferencia_monto, d.moneda)
              : "—",
          Estado: etiquetaEstadoRevision(p.estado_revision),
          "Observación": p.justificacion ?? "",
        });
      }
      continue;
    }

    for (const m of d.resultado.matches) {
      if (m.estado_revision === "rechazado") continue;
      if (categoriaDeMatch(m) !== categoria) continue;
      filas.push({
        "Período": periodoLabel,
        "Método": METODO_LABEL[m.metodo] ?? m.metodo,
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
        Estado: etiquetaEstadoRevision(m.estado_revision),
        "Observación": m.justificacion ?? "",
      });
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
            className="rounded text-sm font-medium text-blue-700 transition-colors hover:text-blue-800"
          >
            ← Volver al reporte
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-balance text-neutral-900">
            Tipo de diferencia: {titulo}
          </h1>
          <p className="mt-1 text-neutral-600">
            <span className="tabular-nums">
              {filas.length.toLocaleString("es-PE")}
            </span>{" "}
            {filas.length === 1 ? "par conciliado" : "pares conciliados"} ·{" "}
            {mes === "todos" ? `Año ${anio}` : `${nombreMes(mes)} ${anio}`}
            {banco !== "todos" ? ` · ${banco}` : ""}
          </p>
        </div>
        {filas.length > 0 && (
          <ExportarTabla
            filas={filas}
            nombreArchivo={`detalle_tipo_${categoria}_${anio}`}
            nombreHoja={titulo}
          />
        )}
      </div>

      {recortado && (
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          Se muestran los primeros{" "}
          <span className="tabular-nums">{TOPE.toLocaleString("es-PE")}</span>{" "}
          pares de cada conciliación. Para el detalle completo, expórtalo desde
          la conciliación.
        </p>
      )}

      {filas.length === 0 ? (
        <EstadoVacio
          titulo="Nada de este tipo"
          texto="No hay pares con esta diferencia para el período, banco o cuenta que elegiste. Prueba a ampliar el filtro desde el reporte."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">
              Pares conciliados con diferencia de tipo {titulo}
            </caption>
            <thead className="bg-neutral-50 text-xs text-neutral-600">
              <tr>
                {columnas.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className="px-4 py-2.5 font-medium whitespace-nowrap"
                  >
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
