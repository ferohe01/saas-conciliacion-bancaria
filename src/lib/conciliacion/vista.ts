import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enLotes } from "@/lib/supabase/paginado";
import type {
  RegistroInterno,
  MovimientoBancario,
  PayloadConciliacion,
} from "@/lib/contract/payload";
import type { Match, ResultadoConciliacion } from "@/lib/contract/resultado";

/**
 * La vista de resultados cuando los pares viven en `matches_conciliacion`
 * (parte B, etapa 4).
 *
 * ── El problema ────────────────────────────────────────────────────────────
 *
 * La pantalla recibía el `resultado` entero y paginaba en el navegador. A 2.000
 * partidas es lo más simple que puede hacerse; con 447.795 pares no hay JSON
 * que enviar ni navegador que lo sostenga.
 *
 * ── Qué se carga ───────────────────────────────────────────────────────────
 *
 * Un TOPE de pares, con los que esperan decisión primero. Es la única parte que
 * pide trabajo humano: los `auto` están conciliados y nadie va a recorrer
 * 447.795 fichas a mano. La pantalla dice cuántos hay en total, para que el
 * recorte se vea y no se confunda con "solo se conciliaron mil".
 *
 * ⚠️ Los ids de las partidas son aquí los UUID reales, no los sintéticos
 * ("REG-0007"). Los sintéticos solo tienen sentido dentro de un payload, y los
 * pares de la capa exacta nunca estuvieron en uno. La pantalla no distingue: lo
 * único que necesita es que el id del match aparezca en las listas de partidas.
 */

/** Cuántos pares se traen. Techo de la pantalla, no del período. */
export const MAX_PARES_VISTA = 1000;

export type VistaResultado = {
  resultado: ResultadoConciliacion;
  internos: RegistroInterno[];
  bancarios: MovimientoBancario[];
  /** Pares que existen de verdad, para poder decir cuántos no se muestran. */
  totalPares: number;
  /** Id de cada par en la tabla, ALINEADO por índice con `resultado.matches`. */
  idsMatches: string[];
};

type FilaMatch = {
  id: string;
  comprobante_ids: string[];
  movimiento_ids: string[];
  metodo: string;
  estado_revision: string;
  confianza: number | null;
  categoria_diferencia: string | null;
  diferencia_monto: number | string | null;
  justificacion: string | null;
  decisiones: unknown;
  excluido_aprendizaje: boolean;
};

export async function cargarVistaResultado(
  jobId: string,
  resultadoBase: ResultadoConciliacion,
  payload: PayloadConciliacion | null,
): Promise<VistaResultado> {
  const admin = createAdminClient();

  const { count: totalPares } = await admin
    .from("matches_conciliacion")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);

  // Lo que espera decisión, primero. `pendiente` ordena antes que el resto
  // alfabéticamente por casualidad, así que el orden se hace explícito para que
  // no dependa de eso.
  const { data: filas } = await admin
    .from("matches_conciliacion")
    .select(
      "id, comprobante_ids, movimiento_ids, metodo, estado_revision, confianza, categoria_diferencia, diferencia_monto, justificacion, decisiones, excluido_aprendizaje",
    )
    .eq("job_id", jobId)
    .order("estado_revision", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_PARES_VISTA);

  const matchesTabla = (filas ?? []) as FilaMatch[];

  // Las partidas que esos pares referencian. El payload solo tiene el residuo,
  // así que los pares de la capa exacta hay que hidratarlos de sus tablas.
  const idsComp = [...new Set(matchesTabla.flatMap((m) => m.comprobante_ids))];
  const idsMov = [...new Set(matchesTabla.flatMap((m) => m.movimiento_ids))];

  const comps: RegistroInterno[] = [];
  for (const lote of enLotes(idsComp)) {
    const { data } = await admin
      .from("comprobantes")
      .select("id, fecha, monto, tipo, serie_numero, referencia_externa, razon_social_contraparte, descripcion")
      .in("id", lote);
    for (const c of data ?? []) {
      const monto = Math.abs(Number(c.monto ?? 0));
      comps.push({
        id_interno: c.id as string,
        fecha: String(c.fecha),
        monto: c.tipo === "pago" ? -monto : monto,
        tipo: c.tipo === "pago" ? "pago" : "cobranza",
        referencia: (c.referencia_externa ?? c.serie_numero) as string | null,
        contraparte: c.razon_social_contraparte as string | null,
        descripcion: c.descripcion as string | null,
        comprobante_id: c.id as string,
      });
    }
  }

  const movs: MovimientoBancario[] = [];
  for (const lote of enLotes(idsMov)) {
    const { data } = await admin
      .from("movimientos_extracto")
      .select("id, fecha, monto, glosa, referencia_banco")
      .in("id", lote);
    for (const m of data ?? []) {
      const monto = Number(m.monto ?? 0);
      movs.push({
        id_movimiento: m.id as string,
        fecha: String(m.fecha),
        monto,
        tipo: monto < 0 ? "cargo" : "abono",
        glosa: m.glosa as string | null,
        referencia_banco: m.referencia_banco as string | null,
        movimiento_id: m.id as string,
      });
    }
  }

  const matches: Match[] = matchesTabla.map((m) => ({
    ids_internos: m.comprobante_ids,
    ids_movimientos: m.movimiento_ids,
    metodo: m.metodo as Match["metodo"],
    estado_revision: m.estado_revision as Match["estado_revision"],
    confianza: m.confianza == null ? null : Number(m.confianza),
    categoria_diferencia: m.categoria_diferencia as Match["categoria_diferencia"],
    diferencia_monto:
      m.diferencia_monto == null ? null : Number(m.diferencia_monto),
    justificacion: m.justificacion,
    decisiones: (m.decisiones ?? []) as Match["decisiones"],
    excluido_aprendizaje: m.excluido_aprendizaje,
  }));

  // ⚠️⚠️ SIN DUPLICAR. Una partida del residuo que n8n acabó emparejando está
  // en los DOS sitios: en el payload con su id sintético («REG-0007») y aquí
  // hidratada con su uuid, que es el que referencia el par.
  //
  // Dejar las dos no era un detalle de memoria: la copia del payload no la
  // menciona ningún match, así que la pantalla la contaba **como sin
  // conciliar** — y la pintaba en esa lista— mientras la otra copia aparecía en
  // "Ya conciliado". La misma partida en los dos paneles, y el recuento inflado:
  // en una conciliación de 233 × 221 decía «128 sin conciliar · 72 %
  // emparejado» cuando la verdad era 78 y el 83 %.
  //
  // Gana la hidratada: es la que los pares referencian.
  const hidratadosInt = new Set(comps.map((c) => c.comprobante_id));
  const hidratadosMov = new Set(movs.map((m) => m.movimiento_id));
  const residuoInt = (payload?.registros_internos ?? []).filter(
    (r) => r.comprobante_id == null || !hidratadosInt.has(r.comprobante_id),
  );
  const residuoMov = (payload?.movimientos_bancarios ?? []).filter(
    (m) => m.movimiento_id == null || !hidratadosMov.has(m.movimiento_id),
  );

  return {
    resultado: { ...resultadoBase, matches },
    // El residuo del payload sigue haciendo falta: de ahí salen las fichas del
    // panel "Sin conciliar", que referencia partidas que ningún par toca.
    internos: [...residuoInt, ...comps],
    bancarios: [...residuoMov, ...movs],
    totalPares: totalPares ?? matches.length,
    idsMatches: matchesTabla.map((m) => m.id),
  };
}
