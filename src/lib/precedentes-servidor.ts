import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  buscarPrecedente,
  clavePrecedente,
  extraerCasos,
  type JobHistorico,
  type Precedente,
} from "@/lib/precedentes";

/**
 * Precedentes para las sugerencias de una conciliación (solo servidor).
 *
 * Se calcula aquí y no en el cliente por dos razones: el historial de otros
 * jobs no debe viajar entero al navegador —son datos de otras conciliaciones—,
 * y el emparejamiento es determinístico, así que basta con mandar el resultado.
 */

/** Cuántas conciliaciones anteriores se miran para buscar un caso parecido. */
const JOBS_HISTORIAL = 30;

type MatchParaBuscar = {
  ids_internos?: string[];
  ids_movimientos?: string[];
  estado_revision?: string;
  categoria_diferencia?: string | null;
};

type PayloadActual = {
  registros_internos: {
    id_interno: string;
    monto: number;
    contraparte?: string | null;
    descripcion?: string | null;
  }[];
  movimientos_bancarios: {
    id_movimiento: string;
    monto: number;
    glosa?: string | null;
  }[];
};

export async function getPrecedentes(
  jobIdActual: string,
  matches: MatchParaBuscar[],
  payload: PayloadActual,
): Promise<Record<string, Precedente>> {
  // Solo interesa lo que está a la espera de decisión: buscar precedentes de lo
  // ya resuelto sería trabajo tirado.
  const pendientes = matches.filter((m) => m.estado_revision === "pendiente");
  if (pendientes.length === 0) return {};

  const supabase = await createClient(); // RLS: solo la empresa del usuario
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select("payload_entrada, resultado")
    .eq("estado", "completado")
    .not("resultado", "is", null)
    .neq("id", jobIdActual) // el propio job no es precedente de sí mismo
    .order("created_at", { ascending: false })
    .limit(JOBS_HISTORIAL);

  const casos = extraerCasos((data ?? []) as JobHistorico[]);
  if (casos.length === 0) return {};

  const regs = new Map(payload.registros_internos.map((r) => [r.id_interno, r]));
  const movs = new Map(
    payload.movimientos_bancarios.map((m) => [m.id_movimiento, m]),
  );

  const salida: Record<string, Precedente> = {};

  for (const m of pendientes) {
    const idsInt = m.ids_internos ?? [];
    const idsMov = m.ids_movimientos ?? [];
    const rs = idsInt.map((id) => regs.get(id)).filter(Boolean);
    const ms = idsMov.map((id) => movs.get(id)).filter(Boolean);
    if (!rs.length || !ms.length) continue;

    const montoInterno = rs.reduce((a, r) => a + (r?.monto ?? 0), 0);
    const montoBanco = ms.reduce((a, x) => a + (x?.monto ?? 0), 0);
    const primero = rs[0]!;

    const p = buscarPrecedente(
      {
        contraparte: (primero.contraparte ?? primero.descripcion ?? "").trim(),
        glosa: (ms[0]!.glosa ?? "").trim(),
        montoInterno,
        montoBanco,
        diferencia: Number((montoInterno - montoBanco).toFixed(2)),
        categoria: m.categoria_diferencia ?? null,
      },
      casos,
    );

    if (p) salida[clavePrecedente(idsInt, idsMov)] = p;
  }

  return salida;
}
