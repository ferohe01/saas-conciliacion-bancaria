import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatearFecha, formatearPEN } from "@/lib/parsing/resumen";
import { EncabezadoPagina } from "@/components/ui";
import { CobrosDelComprobante } from "@/components/comprobantes/CobrosDelComprobante";

/**
 * Ficha de un comprobante: qué es, cuánto le queda y QUIÉN se lo cobró.
 *
 * Existe por una razón concreta: cuando el banco revierte un depósito ya
 * conciliado, hay que poder anular ese cobro suelto. Hacerlo desde la
 * conciliación obligaría a tumbarla entera, y con ella los demás cobros de esa
 * corrida, que eran correctos.
 */

type Aplicacion = {
  job_id: string;
  id_movimiento: string;
  monto_aplicado: number;
  created_at: string;
  jobs_conciliacion: {
    periodo_desde: string;
    periodo_hasta: string;
    estado_contable: string | null;
    cuentas_bancarias: { banco: string; numero_enmascarado: string | null } | null;
  } | null;
};

type Reversion = {
  job_id: string;
  id_movimiento: string;
  monto_revertido: number;
  motivo: string | null;
  created_at: string;
};

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: "Pendiente",
  parcial: "Cobrado en parte",
  cobrado: "Cobrado",
  anulado: "Anulado",
};

export default async function ComprobanteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient(); // RLS: solo su empresa

  const [{ data: comp }, { data: aplicaciones }, { data: reversiones }] =
    await Promise.all([
      supabase
        .from("comprobantes")
        .select(
          "id, serie_numero, fecha, fecha_vencimiento, monto, saldo, tipo, estado, ruc_contraparte, razon_social_contraparte, descripcion",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("aplicaciones_cobro")
        .select(
          "job_id, id_movimiento, monto_aplicado, created_at, jobs_conciliacion(periodo_desde, periodo_hasta, estado_contable, cuentas_bancarias(banco, numero_enmascarado))",
        )
        .eq("comprobante_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("reversiones_cobro")
        .select("job_id, id_movimiento, monto_revertido, motivo, created_at")
        .eq("comprobante_id", id),
    ]);

  if (!comp) notFound();

  const esPago = comp.tipo === "pago";
  const importe = Math.abs(Number(comp.monto ?? 0));
  const saldo = Number(comp.saldo ?? 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <EncabezadoPagina
        titulo={comp.serie_numero ?? "Comprobante"}
        descripcion={
          esPago
            ? "Factura de proveedor. Aquí se ve qué pagos se le aplicaron."
            : "Factura de cliente. Aquí se ve qué cobros se le aplicaron."
        }
        volver={{ href: "/comprobantes", texto: "Comprobantes" }}
      />

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 sm:grid-cols-4">
        <Dato etiqueta="Importe" valor={formatearPEN(importe, "PEN")} />
        <Dato
          etiqueta={esPago ? "Queda por pagar" : "Queda por cobrar"}
          valor={formatearPEN(saldo, "PEN")}
          resaltado={saldo > 0.005}
        />
        <Dato etiqueta="Emitido" valor={formatearFecha(comp.fecha)} />
        <Dato
          etiqueta="Estado"
          valor={ETIQUETA_ESTADO[comp.estado ?? ""] ?? (comp.estado ?? "—")}
        />
      </section>

      {comp.razon_social_contraparte && (
        <p className="text-sm text-neutral-600">
          {esPago ? "Proveedor" : "Cliente"}:{" "}
          <span className="font-medium text-neutral-900">
            {comp.razon_social_contraparte}
          </span>
          {comp.ruc_contraparte && (
            <span className="tabular-nums"> · RUC {comp.ruc_contraparte}</span>
          )}
        </p>
      )}

      <CobrosDelComprobante
        comprobanteId={comp.id}
        esPago={esPago}
        aplicaciones={(aplicaciones ?? []) as unknown as Aplicacion[]}
        reversiones={(reversiones ?? []) as Reversion[]}
      />
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  resaltado,
}: {
  etiqueta: string;
  valor: string;
  resaltado?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[0.6875rem] font-medium tracking-[0.05em] text-neutral-500 uppercase">
        {etiqueta}
      </p>
      <p
        className={`mt-1 text-lg leading-none font-bold tabular-nums ${
          resaltado ? "text-amber-700" : "text-neutral-900"
        }`}
      >
        {valor}
      </p>
    </div>
  );
}
