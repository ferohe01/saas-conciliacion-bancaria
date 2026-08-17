import Link from "next/link";
import { EncabezadoPagina, EstadoVacio, clasesBoton } from "@/components/ui";
import { getDiasPago } from "@/lib/diasPago-servidor";
import {
  calibrar,
  frase,
  puntualidad,
  ordenarPorRetraso,
  medianaEmpresa,
  noCalculado,
  ETIQUETA_PUNTUALIDAD,
  MIN_OBSERVACIONES,
  type Calibrado,
  type Puntualidad,
} from "@/lib/diasPago";
import { formatearPEN, formatearFecha } from "@/lib/parsing/resumen";

/**
 * CUÁNDO TE PAGAN DE VERDAD
 *
 * THESIS: la conciliación deja de ser «cuadrar» y pasa a ser «saber cuándo te
 * van a pagar». Cada cifra sale de comparar el vencimiento de una factura con
 * la fecha del movimiento del extracto que la pagó — un hecho, no una
 * estimación, y algo que ninguna hoja de cálculo puede saber.
 *
 * STORY: primero quién te hace esperar más, porque es el orden en el que se
 * actúa. El resto es el respaldo de esa lista.
 *
 * ⚠️ Esta pantalla NO proyecta nada, y por eso no puede equivocarse sobre el
 * futuro. Es la mitad medible del módulo de flujo de caja (fase 3a).
 */

export const dynamic = "force-dynamic";

const TONO: Record<Puntualidad, string> = {
  antes: "bg-emerald-50 text-emerald-800 border-emerald-200",
  puntual: "bg-emerald-50 text-emerald-800 border-emerald-200",
  algo_tarde: "bg-neutral-100 text-neutral-700 border-neutral-200",
  tarde: "bg-amber-50 text-amber-900 border-amber-200",
  muy_tarde: "bg-amber-100 text-amber-900 border-amber-300",
};

function Tabla({
  filas,
  titulo,
  descripcion,
  columna,
  vacio,
}: {
  filas: Calibrado[];
  titulo: string;
  descripcion: string;
  columna: string;
  vacio: string;
}) {
  if (filas.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-900">{titulo}</h2>
        <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-600">
          {vacio}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold text-neutral-900">{titulo}</h2>
        <p className="text-sm text-neutral-600">{descripcion}</p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b border-neutral-200 text-left text-neutral-600">
            <tr>
              <th className="px-4 py-2.5 font-medium">{columna}</th>
              <th className="px-4 py-2.5 text-right font-medium">Días</th>
              <th className="px-4 py-2.5 font-medium">Qué se midió</th>
              <th className="px-4 py-2.5 text-right font-medium">Importe</th>
              <th className="px-4 py-2.5 font-medium">Último</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => {
              const p = puntualidad(c.dias);
              const medido = c.fuente === "contraparte";
              return (
                <tr
                  key={`${c.contraparte}|${c.moneda}`}
                  className="border-b border-neutral-100 last:border-0 align-top"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-900">{c.contraparte}</p>
                    {c.ruc && <p className="text-xs text-neutral-500">{c.ruc}</p>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {/* ⚠️ El número solo se pinta como dato cuando SE MIDIÓ. Un
                        valor heredado con el mismo aspecto haría creer que se
                        sabe algo de este cliente que no se sabe. */}
                    {medido ? (
                      <span
                        className={`inline-block rounded-lg border px-2 py-0.5 font-semibold tabular-nums ${TONO[p]}`}
                      >
                        {c.dias > 0 ? "+" : ""}
                        {c.dias}
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    {medido && (
                      <p className="text-xs font-medium text-neutral-500">
                        {ETIQUETA_PUNTUALIDAD[p]}
                      </p>
                    )}
                    <p>{frase(c)}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                    {formatearPEN(c.montoTotal, c.moneda)}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {c.ultimoPago ? formatearFecha(c.ultimoPago) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function CuandoPaganPage() {
  const filas = await getDiasPago();
  const demasiados = noCalculado(filas);
  const todos = ordenarPorRetraso(calibrar(filas));
  const clientes = todos.filter((c) => c.tipo === "cobranza");
  const proveedores = todos.filter((c) => c.tipo === "pago");
  const globalPEN = medianaEmpresa(filas, "cobranza", "PEN");

  if (demasiados != null) {
    return (
      <div className="space-y-6">
        <EncabezadoPagina
          titulo="Cuándo te pagan"
          descripcion="Cuántos días tarda de verdad cada cliente, medido contra tu extracto."
        />
        {/* ⚠️ «No se calculó» no es «no hay datos». Decir lo segundo sobre medio
            millón de pares conciliados sería exactamente al revés de la verdad. */}
        <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-700">
          Tienes <strong>{demasiados.toLocaleString("es-PE")}</strong> pares
          conciliados, demasiados para medir esto sin que la consulta se pase del
          tiempo que la base permite, así que no se ha intentado. No es que no
          haya historial: es que hay mucho.
        </p>
      </div>
    );
  }

  if (todos.length === 0) {
    return (
      <div className="space-y-6">
        <EncabezadoPagina
          titulo="Cuándo te pagan"
          descripcion="Cuántos días tarda de verdad cada cliente, medido contra tu extracto."
        />
        <EstadoVacio
          titulo="Todavía no hay nada que medir"
          texto="Esto sale de comparar el vencimiento de cada factura con la fecha del movimiento que la pagó, así que hace falta al menos una conciliación aprobada con cobros aplicados. En cuanto la tengas, aquí aparecerá quién te paga puntual y quién te hace esperar."
          accion={
            <Link href="/wizard" className={clasesBoton("primario")}>
              Conciliar un período
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Cuándo te pagan"
        descripcion="Cuántos días tarda de verdad cada uno, medido contra tu extracto bancario."
      />

      {/* Lo que hace creíble la pantalla es de dónde salen los números, así que
          se dice antes de enseñarlos. */}
      <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-700">
        Esto no es una estimación: cada cifra compara el <strong>vencimiento</strong> de
        una factura con la <strong>fecha del movimiento del banco</strong> que la
        pagó, en tus conciliaciones aprobadas de los últimos 12 meses. Solo
        cuentan los documentos <strong>cobrados del todo</strong> —uno a medias
        todavía no ha terminado de pagarse— y hacen falta al menos{" "}
        {MIN_OBSERVACIONES} para hablar de la costumbre de alguien.
        {globalPEN && (
          <>
            {" "}
            En conjunto, tus clientes pagan a{" "}
            <strong>{globalPEN.dias} días</strong> de su vencimiento (
            {globalPEN.observaciones.toLocaleString("es-PE")} documentos).
          </>
        )}
      </p>

      <Tabla
        titulo="Tus clientes"
        descripcion="Ordenados por lo que te hacen esperar: por ahí conviene empezar."
        columna="Cliente"
        filas={clientes}
        vacio="Todavía no hay cobros conciliados y aprobados que medir."
      />

      <Tabla
        titulo="Tus proveedores"
        descripcion="Cuánto tardas tú en pagarles. Sale del mismo cálculo, del otro lado."
        columna="Proveedor"
        filas={proveedores}
        vacio="No hay pagos a proveedores conciliados todavía."
      />

      <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-600">
        Esta pantalla <strong>mide</strong>, no proyecta: describe lo que ya pasó.
        Es también lo que hará creíble el flujo de caja proyectado cuando esté —
        en vez de suponer que una factura a 30 días se cobra el día 30, se usará
        lo que cada cliente hace de verdad.
      </p>
    </div>
  );
}
