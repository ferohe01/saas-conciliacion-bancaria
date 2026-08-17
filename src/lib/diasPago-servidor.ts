import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ObservacionPago } from "@/lib/diasPago";

/**
 * Lectura del calibrado de pagos. Vive aparte de `diasPago.ts` porque
 * `server-only` impide siquiera importar el módulo desde un test, y el criterio
 * —cuándo hay historial suficiente, qué se usa si no— sí tiene que poder
 * probarse.
 */

type Fila = Record<string, string | number | null>;

const num = (v: string | number | null | undefined): number => Number(v ?? 0);
const numOnull = (v: string | number | null | undefined): number | null =>
  v == null ? null : Number(v);

export async function getDiasPago(): Promise<ObservacionPago[]> {
  const supabase = await createClient(); // la función acota por auth.uid()
  const { data, error } = await supabase.rpc("dias_pago_contraparte");

  if (error) {
    // Devolver una lista vacía diría «no tienes historial», que es justo la
    // afirmación falsa que este módulo no puede permitirse. Mejor que falle.
    throw new Error(`No se pudo medir cuándo te pagan: ${error.message}`);
  }

  return ((data ?? []) as Fila[]).map((f) => ({
    nivel: String(f.nivel) as ObservacionPago["nivel"],
    contraparte: f.contraparte == null ? null : String(f.contraparte),
    ruc: f.ruc == null ? null : String(f.ruc),
    tipo: (f.tipo === "pago" ? "pago" : "cobranza") as ObservacionPago["tipo"],
    moneda: String(f.moneda ?? "PEN"),
    observaciones: num(f.observaciones),
    diasMediana: numOnull(f.dias_mediana),
    diasMin: numOnull(f.dias_min),
    diasMax: numOnull(f.dias_max),
    ultimoPago: f.ultimo_pago == null ? null : String(f.ultimo_pago),
    montoTotal: num(f.monto_total),
  }));
}
