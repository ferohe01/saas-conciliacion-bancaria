import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";

/**
 * El residuo: lo que la capa exacta en SQL NO pudo casar y por tanto es lo
 * único que n8n tiene que mirar (parte B, etapas 2 y 3).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Emparejar por monto + referencia es un JOIN, y Postgres lo resuelve sobre
 * medio millón de filas en medio minuto. Medido con junio completo de una
 * recaudadora: 447.795 pares de 452.177 internos y 450.999 movimientos, o sea
 * el 99,03 %. Lo que queda —4.382 + 3.204— cabe de sobra en el payload que ya
 * existía.
 *
 * Sin esto, esas 903.176 partidas eran ~175 MB de JSON contra un webhook de 64.
 *
 * ── Los ids sintéticos ─────────────────────────────────────────────────────
 *
 * El motor referencia las partidas por `id_interno` / `id_movimiento`, que son
 * posicionales ("REG-0007"). Se generan aquí a partir del orden que devuelve la
 * base, y el uuid real viaja aparte (`comprobante_id`, `movimiento_id`) para
 * poder volver del match a la fila. Sin ese puente, el resultado de n8n no se
 * podría atar a nada.
 */

export type Residuo = {
  registros_internos: RegistroInterno[];
  movimientos_bancarios: MovimientoBancario[];
  /** Pares que resolvió la capa exacta en SQL, ya en `matches_conciliacion`. */
  paresExactos: number;
  /** Totales del período, para poder informar de cuánto se cubrió. */
  totalInternos: number;
  totalMovimientos: number;
};

type FilaInterno = {
  comprobante_id: string;
  fecha: string;
  monto: number | string;
  tipo: string;
  referencia: string | null;
  contraparte: string | null;
  descripcion: string | null;
};

type FilaMovimiento = {
  movimiento_id: string;
  fecha: string;
  monto: number | string;
  tipo: string;
  glosa: string | null;
  referencia_banco: string | null;
};

/**
 * Corre la capa exacta y devuelve lo que sobró, ya en la forma del contrato.
 *
 * `admin` porque las tres funciones están concedidas solo a `service_role`: las
 * invoca el backend, nunca el navegador.
 */
export async function construirResiduo(
  admin: SupabaseClient,
  jobId: string,
): Promise<Residuo> {
  const exacta = await admin.rpc("conciliar_exacta", { p_job_id: jobId });
  if (exacta.error) {
    throw new Error(`No se pudo correr la capa exacta: ${exacta.error.message}`);
  }
  const resumen = (exacta.data as { pares: number; internos: number; movimientos: number }[])?.[0];

  const [ri, rm] = await Promise.all([
    admin.rpc("residuo_internos", { p_job_id: jobId }),
    admin.rpc("residuo_movimientos", { p_job_id: jobId }),
  ]);
  if (ri.error) throw new Error(`No se pudo leer el residuo interno: ${ri.error.message}`);
  if (rm.error) throw new Error(`No se pudo leer el residuo bancario: ${rm.error.message}`);

  const internos = (ri.data ?? []) as FilaInterno[];
  const movimientos = (rm.data ?? []) as FilaMovimiento[];

  return {
    registros_internos: internos.map((c, i) => ({
      id_interno: `REG-${String(i + 1).padStart(4, "0")}`,
      fecha: String(c.fecha),
      // Postgres devuelve `numeric` como cadena para no perder precisión.
      monto: Number(c.monto),
      tipo: c.tipo === "pago" ? ("pago" as const) : ("cobranza" as const),
      referencia: c.referencia,
      contraparte: c.contraparte,
      descripcion: c.descripcion,
      comprobante_id: c.comprobante_id,
    })),
    movimientos_bancarios: movimientos.map((m, i) => ({
      id_movimiento: `BCO-${String(i + 1).padStart(4, "0")}`,
      fecha: String(m.fecha),
      monto: Number(m.monto),
      tipo: m.tipo === "cargo" ? ("cargo" as const) : ("abono" as const),
      glosa: m.glosa,
      referencia_banco: m.referencia_banco,
      movimiento_id: m.movimiento_id,
    })),
    paresExactos: Number(resumen?.pares ?? 0),
    totalInternos: Number(resumen?.internos ?? 0),
    totalMovimientos: Number(resumen?.movimientos ?? 0),
  };
}
