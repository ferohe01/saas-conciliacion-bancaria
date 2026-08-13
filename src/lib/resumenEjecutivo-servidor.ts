import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ResumenEjecutivo } from "./resumenEjecutivo";
import { motorDelResumen, origenDelJob } from "./origenPartidas-servidor";
import type { OrigenPartidas, ResultadoMotor } from "./origenPartidas";

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

export type OrigenDeConciliacion = {
  jobId: string;
  desde: string;
  hasta: string;
  origen: OrigenPartidas | null;
  motor: ResultadoMotor | null;
};

/**
 * La conciliación aprobada más reciente del rango, con su cascada de partidas.
 *
 * ⚠️ UNA sola, no la suma de todas. Sumar cascadas de varias conciliaciones
 * parece más completo y es falso en cuanto dos comparten carga de comprobantes:
 * las mismas filas del archivo se contarían dos veces. Aquí lo que se busca es
 * poder contestar «esto cuadra con mi Excel», y para eso hace falta un período
 * concreto contra un archivo concreto.
 *
 * ⚠️ Se pide `resultado->resumen`, no `resultado`: en modo payload ese JSONB
 * lleva todas las partidas y traerlo entero para leer siete números sería
 * megabytes por cada carga de pantalla.
 */
export async function getOrigenUltimaConciliacion(
  desde: string,
  hasta: string,
): Promise<OrigenDeConciliacion | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs_conciliacion")
    .select("id, periodo_desde, periodo_hasta, origen_partidas, resultado->resumen")
    .eq("estado", "completado")
    .eq("estado_contable", "aprobada")
    .lte("periodo_desde", hasta)
    .gte("periodo_hasta", desde)
    .order("periodo_hasta", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (error || !data?.[0]) return null;
  const j = data[0] as {
    id: string;
    periodo_desde: string;
    periodo_hasta: string;
    origen_partidas: unknown;
    resumen: unknown;
  };
  return {
    jobId: j.id,
    desde: j.periodo_desde,
    hasta: j.periodo_hasta,
    origen: origenDelJob(j.origen_partidas),
    motor: motorDelResumen({ resumen: j.resumen }),
  };
}

