import type { EjemploAprendizaje } from "@/lib/contract/payload";

/**
 * Few-shot dinámico: convierte las decisiones humanas persistidas en jobs
 * anteriores en ejemplos compactos para el prompt de la IA. Función PURA (se
 * testea sin BD); el backend le pasa los jobs completados de la empresa.
 *
 * Señal de aprendizaje = cada match que una persona TOCÓ:
 *   - aceptado / modificado / creado manualmente → ejemplo POSITIVO
 *   - rechazado                                   → ejemplo NEGATIVO
 * Los match automáticos (exacta/auto) se ignoran: no aportan criterio.
 * Se balancea por clase y se limita el total para no inflar el prompt.
 */

type RegLite = {
  id_interno: string;
  fecha: string;
  monto: number;
  contraparte?: string | null;
  descripcion?: string | null;
};
type MovLite = {
  id_movimiento: string;
  fecha: string;
  monto: number;
  glosa?: string | null;
};
type DecisionLite = { accion?: string; timestamp?: string };
type MatchLite = {
  ids_internos?: string[];
  ids_movimientos?: string[];
  metodo?: string;
  categoria_diferencia?: string | null;
  estado_revision?: string;
  decisiones?: DecisionLite[];
};

export type JobHistorico = {
  payload_entrada?: {
    registros_internos?: RegLite[];
    movimientos_bancarios?: MovLite[];
  } | null;
  resultado?: { matches?: MatchLite[] } | null;
};

export type OpcionesEjemplos = {
  maxPorClase?: number;
  maxTotal?: number;
};

export type ResumenAprendizaje = {
  positivos: number; // decisiones aceptadas/modificadas/manuales (materia prima)
  negativos: number; // decisiones rechazadas
  total: number; // pool completo acumulado
  activos: number; // cuántas alimentan cada corrida (balanceadas, con tope)
};

const MAX_POR_CLASE = 6;
const MAX_TOTAL = 12;
const NOMBRE_MAX = 48;

/** Clase de decisión humana de un match, o null si no fue tocado por nadie. */
function claseDeMatch(m: MatchLite): "aceptado" | "rechazado" | null {
  const ultima = m.decisiones?.[m.decisiones.length - 1]?.accion;
  const estado = ultima ?? m.estado_revision;
  if (estado === "rechazado") return "rechazado";
  if (estado === "aceptado" || estado === "modificado") return "aceptado";
  // Match creado a mano en la revisión: es una conciliación que una persona
  // afirmó explícitamente, aunque no tenga historial de decisiones.
  if (m.metodo === "manual") return "aceptado";
  return null;
}

const recorta = (s: string) =>
  s.length > NOMBRE_MAX ? s.slice(0, NOMBRE_MAX - 1) + "…" : s;

const resumenInterno = (r: RegLite): string =>
  `${r.monto.toFixed(2)} · ${recorta((r.contraparte ?? r.descripcion ?? "").trim())} · ${r.fecha}`;

const resumenBanco = (m: MovLite): string =>
  `${m.monto.toFixed(2)} · ${recorta((m.glosa ?? "").trim())} · ${m.fecha}`;

/**
 * Construye ejemplos few-shot a partir de jobs completados. Se espera que los
 * jobs vengan del más reciente al más antiguo (así los ejemplos recientes tienen
 * prioridad). Devuelve como máximo `maxTotal`, balanceando ambas clases.
 */
export function construirEjemplos(
  jobs: JobHistorico[],
  opts: OpcionesEjemplos = {},
): EjemploAprendizaje[] {
  const maxPorClase = opts.maxPorClase ?? MAX_POR_CLASE;
  const maxTotal = opts.maxTotal ?? MAX_TOTAL;

  const positivos: EjemploAprendizaje[] = [];
  const negativos: EjemploAprendizaje[] = [];
  const vistos = new Set<string>();

  for (const job of jobs) {
    const regs = job.payload_entrada?.registros_internos ?? [];
    const movs = job.payload_entrada?.movimientos_bancarios ?? [];
    const matches = job.resultado?.matches ?? [];
    if (!matches.length) continue;

    const regPorId = new Map(regs.map((r) => [r.id_interno, r]));
    const movPorId = new Map(movs.map((m) => [m.id_movimiento, m]));

    for (const m of matches) {
      const clase = claseDeMatch(m);
      if (!clase) continue;

      const idsInt = m.ids_internos ?? [];
      const idsMov = m.ids_movimientos ?? [];
      if (!idsInt.length || !idsMov.length) continue;

      const internosTxt = idsInt
        .map((id) => regPorId.get(id))
        .filter((r): r is RegLite => Boolean(r))
        .map(resumenInterno);
      const bancosTxt = idsMov
        .map((id) => movPorId.get(id))
        .filter((m2): m2 is MovLite => Boolean(m2))
        .map(resumenBanco);
      if (!internosTxt.length || !bancosTxt.length) continue;

      const interno = internosTxt.join(" + ");
      const banco = bancosTxt.join(" + ");
      const clave = `${clase}|${interno}|${banco}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);

      const ejemplo: EjemploAprendizaje = {
        decision: clase,
        interno,
        banco,
        categoria: m.categoria_diferencia ?? null,
      };
      const balde = clase === "aceptado" ? positivos : negativos;
      if (balde.length < maxPorClase) balde.push(ejemplo);
    }

    if (positivos.length >= maxPorClase && negativos.length >= maxPorClase) break;
  }

  // Intercala clases para que el prompt no quede sesgado por orden.
  const salida: EjemploAprendizaje[] = [];
  const n = Math.max(positivos.length, negativos.length);
  for (let i = 0; i < n && salida.length < maxTotal; i++) {
    if (i < positivos.length && salida.length < maxTotal) salida.push(positivos[i]!);
    if (i < negativos.length && salida.length < maxTotal) salida.push(negativos[i]!);
  }
  return salida;
}

/**
 * Cuenta el pool completo de decisiones humanas y cuántas alimentarían cada
 * corrida (las mismas reglas que `construirEjemplos`, pero solo métricas: no
 * necesita `payload_entrada`). Para el panel de "aprendizaje" en /reportes.
 */
export function resumenAprendizaje(
  jobs: Pick<JobHistorico, "resultado">[],
  opts: OpcionesEjemplos = {},
): ResumenAprendizaje {
  const maxPorClase = opts.maxPorClase ?? MAX_POR_CLASE;
  const maxTotal = opts.maxTotal ?? MAX_TOTAL;
  let positivos = 0;
  let negativos = 0;
  for (const job of jobs) {
    for (const m of job.resultado?.matches ?? []) {
      const idsInt = m.ids_internos ?? [];
      const idsMov = m.ids_movimientos ?? [];
      if (!idsInt.length || !idsMov.length) continue;
      const clase = claseDeMatch(m);
      if (clase === "aceptado") positivos++;
      else if (clase === "rechazado") negativos++;
    }
  }
  const activos = Math.min(
    Math.min(positivos, maxPorClase) + Math.min(negativos, maxPorClase),
    maxTotal,
  );
  return { positivos, negativos, total: positivos + negativos, activos };
}
