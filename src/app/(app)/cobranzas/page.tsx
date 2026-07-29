import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { empresaTieneModulo } from "@/lib/modulos-servidor";
import { buscarModulo } from "@/lib/modulos";
import { CONTACTO_SUSCRIPCION, montoPEN } from "@/lib/suscripcion";
import { calcularAging, TRAMOS, type ComprobanteCobrar } from "@/lib/aging";
import { EncabezadoPagina, EstadoVacio, Tarjeta, clasesBoton } from "@/components/ui";
import { DocumentoIcon, CandadoIcon } from "@/components/wizard/icons";

export default async function CobranzasPage() {
  // El límite se hace cumplir AQUÍ, en el servidor. Ocultar el enlace en la
  // barra lateral orienta, pero no protege: esta ruta se alcanza escribiéndola.
  const permitido = await empresaTieneModulo("cobranzas");
  const modulo = buscarModulo("cobranzas")!;

  if (!permitido) {
    return (
      <div className="space-y-6">
        <EncabezadoPagina titulo="Cuentas por cobrar" />
        <EstadoVacio
          icono={<CandadoIcon className="h-6 w-6" />}
          titulo="Este módulo no está contratado"
          texto={modulo.descripcion}
          accion={
            <a href={CONTACTO_SUSCRIPCION} className={clasesBoton("primario", "md")}>
              {modulo.precioMensual === null
                ? "Consúltanos"
                : `Activar por ${montoPEN(modulo.precioMensual)}/mes`}
            </a>
          }
        />
      </div>
    );
  }

  const supabase = await createClient(); // RLS: solo la empresa del usuario
  const { data } = await supabase
    .from("comprobantes")
    .select(
      "id, fecha, fecha_vencimiento, monto, saldo, tipo, estado, serie_numero, ruc_contraparte, razon_social_contraparte",
    )
    .order("fecha", { ascending: true });

  const aging = calcularAging((data ?? []) as ComprobanteCobrar[]);

  if (aging.documentos === 0) {
    return (
      <div className="space-y-6">
        <EncabezadoPagina
          titulo="Cuentas por cobrar"
          descripcion="Quién te debe y desde cuándo."
        />
        <EstadoVacio
          icono={<DocumentoIcon className="h-6 w-6" />}
          titulo="Todavía no hay nada por cobrar"
          texto="Aquí aparecen tus facturas pendientes. Carga tus comprobantes y, cada vez que concilies, lo cobrado se descuenta solo."
          accion={
            <Link href="/wizard" className={clasesBoton("primario", "md")}>
              Cargar comprobantes
            </Link>
          }
        />
      </div>
    );
  }

  const alDia = aging.total - aging.vencido;

  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Cuentas por cobrar"
        descripcion="Quién te debe y desde cuándo. Cada conciliación descuenta lo cobrado."
      />

      {/* Franja de cifras, mismo lenguaje que el panel de control. */}
      <section
        aria-label="Resumen de cobranzas"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 lg:grid-cols-3"
      >
        <div className="h-full bg-white px-5 py-4">
          <p className="text-[0.6875rem] font-medium tracking-[0.05em] text-neutral-500 uppercase">
            Total por cobrar
          </p>
          <p className="mt-2 text-3xl leading-none font-bold tabular-nums text-neutral-900">
            {montoPEN(aging.total)}
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
            {montoPEN(aging.vencido)}
          </p>
          <p className="mt-2 text-sm text-neutral-600">requiere gestión</p>
        </div>
        <div className="col-span-2 h-full bg-white px-5 py-4 lg:col-span-1">
          <p className="text-[0.6875rem] font-medium tracking-[0.05em] text-neutral-500 uppercase">
            Aún no vence
          </p>
          <p className="mt-2 text-3xl leading-none font-bold tabular-nums text-neutral-900">
            {montoPEN(alDia)}
          </p>
          <p className="mt-2 text-sm text-neutral-600">dentro de plazo</p>
        </div>
      </section>

      {/* Distribución por antigüedad */}
      <section
        aria-labelledby="h-tramos"
        className="rounded-2xl border border-neutral-200 bg-white p-5"
      >
        <h2 id="h-tramos" className="font-semibold text-neutral-900">
          Antigüedad de la deuda
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
                  {montoPEN(v)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Por cliente, empezando por quien más debe vencido */}
      <section
        aria-labelledby="h-clientes"
        className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"
      >
        <div className="border-b border-neutral-200 px-5 py-4">
          <h2 id="h-clientes" className="font-semibold text-neutral-900">
            Por cliente
          </h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Ordenado por lo vencido: por ahí conviene empezar a cobrar.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left">
                <th scope="col" className="px-5 py-2.5 font-medium text-neutral-600">
                  Cliente
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
              {aging.clientes.map((c) => (
                <tr key={c.cliente}>
                  <td className="px-5 py-3">
                    <span className="font-medium text-neutral-900">{c.cliente}</span>
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
                    {montoPEN(c.vencido)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-neutral-900">
                    {montoPEN(c.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Tarjeta>
        <p className="text-sm text-neutral-700">
          Estos saldos se actualizan solos: cada vez que confirmas un
          emparejamiento en una conciliación, lo cobrado se descuenta del
          comprobante.
        </p>
      </Tarjeta>
    </div>
  );
}
