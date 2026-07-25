import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatearFecha } from "@/lib/parsing/resumen";

const ESTADO_ESTILO: Record<string, string> = {
  completado: "bg-emerald-100 text-emerald-700",
  procesando: "bg-blue-100 text-blue-700",
  pendiente: "bg-neutral-200 text-neutral-700",
  error: "bg-red-100 text-red-700",
};

type Cuenta = { banco: string; numero_enmascarado: string | null };
type JobHistorial = {
  id: string;
  estado: string;
  periodo_desde: string;
  periodo_hasta: string;
  created_at: string;
  resultado: { resumen?: { conciliados_exactos: number; conciliados_difusos: number; total_internos: number } } | null;
  cuentas_bancarias: Cuenta | Cuenta[] | null;
};

export default async function HistorialPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select(
      "id, estado, periodo_desde, periodo_hasta, created_at, resultado, cuentas_bancarias(banco, numero_enmascarado)",
    )
    .order("created_at", { ascending: false });

  const jobs = (data ?? []) as JobHistorial[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Historial de conciliaciones
          </h1>
          <p className="mt-1 text-neutral-500">
            Tus conciliaciones anteriores.
          </p>
        </div>
        <Link
          href="/wizard"
          className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Nueva conciliación
        </Link>
      </div>

      {jobs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
          Aún no has realizado ninguna conciliación.
        </p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => {
            const cuenta = Array.isArray(job.cuentas_bancarias)
              ? job.cuentas_bancarias[0]
              : job.cuentas_bancarias;
            const resumen = job.resultado?.resumen;
            const conciliados = resumen
              ? resumen.conciliados_exactos + resumen.conciliados_difusos
              : null;
            return (
              <li key={job.id}>
                <Link
                  href={`/conciliacion/${job.id}`}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-neutral-300"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900">
                      {formatearFecha(job.periodo_desde)} –{" "}
                      {formatearFecha(job.periodo_hasta)}
                      {cuenta && (
                        <span className="ml-2 font-normal text-neutral-500">
                          · {cuenta.banco} {cuenta.numero_enmascarado ?? ""}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-neutral-500">
                      {conciliados != null && resumen
                        ? `${conciliados} de ${resumen.total_internos} conciliados`
                        : "Sin resultado aún"}
                      <span className="font-mono text-xs"> · {job.id}</span>
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                      ESTADO_ESTILO[job.estado] ?? "bg-neutral-200 text-neutral-700"
                    }`}
                  >
                    {job.estado}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
