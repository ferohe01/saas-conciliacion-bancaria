import "server-only";
import { createClient } from "@/lib/supabase/server";
import { traerResumenSaldos } from "@/lib/comprobantesSaldo";
import { FILTRO_SALDO_VACIO } from "@/lib/filtrosSaldo";
import { consolidarCaja, type BloqueMoneda, type CuentaCaja } from "@/lib/posicionCaja";
import { saldoVivo, type ExtractoVigente, type SaldoVivo } from "@/lib/saldoVivo";
import { estadoCobros } from "@/app/(app)/conciliacion/[jobId]/actions";

/**
 * Lectura de la posición de caja. Vive aparte de `posicionCaja.ts` porque
 * `server-only` impide siquiera importar el módulo desde un test, y la
 * aritmética del disponible sí tiene que poder probarse.
 */

type Fila = Record<string, string | number | null>;

const num = (v: string | number | null | undefined): number => Number(v ?? 0);
/** Un numeric nulo se queda nulo: «no lo sé» no es «no hay plata». */
const numOnull = (v: string | number | null | undefined): number | null =>
  v == null ? null : Number(v);

export type PosicionCaja = {
  bloques: BloqueMoneda[];
  /**
   * Conciliaciones aprobadas cuyo reparto de cobros quedó a medias. No afecta
   * al saldo bancario —ese sale del extracto— pero sí a lo vencido, así que el
   * «disponible» puede quedarse corto y hay que decirlo.
   */
  cobrosIncompletos: { jobId: string; esperados: number; aplicados: number }[];
  /**
   * El saldo que declara el banco hoy, por cuenta, sin conciliar (fase 2).
   * ⚠️ Va aparte de `bloques` a propósito: lo provisional no se mezcla con lo
   * probado en ninguna estructura, ni siquiera en memoria.
   */
  vivos: SaldoVivo[];
};

export async function getPosicionCaja(hoy: Date = new Date()): Promise<PosicionCaja> {
  const supabase = await createClient(); // la función acota por auth.uid()

  const [caja, vencidos, vigentes] = await Promise.all([
    supabase.rpc("posicion_caja"),
    // ⚠️ Se reutiliza el mismo cálculo que Por pagar en vez de escribir otro:
    // si cada pantalla lo hiciera por su lado acabarían discrepando y el
    // usuario no sabría cuál creerse.
    traerResumenSaldos(supabase, "pago", FILTRO_SALDO_VACIO, hoy),
    supabase.rpc("extracto_vigente"),
  ]);

  if (caja.error) {
    // Ceros aquí se leerían como «no tienes plata», que es una afirmación que
    // nadie ha hecho. Mejor que la pantalla falle a que mienta.
    throw new Error(`No se pudo calcular la posición de caja: ${caja.error.message}`);
  }

  const cuentas: CuentaCaja[] = ((caja.data ?? []) as Fila[]).map((f) => ({
    cuentaId: String(f.cuenta_id),
    banco: String(f.banco ?? ""),
    numero: f.numero == null ? null : String(f.numero),
    moneda: String(f.moneda ?? "PEN"),
    jobId: f.job_id == null ? null : String(f.job_id),
    corteDesde: f.corte_desde == null ? null : String(f.corte_desde),
    corteHasta: f.corte_hasta == null ? null : String(f.corte_hasta),
    saldoFinal: numOnull(f.saldo_final),
    entradas: num(f.entradas),
    salidas: num(f.salidas),
    movimientos: num(f.movimientos),
    cortes: num(f.cortes),
    movDesde: f.mov_desde == null ? null : String(f.mov_desde),
    movHasta: f.mov_hasta == null ? null : String(f.mov_hasta),
  }));

  const vencidoPorMoneda = new Map<string, number>(
    vencidos.map((v) => [v.moneda.toUpperCase(), v.aging.vencido]),
  );

  // Solo los jobs que sostienen la posición —uno por cuenta, un puñado—, no el
  // historial entero.
  const jobs = [...new Set(cuentas.map((c) => c.jobId).filter((j): j is string => j != null))];
  const estados = await Promise.all(jobs.map((j) => estadoCobros(j)));
  const cobrosIncompletos = jobs
    .map((jobId, i) => ({ jobId, ...estados[i]! }))
    .filter((e) => e.esperados > e.aplicados);

  /**
   * El saldo vivo (fase 2). Si la migración `0051` todavía no está aplicada,
   * la RPC falla y el resto de la pantalla tiene que seguir funcionando: es un
   * añadido, no puede tumbar lo que ya servía. Mismo criterio que el reintento
   * sin `origen_partidas` del panel.
   */
  const aprobadoPorCuenta = new Map(cuentas.map((c) => [c.cuentaId, c.saldoFinal]));
  const vivos = vigentes.error
    ? []
    : (((vigentes.data ?? []) as Fila[])
        .map((f) => {
          const e: ExtractoVigente = {
            cuentaId: String(f.cuenta_id),
            loteId: String(f.lote_id),
            fechaMin: f.fecha_min == null ? null : String(f.fecha_min),
            fechaMax: f.fecha_max == null ? null : String(f.fecha_max),
            filas: num(f.filas),
            saldoDeclarado: numOnull(f.saldo_declarado),
            subidoEn: String(f.subido_en ?? ""),
            corteAprobado: f.corte_aprobado == null ? null : String(f.corte_aprobado),
            sumaPosterior: num(f.suma_posterior),
            movsPosteriores: num(f.movs_posteriores),
          };
          return saldoVivo(e, aprobadoPorCuenta.get(e.cuentaId) ?? null, hoy);
        })
        .filter((v): v is SaldoVivo => v != null));

  if (vigentes.error) {
    console.error("[caja] no se pudo leer el extracto vigente:", vigentes.error);
  }

  return {
    bloques: consolidarCaja(cuentas, vencidoPorMoneda, hoy),
    cobrosIncompletos,
    vivos,
  };
}
