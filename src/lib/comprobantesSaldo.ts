import "server-only";
import { traerTodo } from "@/lib/supabase/paginado";
import type { ComprobanteCobrar, ResumenAging, TipoSaldo } from "@/lib/aging";
import { agingDesdeResumen, type FilaResumenSaldo } from "@/lib/agingResumen";
import type { FiltroSaldo } from "@/lib/filtrosSaldo";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lo que Por cobrar / Por pagar necesitan de cada comprobante.
 *
 * ── Por qué el filtro va en la CONSULTA y no en memoria ────────────────────
 *
 * Las dos pantallas se traían la tabla ENTERA y descartaban después lo que
 * `calcularAging` no cuenta. Con 51.427 comprobantes eran 52 peticiones
 * paginadas —cerca de un minuto— para quedarse con 19.221 en Por cobrar… y con
 * NINGUNO en Por pagar: la pantalla tardaba lo mismo en no encontrar nada,
 * porque el trabajo se hacía antes de saber que no había pagos.
 *
 * `calcularAging` descarta exactamente tres cosas, y las tres saben expresarse
 * en SQL, así que traerlas para tirarlas era trabajo puro:
 *
 *   1. el tipo contrario,
 *   2. lo anulado y lo ya cobrado,
 *   3. lo que tiene saldo cero.
 *
 * ⚠️ El filtro de aquí y el de `calcularAging` tienen que decir lo mismo. Si se
 * separan, la pantalla enseñaría un total que no corresponde a sus filas —y el
 * usuario no tendría forma de saber cuál de los dos números creerse.
 */

/** Columnas que consumen `calcularAging` y `filtrarSaldo`. */
export const COLUMNAS_SALDO =
  "id, fecha, fecha_vencimiento, monto, saldo, tipo, estado, serie_numero, ruc_contraparte, razon_social_contraparte";

/**
 * Antigüedad de deuda ya agregada por Postgres (`resumen_saldos`, migración
 * 0021).
 *
 * Sustituye a `traerComprobantesConSaldo` + `calcularAging` en las dos
 * pantallas: con 452.309 comprobantes pendientes aquello eran ~453 peticiones
 * de 1.000 filas para pintar una tabla de unas decenas.
 *
 * ⚠️ El día se manda desde aquí (`p_hoy`) en vez de dejar que Postgres use
 * `current_date`: el servidor de base de datos podría estar en otra zona, y un
 * tramo de antigüedad que cambie según quién pregunte es un fallo difícil de
 * ver y fácil de discutir con el cliente.
 */
export async function traerResumenSaldos(
  supabase: SupabaseClient,
  tipo: TipoSaldo,
  filtro: FiltroSaldo,
  hoy: Date = new Date(),
): Promise<ResumenAging> {
  const { data, error } = await supabase.rpc("resumen_saldos", {
    p_tipo: tipo,
    p_tramo: filtro.tramo,
    p_solo_vencido: filtro.soloVencido,
    p_busca: filtro.busca ?? "",
    p_hoy: hoy.toISOString().slice(0, 10),
  });
  if (error) {
    // Devolver un resumen vacío diría "no te deben nada", que es una respuesta
    // falsa y tranquilizadora. Mejor que la página falle a que mienta.
    throw new Error(
      `No se pudo calcular la antigüedad de deuda: ${error.message}`,
    );
  }
  return agingDesdeResumen((data ?? []) as FilaResumenSaldo[]);
}

export async function traerComprobantesConSaldo(
  supabase: SupabaseClient,
  tipo: TipoSaldo,
): Promise<ComprobanteCobrar[]> {
  return (await traerTodo((d, h) => {
    const q = supabase
      .from("comprobantes")
      .select(COLUMNAS_SALDO)
      // Un comprobante SIN tipo se cuenta como cobranza, igual que en el resto
      // del sistema; por eso el lado de cobranzas admite además el nulo.
      .not("estado", "in", "(anulado,cobrado)")
      // Mismo corte que `calcularAging`: por debajo de medio céntimo no hay
      // deuda que gestionar. Descarta también los nulos, que es lo correcto.
      .gt("saldo", 0.005)
      .order("fecha", { ascending: true })
      // Desempate: sin columna única el paginado duplica y pierde filas.
      .order("id", { ascending: true })
      .range(d, h);
    return tipo === "pago"
      ? q.eq("tipo", "pago")
      : q.or("tipo.eq.cobranza,tipo.is.null");
  })) as unknown as ComprobanteCobrar[];
}
