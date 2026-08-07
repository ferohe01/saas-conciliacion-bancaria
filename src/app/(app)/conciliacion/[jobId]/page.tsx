import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ProgresoConciliacion,
  type JobRow,
} from "@/components/conciliacion/ProgresoConciliacion";
import { ResultadoReview } from "@/components/conciliacion/ResultadoReview";
import { formatearFecha } from "@/lib/parsing/resumen";
import { ResultadoConciliacion } from "@/lib/contract/resultado";
import { PayloadConciliacion } from "@/lib/contract/payload";
import { EncabezadoPagina, BadgeEstadoJob } from "@/components/ui";
import { EstadoContablePanel } from "@/components/conciliacion/EstadoContablePanel";
import { getPrecedentes } from "@/lib/precedentes-servidor";
import type { EstadoContable } from "@/lib/cicloContable";

/**
 * Pantalla de una conciliación:
 *  - en progreso → ProgresoConciliacion (Realtime).
 *  - completada  → ResultadoReview (dos paneles, cola IA, manual, exportación).
 */
export default async function ConciliacionPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select(
      "id, estado, fase_actual, resultado, error_detalle, periodo_desde, periodo_hasta, created_at, payload_entrada, estado_contable, version, fecha_aprobacion, cuenta_id",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (!data) notFound();

  // ¿Hay otras corridas de este mismo rango? Cambia lo que hay que advertir
  // antes de aprobar: si las hay, aprobar reemplaza a otra.
  const { count: corridasDelRango } = await supabase
    .from("jobs_conciliacion")
    .select("id", { count: "exact", head: true })
    .eq("cuenta_id", data.cuenta_id)
    .eq("periodo_desde", data.periodo_desde)
    .eq("periodo_hasta", data.periodo_hasta);
  const hayVersionesPrevias = (corridasDelRango ?? 1) > 1;

  const resultadoParsed =
    data.estado === "completado"
      ? ResultadoConciliacion.safeParse(data.resultado)
      : null;
  const payloadParsed = PayloadConciliacion.safeParse(data.payload_entrada);

  const mostrarReview =
    resultadoParsed?.success && payloadParsed.success;

  // Casos parecidos ya resueltos, para las sugerencias que esperan decisión.
  // Se calcula en el servidor: el historial de otros jobs no tiene por qué
  // viajar entero al navegador.
  const precedentes = mostrarReview
    ? await getPrecedentes(
        data.id,
        resultadoParsed!.data.matches,
        payloadParsed.data,
      )
    : {};

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <EncabezadoPagina
        titulo={`Conciliación · ${formatearFecha(data.periodo_desde)} – ${formatearFecha(data.periodo_hasta)}`}
        volver={{ href: "/conciliacion", texto: "Historial" }}
        accion={<BadgeEstadoJob estado={data.estado} />}
      />
      <p className="-mt-3 text-sm text-neutral-600">
        Identificador del proceso:{" "}
        <span className="font-mono text-xs">{data.id}</span>
      </p>

      {/* Va antes que el resultado: si el documento no rige, revisar sus
          sugerencias es trabajo perdido. */}
      <EstadoContablePanel
        jobId={data.id}
        estadoContable={(data.estado_contable ?? "borrador") as EstadoContable}
        estadoTecnico={data.estado}
        version={data.version ?? 1}
        fechaAprobacion={data.fecha_aprobacion ?? null}
        hayVersionesPrevias={hayVersionesPrevias}
      />

      {mostrarReview ? (
        <ResultadoReview
          jobId={data.id}
          resultado={resultadoParsed!.data}
          internos={payloadParsed.data.registros_internos}
          bancarios={payloadParsed.data.movimientos_bancarios}
          moneda={payloadParsed.data.metadata.cuenta.moneda}
          precedentes={precedentes}
        />
      ) : (
        <ProgresoConciliacion jobInicial={data as unknown as JobRow} />
      )}
    </div>
  );
}
