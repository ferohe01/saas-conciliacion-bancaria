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
      "id, estado, fase_actual, resultado, error_detalle, periodo_desde, periodo_hasta, payload_entrada",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (!data) notFound();

  const resultadoParsed =
    data.estado === "completado"
      ? ResultadoConciliacion.safeParse(data.resultado)
      : null;
  const payloadParsed = PayloadConciliacion.safeParse(data.payload_entrada);

  const mostrarReview =
    resultadoParsed?.success && payloadParsed.success;

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

      {mostrarReview ? (
        <ResultadoReview
          jobId={data.id}
          resultado={resultadoParsed!.data}
          internos={payloadParsed.data.registros_internos}
          bancarios={payloadParsed.data.movimientos_bancarios}
          moneda={payloadParsed.data.metadata.cuenta.moneda}
        />
      ) : (
        <ProgresoConciliacion jobInicial={data as unknown as JobRow} />
      )}
    </div>
  );
}
