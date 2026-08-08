import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ResumenEjecutivo } from "./resumenEjecutivo";

/**
 * Lectura del resumen ejecutivo. Vive aparte de las funciones puras porque
 * `server-only` impide siquiera importar el módulo desde un test, y el cálculo
 * de porcentajes y posición neta sí tiene que poder probarse.
 */

type Fila = Record<string, number | string | null>;
const n = (v: number | string | null | undefined) => Number(v ?? 0);

export async function getResumenEjecutivo(
  desde: string,
  hasta: string,
): Promise<ResumenEjecutivo> {
  const supabase = await createClient(); // la función acota por auth.uid()
  const { data, error } = await supabase.rpc("resumen_ejecutivo", {
    p_desde: desde,
    p_hasta: hasta,
    p_hoy: new Date().toISOString().slice(0, 10),
  });
  if (error) {
    // Ceros en una pantalla de dirección se leen como "no debes nada", que es
    // una afirmación tranquilizadora y falsa. Mejor que falle.
    throw new Error(`No se pudo calcular el resumen: ${error.message}`);
  }
  const f = (data as Fila[] | null)?.[0] ?? {};
  return {
    periodo: {
      conciliaciones: n(f.conciliaciones),
      sinAprobar: n(f.sin_aprobar),
      partidas: n(f.partidas),
      partidasConciliadas: n(f.partidas_conciliadas),
      cobrado: n(f.cobrado),
      pagado: n(f.pagado),
      diferenciaCuadre: n(f.diferencia_cuadre),
    },
    hoy: {
      porCobrar: n(f.por_cobrar),
      porCobrarVencido: n(f.por_cobrar_vencido),
      porCobrarDocs: n(f.por_cobrar_docs),
      porPagar: n(f.por_pagar),
      porPagarVencido: n(f.por_pagar_vencido),
      porPagarDocs: n(f.por_pagar_docs),
    },
  };
}

