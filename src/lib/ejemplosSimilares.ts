import type { EjemploAprendizaje } from "@/lib/contract/payload";
import type { Shortlist } from "@/lib/motor/candidatosIa";

/**
 * Ejemplos de aprendizaje por SIMILITUD (pgvector, 0059) — la parte pura.
 *
 * Las mismas decisiones humanas de siempre (`construirEjemplos`), pero en vez de
 * las 12 más recientes se eligen las más parecidas a los casos que el motor le
 * va a preguntar al modelo. El texto que se convierte en vector es el mismo
 * resumen «monto · nombre · fecha» que ya ve el modelo: así la distancia mide
 * lo que el modelo compara.
 */

/** Lo que se convierte en vector de un ejemplo (sin la decisión: eso no debe pesar en el parecido). */
export function textoEjemplo(e: EjemploAprendizaje): string {
  return `registro {${e.interno}} ↔ banco {${e.banco}}${e.categoria ? ` (${e.categoria})` : ""}`;
}

/** Lo que se convierte en vector de un caso a consultar: el registro y su mejor candidato. */
export function textoConsulta(s: Shortlist): string {
  const c = s.candidatos[0];
  const banco = c ? `${c.monto.toFixed(2)} · ${c.glosa} · ${c.fecha}` : "";
  return `registro {${s.monto.toFixed(2)} · ${s.nombre} · ${s.fecha}} ↔ banco {${banco}}`;
}

/** Identidad estable de un ejemplo, para calcular su vector una sola vez. */
export function claveEjemplo(e: EjemploAprendizaje): string {
  return `${e.decision}|${e.interno}|${e.banco}`;
}

export type Vecino = {
  consulta: number;
  clave: string;
  decision: string;
  interno: string;
  banco: string;
  categoria: string | null;
  motivo: string | null;
  distancia: number;
};

/**
 * Elige los ejemplos a partir de los vecinos de todas las consultas.
 *
 * Gana el ejemplo que es vecino de MÁS casos y, a igualdad, el más cercano: un
 * ejemplo parecido a medio lote enseña más que uno parecido a un solo caso.
 * Se conserva el equilibrio por clase de `construirEjemplos` (≤6 aceptados y ≤6
 * rechazados, ≤12 en total): un pool de solo aceptados enseñaría a aceptar.
 */
export function seleccionarEjemplos(
  vecinos: Vecino[],
  opts: { maxPorClase?: number; maxTotal?: number } = {},
): EjemploAprendizaje[] {
  const maxPorClase = opts.maxPorClase ?? 6;
  const maxTotal = opts.maxTotal ?? 12;

  const porClave = new Map<string, { v: Vecino; veces: number; mejor: number }>();
  for (const v of vecinos) {
    const prev = porClave.get(v.clave);
    if (prev) {
      prev.veces++;
      prev.mejor = Math.min(prev.mejor, v.distancia);
    } else {
      porClave.set(v.clave, { v, veces: 1, mejor: v.distancia });
    }
  }
  const ordenados = [...porClave.values()].sort(
    (a, b) => b.veces - a.veces || a.mejor - b.mejor,
  );

  const positivos: EjemploAprendizaje[] = [];
  const negativos: EjemploAprendizaje[] = [];
  for (const { v } of ordenados) {
    if (v.decision !== "aceptado" && v.decision !== "rechazado") continue;
    const balde = v.decision === "aceptado" ? positivos : negativos;
    if (balde.length >= maxPorClase) continue;
    balde.push({
      decision: v.decision,
      interno: v.interno,
      banco: v.banco,
      categoria: v.categoria,
      ...(v.decision === "rechazado" ? { motivo: v.motivo } : {}),
    });
  }

  // Intercalados, como `construirEjemplos`: que el orden no sesgue el prompt.
  const salida: EjemploAprendizaje[] = [];
  for (let i = 0; i < Math.max(positivos.length, negativos.length) && salida.length < maxTotal; i++) {
    if (i < positivos.length && salida.length < maxTotal) salida.push(positivos[i]!);
    if (i < negativos.length && salida.length < maxTotal) salida.push(negativos[i]!);
  }
  return salida;
}
