import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatearFecha } from "@/lib/parsing/resumen";
import { DocumentoIcon } from "@/components/wizard/icons";
import type { EstadoContable } from "@/lib/cicloContable";
import {
  EncabezadoPagina,
  EstadoVacio,
  BadgeEstadoJob,
  BadgeEstadoContable,
  clasesBoton,
} from "@/components/ui";

type Cuenta = { banco: string; numero_enmascarado: string | null };
type JobHistorial = {
  id: string;
  estado: string;
  estado_contable: EstadoContable | null;
  version: number | null;
  periodo_desde: string;
  periodo_hasta: string;
  created_at: string;
  resultado: {
    resumen?: {
      conciliados_exactos: number;
      conciliados_difusos: number;
      total_internos: number;
    };
    cuadre?: { diferencia: number };
  } | null;
  cuentas_bancarias: Cuenta | Cuenta[] | null;
};

export default async function HistorialPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select(
      "id, estado, estado_contable, version, periodo_desde, periodo_hasta, created_at, resultado, cuentas_bancarias(banco, numero_enmascarado)",
    )
    .order("created_at", { ascending: false });

  const jobs = (data ?? []) as JobHistorial[];

  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Historial de conciliaciones"
        descripcion="Todas tus corridas, de la más reciente a la más antigua."
        accion={
          <Link href="/wizard" className={clasesBoton("primario", "md")}>
            Nueva conciliación
          </Link>
        }
      />

      {jobs.length === 0 ? (
        <EstadoVacio
          icono={<DocumentoIcon className="h-6 w-6" />}
          titulo="Todavía no has conciliado ningún período"
          texto="Cuando cierres tu primera conciliación aparecerá aquí, con su cuadre y todas las decisiones que hayas tomado."
          accion={
            <Link href="/wizard" className={clasesBoton("primario", "md")}>
              Empezar la primera
            </Link>
          }
        />
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
            const dif = job.resultado?.cuadre?.diferencia;
            const cuadra = dif != null && Math.abs(dif) < 0.005;

            return (
              <li key={job.id}>
                <Link
                  href={`/conciliacion/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-asiento transition-colors hover:border-neutral-400"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900">
                      <span className="tabular-nums">
                        {formatearFecha(job.periodo_desde)} –{" "}
                        {formatearFecha(job.periodo_hasta)}
                      </span>
                      {cuenta && (
                        <span className="ml-2 font-normal text-neutral-600">
                          · {cuenta.banco} {cuenta.numero_enmascarado ?? ""}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-neutral-600">
                      {conciliados != null && resumen ? (
                        <span className="tabular-nums">
                          {conciliados} de {resumen.total_internos} conciliados
                        </span>
                      ) : job.estado === "error" ? (
                        "No se pudo completar"
                      ) : (
                        "Aún sin resultado"
                      )}
                      {dif != null && (
                        <>
                          {" · "}
                          <span
                            className={
                              cuadra
                                ? "font-medium text-emerald-800"
                                : "font-medium text-amber-800"
                            }
                          >
                            {cuadra ? "cuadra" : "con diferencia"}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    <BadgeEstadoContable
                      estado={job.estado_contable ?? "borrador"}
                      version={job.version}
                    />
                    <BadgeEstadoJob estado={job.estado} />
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
