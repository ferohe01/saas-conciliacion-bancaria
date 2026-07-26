import Link from "next/link";
import { getEmpresaActual } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resumenAprendizaje } from "@/lib/aprendizaje";
import { PanelAprendizajeCompacto } from "@/components/reportes/ReporteVista";
import { formatearFecha } from "@/lib/parsing/resumen";
import { BancoIcon } from "@/components/wizard/icons";
import {
  Tarjeta,
  EstadoVacio,
  BadgeEstadoJob,
  clasesBoton,
} from "@/components/ui";

type JobDash = {
  id: string;
  estado: string;
  periodo_desde: string;
  periodo_hasta: string;
  resultado: {
    matches?: { estado_revision?: string }[];
    cuadre?: { diferencia: number };
  } | null;
};

export default async function DashboardPage() {
  const empresa = await getEmpresaActual();
  const supabase = await createClient();

  // Pool de aprendizaje (últimos 30 jobs, mismo criterio que el few-shot). RLS
  // limita a la empresa del usuario.
  const { data: histAprend } = await supabase
    .from("jobs_conciliacion")
    .select("resultado")
    .eq("estado", "completado")
    .not("resultado", "is", null)
    .order("created_at", { ascending: false })
    .limit(30);
  const aprendizaje = resumenAprendizaje(
    (histAprend ?? []) as Parameters<typeof resumenAprendizaje>[0],
  );

  const [{ data: recientesData }, { count: numCuentas }] = await Promise.all([
    supabase
      .from("jobs_conciliacion")
      .select("id, estado, periodo_desde, periodo_hasta, resultado")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("cuentas_bancarias")
      .select("id", { count: "exact", head: true }),
  ]);

  const recientes = (recientesData ?? []) as JobDash[];
  const sinCuentas = (numCuentas ?? 0) === 0;

  // Lo único que de verdad reclama atención: sugerencias esperando criterio.
  const porRevisar = recientes.reduce(
    (acc, j) =>
      acc +
      (j.resultado?.matches ?? []).filter(
        (m) => m.estado_revision === "pendiente",
      ).length,
    0,
  );
  const jobConPendientes = recientes.find((j) =>
    (j.resultado?.matches ?? []).some((m) => m.estado_revision === "pendiente"),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-balance text-neutral-900">
          Hola, {empresa?.nombre}
        </h1>
        <p className="mt-1 text-neutral-600">
          {sinCuentas
            ? "Registra tu primera cuenta bancaria para empezar."
            : porRevisar > 0
              ? "Tienes trabajo esperando tu criterio."
              : "Todo al día. Empieza una conciliación cuando quieras."}
        </p>
      </div>

      {/* Primero: lo que reclama a la persona. Solo aparece si existe. */}
      {porRevisar > 0 && jobConPendientes && (
        <Tarjeta tono="maquina">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-neutral-900">
                <span className="tabular-nums">{porRevisar}</span>{" "}
                {porRevisar === 1
                  ? "sugerencia espera tu revisión"
                  : "sugerencias esperan tu revisión"}
              </p>
              <p className="mt-0.5 text-sm text-neutral-700">
                La IA propuso estos emparejamientos; nada se concilia sin que tú
                lo apruebes.
              </p>
            </div>
            <Link
              href={`/conciliacion/${jobConPendientes.id}`}
              className={clasesBoton("primario", "md")}
            >
              Revisar ahora
            </Link>
          </div>
        </Tarjeta>
      )}

      {/* Acción principal: una sola, con peso. No dos tarjetas gemelas. */}
      {sinCuentas ? (
        <EstadoVacio
          icono={<BancoIcon className="h-6 w-6" />}
          titulo="Empieza registrando tu cuenta bancaria"
          texto="Necesitamos saber de qué banco es el extracto que vas a subir. Toma menos de un minuto y solo se hace una vez."
          accion={
            <Link href="/cuentas" className={clasesBoton("primario", "md")}>
              Registrar una cuenta
            </Link>
          }
        />
      ) : (
        <Tarjeta className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              Conciliar un período
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              Sube tus registros y el extracto del banco. Te devolvemos el
              cuadre con cada diferencia explicada.
            </p>
          </div>
          <Link href="/wizard" className={clasesBoton("primario", "lg")}>
            Empezar
          </Link>
        </Tarjeta>
      )}

      {/* Actividad reciente: antes el dashboard era un callejón sin salida. */}
      {recientes.length > 0 && (
        <section aria-labelledby="h-recientes">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2
              id="h-recientes"
              className="text-lg font-semibold text-neutral-900"
            >
              Últimas conciliaciones
            </h2>
            <Link
              href="/conciliacion"
              className="rounded text-sm font-medium text-blue-700 transition-colors hover:text-blue-800"
            >
              Ver todas →
            </Link>
          </div>
          <ul className="space-y-2">
            {recientes.map((j) => {
              const dif = j.resultado?.cuadre?.diferencia;
              const cuadra = dif != null && Math.abs(dif) < 0.005;
              return (
                <li key={j.id}>
                  <Link
                    href={`/conciliacion/${j.id}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 transition-colors hover:border-neutral-400"
                  >
                    <span className="text-sm tabular-nums text-neutral-800">
                      {formatearFecha(j.periodo_desde)} –{" "}
                      {formatearFecha(j.periodo_hasta)}
                      {dif != null && (
                        <span
                          className={`ml-2 font-medium ${cuadra ? "text-emerald-800" : "text-amber-800"}`}
                        >
                          {cuadra ? "cuadra" : "con diferencia"}
                        </span>
                      )}
                    </span>
                    <BadgeEstadoJob estado={j.estado} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <PanelAprendizajeCompacto ap={aprendizaje} />
    </div>
  );
}
