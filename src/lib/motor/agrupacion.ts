import type {
  MovimientoBancario,
  RegistroInterno,
} from "@/lib/contract/payload";
import { normRef } from "@/lib/normalizacion/referencia";
import { palabras } from "./texto";
import { MS_DIA, type ConfigMotor, type Etapa } from "./tipos";

/**
 * Capa 2.5: AGRUPACIÓN 1:N / N:1 (subset-sum).
 *
 * Un depósito bancario que agrupa varios pagos internos, o un pago dividido en
 * varios movimientos. Se acota fuerte para precisión: identidad compartida
 * OBLIGATORIA (referencia o ≥1 palabra del nombre), suma casi EXACTA, grupo
 * pequeño (≤ max_combinacion), en ventana de fecha. Se proponen como
 * SUGERENCIAS (`pendiente`) para revisión humana: nunca se auto-concilian.
 *
 * ⚠️ El prefiltro de identidad no es opcional: sin él, un subset-sum empareja
 * partidas sin relación cuya suma cuadra por azar y el resultado parece
 * correcto. Acepta REFERENCIA además de nombre porque en una cuenta
 * recaudadora los recibos llegan sin contraparte y lo que comparten los que se
 * pagaron juntos es el código de operación.
 */

type Item = {
  id: string;
  monto: number;
  ts: number;
  pal: Set<string>;
  ref: string;
  /** Posición original, para reproducir el orden de empate. */
  i: number;
};

type Grupo = {
  targetId: string;
  ids: string[];
  dif: number;
  n: number;
  porRef: boolean;
};

const diasTs = (a: number, b: number) => Math.abs((a - b) / MS_DIA);

function* combinaciones<T>(items: T[], maxT: number): Generator<T[]> {
  const n = items.length;
  function* rec(inicio: number, acc: T[]): Generator<T[]> {
    if (acc.length >= 2) yield acc.slice();
    if (acc.length >= maxT) return;
    for (let i = inicio; i < n; i++) {
      acc.push(items[i]!);
      yield* rec(i + 1, acc);
      acc.pop();
    }
  }
  yield* rec(0, []);
}

function agrupar(
  unos: Item[],
  muchos: Item[],
  tolSum: number,
  ventana: number,
  maxTam: number,
): Grupo[] {
  const usados = new Set<string>();
  const grupos: Grupo[] = [];

  // Índices del prefiltro: el candidato tiene que compartir la REFERENCIA o al
  // menos una palabra, así que se buscan en vez de recorrerlos todos. El
  // conjunto que sale es exactamente el que pasaba el filtro.
  const porRef = new Map<string, Item[]>();
  const porPalabra = new Map<string, Item[]>();
  const meter = (map: Map<string, Item[]>, k: string, m: Item) => {
    const lista = map.get(k);
    if (lista) lista.push(m);
    else map.set(k, [m]);
  };
  for (const m of muchos) {
    if (m.ref) meter(porRef, m.ref, m);
    for (const w of m.pal) meter(porPalabra, w, m);
  }

  for (const t of unos) {
    const vistos = new Set<number>();
    const posibles: Item[] = [];
    const juntar = (lista: Item[] | undefined) => {
      if (!lista) return;
      for (const m of lista) {
        if (vistos.has(m.i)) continue;
        vistos.add(m.i);
        posibles.push(m);
      }
    };
    if (t.ref) juntar(porRef.get(t.ref));
    for (const w of t.pal) juntar(porPalabra.get(w));

    const cands = posibles
      .filter(
        (m) =>
          !usados.has(m.id) &&
          Math.sign(m.monto) === Math.sign(t.monto) &&
          Math.abs(m.monto) <= Math.abs(t.monto) + tolSum &&
          diasTs(t.ts, m.ts) <= ventana,
      )
      // Por posición original primero: así el orden de empate es el mismo que
      // cuando se recorría la lista entera (el sort es estable).
      .sort((a, b) => a.i - b.i)
      .sort((a, b) => diasTs(t.ts, a.ts) - diasTs(t.ts, b.ts))
      .slice(0, 12);
    if (cands.length < 2) continue;

    let mejor: { combo: Item[]; dif: number } | null = null;
    for (const combo of combinaciones(cands, maxTam)) {
      const suma = combo.reduce((s, x) => s + x.monto, 0);
      if (Math.abs(suma - t.monto) > tolSum) continue;
      const dif = Number((suma - t.monto).toFixed(2));
      // Todos comparten identidad: preferir menos elementos y, a igualdad,
      // menor diferencia de monto.
      if (
        !mejor ||
        combo.length < mejor.combo.length ||
        (combo.length === mejor.combo.length && Math.abs(dif) < Math.abs(mejor.dif))
      ) {
        mejor = { combo, dif };
      }
    }
    if (!mejor) continue;
    grupos.push({
      targetId: t.id,
      ids: mejor.combo.map((x) => x.id),
      dif: mejor.dif,
      n: mejor.combo.length,
      porRef: Boolean(t.ref) && mejor.combo.every((x) => x.ref === t.ref),
    });
    for (const x of mejor.combo) usados.add(x.id);
  }
  return grupos;
}

// Tokens, timestamp y referencia se calculan UNA vez por partida: dentro del
// bucle eran 28 millones de `Date.parse` con 4.382 × 3.204 pendientes.
const itemInt = (r: RegistroInterno, i: number): Item => ({
  id: r.id_interno,
  monto: r.monto,
  ts: Date.parse(r.fecha),
  pal: new Set(palabras(r.contraparte ?? r.descripcion ?? null)),
  ref: normRef(r.referencia),
  i,
});
const itemBanc = (m: MovimientoBancario, i: number): Item => ({
  id: m.id_movimiento,
  monto: m.monto,
  ts: Date.parse(m.fecha),
  pal: new Set(palabras(m.glosa ?? null)),
  ref: normRef(m.referencia_banco),
  i,
});

export function capaAgrupacion(prev: Etapa, config: ConfigMotor): Etapa {
  const matches = [...prev.matches];
  const internos = prev.pendientesInternos;
  const bancarios = prev.pendientesBancarios;

  const tolSum = Math.min(Number(config.tolerancia_monto_abs ?? 5), 0.5);
  const ventana = Number(config.ventana_ia_dias ?? 30);
  const maxTam = Number(config.max_combinacion ?? 3);

  const usadoInt = new Set<string>();
  const usadoBanc = new Set<string>();

  // 1 banco : N internos
  for (const g of agrupar(
    bancarios.filter((m) => !usadoBanc.has(m.id_movimiento)).map(itemBanc),
    internos.filter((r) => !usadoInt.has(r.id_interno)).map(itemInt),
    tolSum,
    ventana,
    maxTam,
  )) {
    matches.push({
      ids_internos: g.ids,
      ids_movimientos: [g.targetId],
      metodo: "ia",
      confianza: null,
      diferencia_monto: g.dif,
      categoria_diferencia: "agrupacion_1aN",
      justificacion: `Agrupación: ${g.n} registros internos suman el depósito (dif. ${g.dif}).${g.porRef ? " Comparten el mismo código de operación." : ""}`,
      estado_revision: "pendiente",
    });
    usadoBanc.add(g.targetId);
    for (const id of g.ids) usadoInt.add(id);
  }

  // 1 interno : N bancos
  for (const g of agrupar(
    internos.filter((r) => !usadoInt.has(r.id_interno)).map(itemInt),
    bancarios.filter((m) => !usadoBanc.has(m.id_movimiento)).map(itemBanc),
    tolSum,
    ventana,
    maxTam,
  )) {
    matches.push({
      ids_internos: [g.targetId],
      ids_movimientos: g.ids,
      metodo: "ia",
      confianza: null,
      diferencia_monto: -g.dif,
      categoria_diferencia: "agrupacion_1aN",
      justificacion: `Agrupación: el pago se refleja en ${g.n} movimientos bancarios (dif. ${-g.dif}).${g.porRef ? " Comparten el mismo código de operación." : ""}`,
      estado_revision: "pendiente",
    });
    usadoInt.add(g.targetId);
    for (const id of g.ids) usadoBanc.add(id);
  }

  return {
    matches,
    pendientesInternos: internos.filter((r) => !usadoInt.has(r.id_interno)),
    pendientesBancarios: bancarios.filter((m) => !usadoBanc.has(m.id_movimiento)),
  };
}
