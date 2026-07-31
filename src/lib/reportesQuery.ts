import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  deduplicarUltimoPorPeriodo,
  type JobReporte,
  type ResumenJob,
} from "@/lib/reportes";
import type { ResultadoConciliacion } from "@/lib/contract/resultado";
import type { PayloadConciliacion } from "@/lib/contract/payload";

/**
 * Carga los jobs completados con su detalle (resultado + payload) para el
 * drill-down del reporte. Deduplica por período+cuenta (misma regla que el
 * reporte agregado) para que el detalle coincida con los totales mostrados.
 */

export type DetalleJob = {
  periodoDesde: string;
  banco: string;
  numero: string | null;
  moneda: string;
  resultado: ResultadoConciliacion;
  payload: PayloadConciliacion;
};

type CuentaJoin =
  | { banco: string; numero_enmascarado: string | null; moneda: string }
  | { banco: string; numero_enmascarado: string | null; moneda: string }[]
  | null;

function primerCuenta(c: CuentaJoin) {
  return Array.isArray(c) ? c[0] : c;
}

export async function cargarReporteDetalle(): Promise<{
  jobsDef: JobReporte[];
  detalle: Map<string, DetalleJob>;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select(
      "id, periodo_desde, periodo_hasta, cuenta_id, created_at, resultado, payload_entrada, cuentas_bancarias(banco, numero_enmascarado, moneda)",
    )
    .eq("estado", "completado")
    .eq("estado_contable", "aprobada")
    .order("periodo_desde", { ascending: false });

  const jobs: JobReporte[] = [];
  const detalle = new Map<string, DetalleJob>();

  for (const j of (data ?? []) as Array<{
    id: string;
    periodo_desde: string;
    periodo_hasta: string;
    cuenta_id: string;
    created_at: string;
    resultado: (ResultadoConciliacion & { resumen?: ResumenJob }) | null;
    payload_entrada: PayloadConciliacion | null;
    cuentas_bancarias: CuentaJoin;
  }>) {
    const resumen = j.resultado?.resumen;
    if (!resumen || !j.resultado || !j.payload_entrada) continue;
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
      diferenciaCuadre: Number(j.resultado.cuadre?.diferencia ?? 0),
      createdAt: j.created_at,
    });
    detalle.set(j.id, {
      periodoDesde: j.periodo_desde,
      banco,
      numero,
      moneda: cuenta?.moneda ?? "PEN",
      resultado: j.resultado,
      payload: j.payload_entrada,
    });
  }

  return { jobsDef: deduplicarUltimoPorPeriodo(jobs), detalle };
}
