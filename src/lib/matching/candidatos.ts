import { palabras, palabrasComunes } from "./similitud";
import type {
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";

/**
 * Generación de candidatos para la capa de IA (record-linkage / blocking).
 *
 * En vez de pasarle a la IA todos los pendientes crudos, se prepara — por cada
 * registro interno — una lista corta de los movimientos bancarios más
 * relevantes, con features calculadas y un score, ya rankeada (top-K). La IA
 * luego solo ADJUDICA sobre esta shortlist (elige el mejor o ninguno), lo que
 * mejora precisión, evita alucinaciones y reduce el costo del LLM.
 *
 * Candidatura (blocking): mismo signo + diferencia de monto <= tolerancia_ia_monto
 * + fecha dentro de ventana + al menos 1 palabra en común entre contraparte y
 * glosa (requisito de precisión). El score rankea; se conservan los top-K.
 */

export type FeaturesCandidato = {
  dif_abs: number;
  dif_pct: number;
  dias: number;
  palabras_comunes: string[];
  similitud: number; // Jaccard de tokens (0..1)
  comparte_ref: boolean;
};

export type Candidato = {
  id_movimiento: string;
  features: FeaturesCandidato;
  score: number; // 0..1
  categoria_probable: string;
};

export type ShortlistInterno = {
  id_interno: string;
  candidatos: Candidato[];
};

export type ConfigCandidatos = {
  tolerancia_ia_monto: number;
  tolerancia_dias: number;
  top_k_candidatos?: number;
  top_k?: number; // alias retrocompatible
};

function diasEntre(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

function normRef(r: string | null | undefined): string {
  return String(r ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Similitud Jaccard entre los tokens de dos textos (0..1). */
function jaccard(a: string | null | undefined, b: string | null | undefined): number {
  const A = new Set(palabras(a));
  const B = new Set(palabras(b));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = new Set([...A, ...B]).size;
  return union > 0 ? inter / union : 0;
}

/** Categoría probable de la diferencia (la IA puede refinarla). */
export function categoriaProbable(difAbs: number): string {
  if (difAbs < 0.005) return "diferencia_temporal";
  if (difAbs <= 10) return "comision_bancaria";
  return "requiere_investigacion";
}

export function generarCandidatos(
  internos: RegistroInterno[],
  bancarios: MovimientoBancario[],
  cfg: ConfigCandidatos,
): ShortlistInterno[] {
  const tolIa = Number(cfg.tolerancia_ia_monto ?? 10);
  const tolDias = Number(cfg.tolerancia_dias ?? 3);
  const K = cfg.top_k_candidatos ?? cfg.top_k ?? 3;
  const ventana = tolDias + 4;

  const salida: ShortlistInterno[] = [];

  for (const it of internos) {
    const cands: Candidato[] = [];
    for (const bc of bancarios) {
      if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
      const difAbs = Math.abs(it.monto - bc.monto);
      if (difAbs > tolIa) continue;
      const d = diasEntre(it.fecha, bc.fecha);
      if (d > ventana) continue;
      const comunes = palabrasComunes(it.contraparte, bc.glosa);
      const refI = normRef(it.referencia);
      const comparteRef = refI.length > 0 && refI === normRef(bc.referencia_banco);
      // Es candidato si comparte NOMBRE (>=1 palabra) O si la referencia/Nº de
      // operación coincide exactamente (señal fuerte aunque la glosa no traiga
      // el nombre). Sin ninguno de los dos, se descarta.
      if (comunes.length === 0 && !comparteRef) continue;

      const sim = jaccard(it.contraparte, bc.glosa);
      const cercMonto = 1 - Math.min(difAbs / (tolIa || 1), 1);
      const cercFecha = 1 - Math.min(d / (ventana || 1), 1);
      const score = Number(
        Math.min(
          1,
          0.5 * sim + 0.3 * cercMonto + 0.2 * cercFecha + (comparteRef ? 0.2 : 0),
        ).toFixed(3),
      );

      cands.push({
        id_movimiento: bc.id_movimiento,
        features: {
          dif_abs: Number(difAbs.toFixed(2)),
          dif_pct: it.monto
            ? Number(((difAbs / Math.abs(it.monto)) * 100).toFixed(2))
            : 0,
          dias: d,
          palabras_comunes: comunes,
          similitud: Number(sim.toFixed(2)),
          comparte_ref: comparteRef,
        },
        score,
        categoria_probable: categoriaProbable(difAbs),
      });
    }
    cands.sort((a, b) => b.score - a.score);
    if (cands.length > 0) {
      salida.push({ id_interno: it.id_interno, candidatos: cands.slice(0, K) });
    }
  }

  return salida;
}
