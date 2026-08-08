import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmpresaActual } from "@/lib/auth";
import { ImportadorComprobantes } from "@/components/wizard/ImportadorComprobantes";
import {
  CargasRealizadas,
  type Carga,
} from "@/components/comprobantes/CargasRealizadas";
import { formatearFecha } from "@/lib/parsing/resumen";
import { montoPEN } from "@/lib/suscripcion";
import { EncabezadoPagina, EstadoVacio } from "@/components/ui";
import { FiltrosComprobantes } from "@/components/comprobantes/FiltrosComprobantes";
import { VaciarComprobantes } from "@/components/comprobantes/VaciarComprobantes";
import {
  filtrarComprobantes,
  filtroDesdeParams,
  hayFiltroComprobantes,
} from "@/lib/filtrosComprobantes";
import { DocumentoIcon } from "@/components/wizard/icons";

/**
 * Casa de los comprobantes.
 *
 * Antes solo se podían cargar desde dentro del wizard, y el botón "Cargar
 * comprobantes" de Cobranzas llevaba a una pantalla titulada "Nueva
 * conciliación" — el usuario pedía una cosa y aterrizaba en otra.
 *
 * NO exige el módulo Cobranzas a propósito: cargar tus facturas es parte del
 * producto base, porque alimentan la conciliación. Lo que el módulo añade es la
 * vista de cuentas por cobrar.
 */

/**
 * El estado se dice en el idioma de cada lado.
 *
 * "Cobrado" para una factura que TÚ pagaste a un proveedor suena al revés: no
 * la cobraste, la pagaste. El estado en la base es uno solo (`cobrado`); lo que
 * cambia es cómo se cuenta.
 */
function etiquetaEstado(estado: string, tipo: string | null): string {
  const esPago = tipo === "pago";
  switch (estado) {
    case "cobrado":
      return esPago ? "Pagado" : "Cobrado";
    case "parcial":
      return "Parcial";
    case "anulado":
      return "Anulado";
    default:
      return "Pendiente";
  }
}

type Fila = {
  id: string;
  fecha: string | null;
  fecha_vencimiento: string | null;
  monto: number | null;
  saldo: number | null;
  tipo: string | null;
  estado: string | null;
  serie_numero: string | null;
  razon_social_contraparte: string | null;
};

export default async function ComprobantesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const empresa = await getEmpresaActual();
  if (!empresa) notFound();

  // ⚠️ `admin` + filtro EXPLÍCITO de empresa, no el cliente de RLS.
  //
  // La política de `comprobantes` es `es_miembro(empresa_id)`: una función
  // sobre una COLUMNA, que Postgres evalúa fila a fila. Con 452.309
  // comprobantes tanto el conteo como el listado se pasan del
  // `statement_timeout` de 8 s, y la página tardaba un minuto para no mostrar
  // nada. Con la igualdad por `empresa_id` el índice hace su trabajo.
  //
  // El acotado por empresa no se pierde: se hace aquí, con la empresa de la
  // sesión, y es la misma condición que evaluaba RLS.
  const supabase = createAdminClient();
  // El total EXACTO va aparte: la lista se queda en 500 a propósito, pero
  // "Empezar de cero" borra todos. Decía "se borrarán 500" con 20.000 en la
  // base — el mismo error de contar filas traídas en vez de preguntar cuántas
  // hay.
  const { count: totalReal } = await supabase
    .from("comprobantes")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresa.empresa_id);

  // Las cargas hechas, para poder quitar una sin borrarlo todo. Se agrupa en
  // la base: contar por lote desde aquí exigiría traerse las 452.309 filas.
  const { data: lotes } = await supabase.rpc("lotes_importacion");
  const cargas: Carga[] = ((lotes ?? []) as {
    lote: string;
    filas: number | string;
    cargado: string;
  }[]).map((l) => ({
    lote: l.lote,
    filas: Number(l.filas),
    cargado: l.cargado,
  }));

  const { data } = await supabase
    .from("comprobantes")
    .select(
      "id, fecha, fecha_vencimiento, monto, saldo, tipo, estado, serie_numero, razon_social_contraparte",
    )
    .eq("empresa_id", empresa.empresa_id)
    .order("fecha", { ascending: false })
    // Desempate: sin columna única, dos ejecuciones pueden devolver conjuntos
    // distintos cuando miles de filas comparten fecha.
    .order("id", { ascending: false })
    .limit(500);

  const todas = (data ?? []) as Fila[];

  const filtro = filtroDesdeParams(sp);
  const filas = filtrarComprobantes(todas, filtro);
  const hayFiltro = hayFiltroComprobantes(filtro);
  const anios = [...new Set(todas.map((c) => Number(String(c.fecha).slice(0, 4))))]
    .filter((a) => Number.isFinite(a))
    .sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Comprobantes"
        descripcion="Tus cobranzas y pagos. De aquí salen los registros internos de cada conciliación, y aquí se ve lo que ya cobraste."
      />

      <ImportadorComprobantes />

      <CargasRealizadas cargas={cargas} />

      {todas.length > 0 && (
        <FiltrosComprobantes valores={filtro} anios={anios} />
      )}

      {todas.length === 0 ? (
        <EstadoVacio
          icono={<DocumentoIcon className="h-6 w-6" />}
          titulo="Todavía no has cargado comprobantes"
          texto="Descarga la plantilla de arriba, llénala con tus cobranzas y pagos, y súbela. Luego podrás conciliar usando estos datos en lugar de un archivo suelto."
        />
      ) : filas.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-600">
          Ninguno de tus {todas.length.toLocaleString("es-PE")} comprobantes
          coincide con este filtro. Prueba a quitar alguno.
        </p>
      ) : (
        <section
          aria-labelledby="h-lista"
          className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-200 px-5 py-4">
            <h2 id="h-lista" className="font-semibold text-neutral-900">
              Cargados
            </h2>
            <span className="text-sm tabular-nums text-neutral-600">
              {filas.length.toLocaleString("es-PE")}{" "}
              {filas.length === 1 ? "documento" : "documentos"}
              {hayFiltro && ` de ${todas.length.toLocaleString("es-PE")}`}
              {!hayFiltro && todas.length === 500 && " (últimos 500)"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left">
                  <th scope="col" className="px-5 py-2.5 font-medium text-neutral-600">Fecha</th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-neutral-600">Vence</th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-neutral-600">Documento</th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-neutral-600">Tipo</th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-neutral-600">Contraparte</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium text-neutral-600">Monto</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium text-neutral-600">Saldo</th>
                  <th scope="col" className="px-5 py-2.5 font-medium text-neutral-600">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filas.map((f) => {
                  const estado = f.estado ?? "pendiente";
                  return (
                    <tr key={f.id}>
                      <td className="px-5 py-2.5 tabular-nums whitespace-nowrap text-neutral-800">
                        {f.fecha ? formatearFecha(f.fecha) : "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-neutral-600">
                        {f.fecha_vencimiento ? formatearFecha(f.fecha_vencimiento) : "—"}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Link
                          href={`/comprobantes/${f.id}`}
                          className="rounded font-medium text-blue-700 transition-colors hover:text-blue-800 hover:underline"
                        >
                          {f.serie_numero ?? "Ver"}
                        </Link>
                      </td>
                      {/* Con la palabra, no solo con el signo y el color: la
                          tabla mezcla lo que te deben con lo que debes. */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            f.tipo === "pago"
                              ? "bg-neutral-100 text-neutral-700"
                              : "bg-blue-50 text-blue-800"
                          }`}
                        >
                          {f.tipo === "pago" ? "Pago" : "Cobranza"}
                        </span>
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-2.5 text-neutral-700">
                        {f.razon_social_contraparte ?? "—"}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums ${
                          f.tipo === "pago" ? "text-rose-700" : "text-neutral-900"
                        }`}
                      >
                        {f.tipo === "pago" ? "−" : ""}
                        {montoPEN(Math.abs(Number(f.monto ?? 0)))}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-900">
                        {montoPEN(Number(f.saldo ?? 0))}
                      </td>
                      <td className="px-5 py-2.5">
                        {/* Con texto, no solo color: es el compromiso de
                            accesibilidad del producto. */}
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                            estado === "cobrado"
                              ? "bg-emerald-100 text-emerald-800"
                              : estado === "parcial"
                                ? "bg-amber-100 text-amber-800"
                                : estado === "anulado"
                                  ? "bg-neutral-100 text-neutral-500"
                                  : "bg-neutral-100 text-neutral-700"
                          }`}
                        >
                          {etiquetaEstado(estado, f.tipo)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <VaciarComprobantes total={totalReal ?? todas.length} />
    </div>
  );
}
