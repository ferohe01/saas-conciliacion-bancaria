import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { conteoCategoriasDeJobs } from "@/lib/conciliacion/conteos";
import { EncabezadoPagina, EstadoVacio, clasesBoton } from "@/components/ui";
import { FiltrosReporte } from "@/components/reportes/FiltrosReporte";
import { AvisoSinAprobar } from "@/components/conciliacion/AvisoSinAprobar";
import { ExportarReporte } from "@/components/reportes/ExportarReporte";
import { ReporteVista } from "@/components/reportes/ReporteVista";
import { nombreMes } from "@/lib/periodo";
import {
  filtrarAnual,
  filtrarMes,
  calcularKpis,
  porMes,
  porBanco,
  porTipoDiferencia,
  contarCategorias,
  deduplicarUltimoPorPeriodo,
  type JobReporte,
  type ResumenJob,
  type MatchLite,
} from "@/lib/reportes";

type CuentaJoin = {
  banco: string;
  numero_enmascarado: string | null;
} | { banco: string; numero_enmascarado: string | null }[] | null;

type JobRaw = {
  id: string;
  periodo_desde: string;
  periodo_hasta: string;
  estado: string;
  cuenta_id: string;
  created_at: string;
  resultado: {
    resumen?: ResumenJob;
    cuadre?: { diferencia?: number };
    matches?: MatchLite[];
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

  const [
    { data: cuentasData },
    { data: jobsData },
    { count: sinAprobar },
  ] = await Promise.all([
      supabase
        .from("cuentas_bancarias")
        .select("id, banco, numero_enmascarado")
        .order("banco"),
      supabase
        .from("jobs_conciliacion")
        .select(
          "id, periodo_desde, periodo_hasta, estado, cuenta_id, created_at, resultado, lote_extracto_id, cuentas_bancarias(banco, numero_enmascarado)",
        )
        // Solo lo APROBADO alimenta el reporte: es la conciliacion que rige.
        .eq("estado", "completado")
        .eq("estado_contable", "aprobada")
        .order("periodo_desde", { ascending: false }),
      // Terminadas pero sin aprobar: no cuentan aqui, y hay que decirlo.
      supabase
        .from("jobs_conciliacion")
        .select("id", { count: "exact", head: true })
        .eq("estado", "completado")
        .in("estado_contable", ["borrador", "en_proceso", "observada"]),
    ]);

  const cuentas = (cuentasData ?? []) as {
    id: string;
    banco: string;
    numero_enmascarado: string | null;
  }[];

  // Los jobs de modo tabla no llevan sus pares en el JSONB: su desglose se
  // cuenta en la base (ver `lib/conciliacion/conteos.ts`).
  const categoriasPorJob = await conteoCategoriasDeJobs(
    (jobsData ?? [])
      .filter((j) => (j as { lote_extracto_id?: string | null }).lote_extracto_id)
      .map((j) => (j as { id: string }).id),
  );

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
      periodoDesde: j.periodo_desde,
      periodoHasta: j.periodo_hasta,
      banco,
      cuentaId: j.cuenta_id,
      numero,
      resumen,
      diferenciaCuadre: Number(j.resultado?.cuadre?.diferencia ?? 0),
      createdAt: j.created_at,
      // El conteo de la base manda cuando existe: los jobs de modo tabla no
      // llevan sus pares en el JSONB.
      categorias:
        categoriasPorJob[j.id] ?? contarCategorias(j.resultado?.matches ?? []),
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
  const tipos = porTipoDiferencia(jobsFiltrados);

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
      <EncabezadoPagina
        titulo="Reportes de conciliación"
        descripcion="Cómo se conciliaron tus períodos, por banco y por tipo de diferencia."
        accion={
          hayDatos ? (
            <ExportarReporte
              kpis={kpis}
              mensual={mensual}
              bancos={bancosAgg}
              tipos={tipos}
              etiqueta={etiqueta || String(anio)}
            />
          ) : undefined
        }
      />

      {!hayDatos ? (
        <EstadoVacio
          titulo="Todavía no hay nada que reportar"
          texto="Los reportes se construyen con tus conciliaciones completadas. En cuanto cierres la primera, aquí verás automatización, cuadre y tipos de diferencia."
          accion={
            <Link href="/wizard" className={clasesBoton("primario", "md")}>
              Hacer la primera conciliación
            </Link>
          }
        />
      ) : (
        <>
          <AvisoSinAprobar cuantas={sinAprobar ?? 0} />

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
            <EstadoVacio
              titulo="Ninguna conciliación con este filtro"
              texto="No encontramos corridas para el período, banco o cuenta que elegiste. Prueba a ampliar el mes o quitar el filtro de banco."
            />
          ) : (
            <ReporteVista
              kpis={kpis}
              mensual={mensual}
              bancos={bancosAgg}
              tipos={tipos}
              recientes={recientes}
              filtroQuery={filtroQuery}
            />
          )}
        </>
      )}
    </div>
  );
}
