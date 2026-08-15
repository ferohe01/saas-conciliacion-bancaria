import "server-only";
import { createClient } from "@/lib/supabase/server";
import { enLotes } from "@/lib/supabase/paginado";
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
  /** Con lote, los pares viven en `matches_conciliacion`, no en el resultado. */
  loteExtractoId: string | null;
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
      "id, periodo_desde, periodo_hasta, cuenta_id, created_at, resultado, payload_entrada, lote_extracto_id, cuentas_bancarias(banco, numero_enmascarado, moneda)",
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
      loteExtractoId: (j as { lote_extracto_id?: string | null }).lote_extracto_id ?? null,
      banco,
      numero,
      moneda: cuenta?.moneda ?? "PEN",
      resultado: j.resultado,
      payload: j.payload_entrada,
    });
  }

  return { jobsDef: deduplicarUltimoPorPeriodo(jobs), detalle };
}

/**
 * Los pares de un job cuando viven en `matches_conciliacion` (modo tabla).
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * El detalle por método (`/reportes/[metodo]`) resolvía los pares desde
 * `resultado.matches` contra `payload_entrada`. En modo tabla esos dos sitios
 * están vacíos para lo emparejado: los pares se guardan en su tabla desde la
 * etapa 4 de la parte B, y el payload solo lleva el RESIDUO. Resultado: pinchar
 * en «Exacta» sobre una conciliación de 163 pares mostraba **«0 registros ·
 * Nada en esta categoría»**.
 *
 * Es el mismo hueco que la etapa 6 tapó en los reportes agregados y en el
 * aprendizaje (`conteo_matches`, `matches_revisados`); esta pantalla se quedó
 * fuera y nadie lo notó porque el cliente grande no la usa.
 *
 * ⚠️ CON TOPE, y se dice en pantalla. Una tabla en el navegador no aguanta
 * 447.795 filas, así que se traen las primeras `tope` y quien llama informa de
 * cuántas hay en total. Es la regla de `lib/supabase/paginado.ts`: o paginas, o
 * pones un límite explícito Y lo dices.
 */
export type ParDetalle = {
  ids_internos: string[];
  ids_movimientos: string[];
  metodo: string;
  estado_revision: string;
  categoria_diferencia: string | null;
  diferencia_monto: number | null;
  justificacion: string | null;
  internos: Map<string, { fecha: string; monto: number; texto: string }>;
  movimientos: Map<string, { fecha: string; monto: number; texto: string }>;
};

export async function cargarParesDeTabla(
  jobId: string,
  /** `null` = todos los métodos: lo que necesita el detalle por tipo. */
  metodo: "exacta" | "difusa" | "ia" | null,
  tope: number,
): Promise<{ pares: ParDetalle[]; total: number }> {
  const supabase = await createClient(); // RLS: solo jobs de su empresa

  const base = () => {
    const q = supabase.from("matches_conciliacion").select(
      "comprobante_ids, movimiento_ids, metodo, estado_revision, categoria_diferencia, diferencia_monto, justificacion",
    ).eq("job_id", jobId);
    return metodo ? q.eq("metodo", metodo) : q;
  };

  const conteo = supabase
    .from("matches_conciliacion")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  const { count } = await (metodo ? conteo.eq("metodo", metodo) : conteo);

  const { data: filas } = await base()
    // Desempate obligatorio: sin columna única el orden entre páginas baila.
    .order("id", { ascending: true })
    .limit(tope);

  const pares = (filas ?? []) as {
    comprobante_ids: string[];
    movimiento_ids: string[];
    metodo: string;
    estado_revision: string;
    categoria_diferencia: string | null;
    diferencia_monto: number | string | null;
    justificacion: string | null;
  }[];
  if (pares.length === 0) return { pares: [], total: count ?? 0 };

  const idsComp = [...new Set(pares.flatMap((p) => p.comprobante_ids))];
  const idsMov = [...new Set(pares.flatMap((p) => p.movimiento_ids))];

  const internos = new Map<string, { fecha: string; monto: number; texto: string }>();
  for (const lote of enLotes(idsComp)) {
    const { data } = await supabase
      .from("comprobantes")
      .select("id, fecha, monto, tipo, serie_numero, referencia_externa, razon_social_contraparte, descripcion")
      .in("id", lote);
    for (const c of data ?? []) {
      const monto = Math.abs(Number(c.monto ?? 0));
      internos.set(c.id as string, {
        fecha: String(c.fecha),
        monto: c.tipo === "pago" ? -monto : monto,
        texto:
          (c.razon_social_contraparte as string | null) ??
          (c.descripcion as string | null) ??
          (c.referencia_externa as string | null) ??
          (c.serie_numero as string | null) ??
          "",
      });
    }
  }
  const movimientos = new Map<string, { fecha: string; monto: number; texto: string }>();
  for (const lote of enLotes(idsMov)) {
    const { data } = await supabase
      .from("movimientos_extracto")
      .select("id, fecha, monto, glosa, referencia_banco")
      .in("id", lote);
    for (const m of data ?? []) {
      movimientos.set(m.id as string, {
        fecha: String(m.fecha),
        monto: Number(m.monto ?? 0),
        texto:
          (m.glosa as string | null) ?? (m.referencia_banco as string | null) ?? "",
      });
    }
  }

  return {
    total: count ?? pares.length,
    pares: pares.map((p) => ({
      ids_internos: p.comprobante_ids,
      ids_movimientos: p.movimiento_ids,
      metodo: p.metodo,
      estado_revision: p.estado_revision,
      categoria_diferencia: p.categoria_diferencia,
      diferencia_monto:
        p.diferencia_monto == null ? null : Number(p.diferencia_monto),
      justificacion: p.justificacion,
      internos,
      movimientos,
    })),
  };
}
