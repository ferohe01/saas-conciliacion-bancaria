import { formatearPEN } from "@/lib/parsing/resumen";
import { TRAMOS, type ResumenAging } from "@/lib/aging";
import { Tarjeta } from "@/components/ui";

/**
 * Vista de antigüedad de saldos, compartida por Cuentas por cobrar y por pagar.
 *
 * La estructura es idéntica porque la pregunta es simétrica; lo que cambia son
 * las palabras. Tenerla dos veces habría significado corregir cada ajuste dos
 * veces — y que una de las dos se quedara atrás.
 */

export type TextosAging = {
  /** "Total por cobrar" / "Total por pagar" */
  total: string;
  /** "requiere gestión" / "vencido con proveedores" */
  notaVencido: string;
  /** "Cliente" / "Proveedor" */
  contraparte: string;
  /** Encabezado de la tabla */
  tituloTabla: string;
  /** Frase bajo el título de la tabla */
  subtituloTabla: string;
  /** Nota final sobre de dónde salen los saldos */
  pie: string;
};

export function VistaAging({
  aging,
  textos,
  moneda = "PEN",
}: {
  aging: ResumenAging;
  textos: TextosAging;
  /**
   * En qué moneda están estas cifras. Antes se formateaba SIEMPRE con «S/»
   * porque no había otra posible; con comprobantes en dólares eso convertía un
   * total correcto en una etiqueta falsa.
   */
  moneda?: string;
}) {
  const alDia = aging.total - aging.vencido;
  const fmt = (n: number) => formatearPEN(n, moneda);

  return (
    <>
      <section
        aria-label="Resumen"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 lg:grid-cols-3"
      >
        <div className="h-full bg-white px-5 py-4">
          <p className="text-[0.6875rem] font-medium tracking-[0.05em] text-neutral-500 uppercase">
            {textos.total}
          </p>
          <p className="mt-2 text-3xl leading-none font-bold tabular-nums text-neutral-900">
            {fmt(aging.total)}
          </p>
          <p className="mt-2 text-sm text-neutral-600">
            <span className="tabular-nums">{aging.documentos}</span>{" "}
            {aging.documentos === 1 ? "documento" : "documentos"}
          </p>
        </div>
        <div className="h-full bg-white px-5 py-4">
          <p className="text-[0.6875rem] font-medium tracking-[0.05em] text-neutral-500 uppercase">
            Vencido
          </p>
          <p
            className={`mt-2 text-3xl leading-none font-bold tabular-nums ${
              aging.vencido > 0 ? "text-amber-700" : "text-neutral-900"
            }`}
          >
            {fmt(aging.vencido)}
          </p>
          <p className="mt-2 text-sm text-neutral-600">{textos.notaVencido}</p>
        </div>
        <div className="col-span-2 h-full bg-white px-5 py-4 lg:col-span-1">
          <p className="text-[0.6875rem] font-medium tracking-[0.05em] text-neutral-500 uppercase">
            Aún no vence
          </p>
          <p className="mt-2 text-3xl leading-none font-bold tabular-nums text-neutral-900">
            {fmt(alDia)}
          </p>
          <p className="mt-2 text-sm text-neutral-600">dentro de plazo</p>
        </div>
      </section>

      <section
        aria-labelledby="h-tramos"
        className="rounded-2xl border border-neutral-200 bg-white p-5"
      >
        <h2 id="h-tramos" className="font-semibold text-neutral-900">
          Antigüedad
        </h2>
        <ul className="mt-4 space-y-2.5">
          {TRAMOS.map((t) => {
            const v = aging.porTramo[t.id];
            const pct = aging.total > 0 ? (v / aging.total) * 100 : 0;
            return (
              <li key={t.id} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-neutral-700">{t.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <span
                    aria-hidden
                    className={`block h-full rounded-full ${
                      t.id === "por_vencer" ? "bg-neutral-400" : "bg-amber-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="w-28 shrink-0 text-right tabular-nums text-neutral-900">
                  {fmt(v)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="h-contrapartes"
        className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"
      >
        <div className="border-b border-neutral-200 px-5 py-4">
          <h2 id="h-contrapartes" className="font-semibold text-neutral-900">
            {textos.tituloTabla}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-600">{textos.subtituloTabla}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left">
                <th scope="col" className="px-5 py-2.5 font-medium text-neutral-600">
                  {textos.contraparte}
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium text-neutral-600">
                  Docs.
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium text-neutral-600">
                  Vencido
                </th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium text-neutral-600">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {aging.contrapartes.map((c) => (
                <tr key={c.contraparte}>
                  <td className="px-5 py-3">
                    <span className="font-medium text-neutral-900">{c.contraparte}</span>
                    {c.ruc && (
                      <span className="block text-xs tabular-nums text-neutral-500">
                        RUC {c.ruc}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-neutral-600">
                    {c.documentos}
                  </td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums ${
                      c.vencido > 0 ? "font-medium text-amber-800" : "text-neutral-500"
                    }`}
                  >
                    {fmt(c.vencido)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-neutral-900">
                    {fmt(c.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Tarjeta>
        <p className="text-sm text-neutral-700">{textos.pie}</p>
      </Tarjeta>
    </>
  );
}

/**
 * La misma vista, una vez por moneda.
 *
 * ⚠️ **No se suman las monedas.** «Te deben 19.221» mezclando soles y dólares no
 * responde a ninguna pregunta, y nadie puede saber mirándolo que está mal. Antes
 * de que los comprobantes tuvieran moneda (0041) el problema no existía; ahora
 * la única salida honesta es separarlos.
 *
 * ⚠️ Y tampoco se filtra a una sola: eso escondería el resto sin avisar. Con una
 * moneda —el caso normal— esto se ve **exactamente igual que antes**, sin
 * cabecera ni adorno de más; el encabezado solo aparece cuando de verdad hay
 * más de una y hace falta decir a cuál pertenece cada cifra.
 */
export function VistaAgingMonedas({
  bloques,
  textos,
}: {
  bloques: { moneda: string; aging: ResumenAging }[];
  textos: TextosAging;
}) {
  const varias = bloques.length > 1;

  return (
    <div className="space-y-8">
      {bloques.map(({ moneda, aging }) => (
        <section key={moneda} className="space-y-6">
          {varias && (
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-lg font-semibold text-neutral-900">
                En {moneda}
              </h2>
              <span className="text-sm text-neutral-600">
                {aging.documentos.toLocaleString("es-PE")}{" "}
                {aging.documentos === 1 ? "documento" : "documentos"}
              </span>
            </div>
          )}
          <VistaAging aging={aging} textos={textos} moneda={moneda} />
        </section>
      ))}
    </div>
  );
}
