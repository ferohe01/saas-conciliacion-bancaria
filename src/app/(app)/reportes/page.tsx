import { createClient } from "@/lib/supabase/server";
import { FiltrosReporte } from "@/components/reportes/FiltrosReporte";
import { ExportarReporte } from "@/components/reportes/ExportarReporte";
import { ReporteVista } from "@/components/reportes/ReporteVista";
import { nombreMes } from "@/lib/periodo";
import {
  filtrarAnual,
  filtrarMes,
  calcularKpis,
  porMes,
  porBanco,
  deduplicarUltimoPorPeriodo,
  type JobReporte,
  type ResumenJob,
} from "@/lib/reportes";

type CuentaJoin = {
  banco: string;
  numero_enmascarado: string | null;
} | { banco: string; numero_enmascarado: string | null }[] | null;

type JobRaw = {
  id: string;
  periodo_desde: string;
  estado: string;
  cuenta_id: string;
  created_at: string;
  resultado: {
    resumen?: ResumenJob;
    cuadre?: { diferencia?: number };
  } | null;
  cuentas_bancarias: CuentaJoin;
};

function primerCuenta(c: CuentaJoin) {
  return Array.isArray(c) ? c[0] : c;
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: cuentasData }, { data: jobsData }] = await Promise.all([
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, numero_enmascarado")
      .order("banco"),
    supabase
      .from("jobs_conciliacion")
      .select(
        "id, periodo_desde, estado, cuenta_id, created_at, resultado, cuentas_bancarias(banco, numero_enmascarado)",
      )
      .eq("estado", "completado")
      .order("periodo_desde", { ascending: false }),
  ]);

  const cuentas = (cuentasData ?? []) as {
    id: string;
    banco: string;
    numero_enmascarado: string | null;
  }[];

  // Normalizar jobs a JobReporte (solo los que tienen resumen válido).
  const jobs: JobReporte[] = [];
  const jobsMeta = new Map<
    string,
    { periodo_desde: string; banco: string; numero: string | null }
  >();
  for (const j of (jobsData ?? []) as JobRaw[]) {
    const resumen = j.resultado?.resumen;
    if (!resumen) continue;
    const cuenta = primerCuenta(j.cuentas_bancarias);
    const banco = cuenta?.banco ?? "—";
    const numero = cuenta?.numero_enmascarado ?? null;
    jobs.push({
      id: j.id,
      anio: Number(j.periodo_desde.slice(0, 4)),
      mes: Number(j.periodo_desde.slice(5, 7)),
      banco,
      cuentaId: j.cuenta_id,
      numero,
      resumen,
      diferenciaCuadre: Number(j.resultado?.cuadre?.diferencia ?? 0),
      createdAt: j.created_at,
    });
    jobsMeta.set(j.id, { periodo_desde: j.periodo_desde, banco, numero });
  }

  // Una conciliación por período+cuenta (la más reciente). Las re-corridas de
  // pruebas no inflan los totales; el historial sí las conserva todas.
  const jobsDef = deduplicarUltimoPorPeriodo(jobs);

  // Opciones de filtro.
  const aniosSet = new Set(jobsDef.map((j) => j.anio));
  aniosSet.add(new Date().getUTCFullYear());
  const anios = [...aniosSet].sort((a, b) => b - a);
  const bancos = [...new Set(cuentas.map((c) => c.banco))].sort();

  // Valores actuales del filtro.
  const anio = Number(sp.anio) || anios[0]!;
  const mes = sp.mes && sp.mes !== "todos" ? Number(sp.mes) : "todos";
  const banco = sp.banco ?? "todos";
  const cuenta = sp.cuenta ?? "todos";

  // Agregaciones.
  const jobsAnio = filtrarAnual(jobsDef, { anio, banco, cuentaId: cuenta });
  const jobsFiltrados = filtrarMes(jobsAnio, mes);
  const kpis = calcularKpis(jobsFiltrados);
  const mensual = porMes(jobsAnio);
  const bancosAgg = porBanco(jobsFiltrados);

  const recientes = jobsFiltrados.slice(0, 12).map((j) => {
    const meta = jobsMeta.get(j.id)!;
    return {
      id: j.id,
      periodo_desde: meta.periodo_desde,
      banco: meta.banco,
      numero: meta.numero,
      estado: "completado",
    };
  });

  const etiqueta = `${mes === "todos" ? "" : nombreMes(mes) + " "}${anio}${
    banco !== "todos" ? " · " + banco : ""
  }`.trim();

  const filtroQuery = new URLSearchParams({
    anio: String(anio),
    mes: sp.mes ?? "todos",
    banco,
    cuenta,
  }).toString();

  const hayDatos = jobsDef.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Reportes de conciliación
          </h1>
          <p className="mt-1 text-neutral-500">
            Resultados por período, banco y cuenta.
          </p>
        </div>
        {hayDatos && (
          <ExportarReporte
            kpis={kpis}
            mensual={mensual}
            bancos={bancosAgg}
            etiqueta={etiqueta || String(anio)}
          />
        )}
      </div>

      {!hayDatos ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
          Aún no hay conciliaciones completadas para reportar. Realiza tu primera
          conciliación y aquí verás las métricas.
        </p>
      ) : (
        <>
          <FiltrosReporte
            anios={anios}
            bancos={bancos}
            cuentas={cuentas}
            valores={{
              anio,
              mes: mes === "todos" ? "todos" : String(mes),
              banco,
              cuenta,
            }}
          />
          {kpis.conciliaciones === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
              No hay conciliaciones para este filtro. Prueba con otro período o
              banco.
            </p>
          ) : (
            <ReporteVista
              kpis={kpis}
              mensual={mensual}
              bancos={bancosAgg}
              recientes={recientes}
              filtroQuery={filtroQuery}
            />
          )}
        </>
      )}
    </div>
  );
}
