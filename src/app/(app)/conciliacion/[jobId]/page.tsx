import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ProgresoConciliacion,
  type JobRow,
} from "@/components/conciliacion/ProgresoConciliacion";
import { formatearFecha } from "@/lib/parsing/resumen";

/**
 * Pantalla de una conciliación: estado inicial del job desde el servidor (RLS)
 * + suscripción Realtime en el cliente para el progreso en vivo.
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
      "id, estado, fase_actual, resultado, error_detalle, periodo_desde, periodo_hasta",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (!data) notFound();
  const job = data as JobRow;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Conciliación
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Período {formatearFecha(job.periodo_desde)} –{" "}
          {formatearFecha(job.periodo_hasta)} · Job{" "}
          <span className="font-mono text-xs">{job.id}</span>
        </p>
      </div>

      <ProgresoConciliacion jobInicial={job} />
    </div>
  );
}
