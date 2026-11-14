import type {
  MovimientoBancario,
  RegistroInterno,
} from "@/lib/contract/payload";
import type { Match } from "@/lib/contract/resultado";
import { normRef } from "@/lib/normalizacion/referencia";
import type { Etapa } from "./tipos";

/**
 * Capa 1: conciliación EXACTA sobre las partidas que recibe el motor.
 *
 * Match exacto = mismo monto + misma referencia; respaldo por mismo monto +
 * misma fecha. Signos ya normalizados por la app (cobranza/abono +,
 * pago/cargo −).
 *
 * En modo tabla el pass 1 ya corrió en SQL (`conciliar_exacta`, 0023) sobre las
 * tablas completas y aquí llega solo el residuo; el pass 2 —el respaldo por
 * monto + fecha— vive SOLO aquí a propósito: necesita la guarda de
 * contradicción de referencias y reescribirla en SQL sería duplicar el punto
 * exacto donde el motor se equivoca en silencio.
 */
export function capaExacta(
  internos: RegistroInterno[],
  bancarios: MovimientoBancario[],
): Etapa {
  const cents = (m: number) => Math.round(Number(m) * 100);

  const idxPorRef = new Map<string, number[]>();
  const idxPorFecha = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, k: string, v: number) => {
    const lista = map.get(k);
    if (lista) lista.push(v);
    else map.set(k, [v]);
  };
  bancarios.forEach((b, j) => {
    const c = cents(b.monto);
    const ref = normRef(b.referencia_banco);
    if (ref) push(idxPorRef, `${c}|${ref}`, j);
    push(idxPorFecha, `${c}|${b.fecha}`, j);
  });

  const bancUsado = new Set<number>();
  const intUsado = new Set<number>();
  const matches: Match[] = [];

  const tomarLibre = (
    lista: number[] | undefined,
    filtro?: (j: number) => boolean,
  ): number => {
    if (!lista) return -1;
    for (const j of lista) if (!bancUsado.has(j) && (!filtro || filtro(j))) return j;
    return -1;
  };
  const registrar = (i: number, j: number) => {
    intUsado.add(i);
    bancUsado.add(j);
    matches.push({
      ids_internos: [internos[i]!.id_interno],
      ids_movimientos: [bancarios[j]!.id_movimiento],
      metodo: "exacta",
      confianza: null,
      diferencia_monto: 0,
      categoria_diferencia: null,
      justificacion: null,
      estado_revision: "auto",
    });
  };

  // Pass 1: monto + referencia (ID de pago).
  internos.forEach((it, i) => {
    const ref = normRef(it.referencia);
    if (!ref) return;
    const j = tomarLibre(idxPorRef.get(`${cents(it.monto)}|${ref}`));
    if (j !== -1) registrar(i, j);
  });

  // Pass 2: monto + fecha.
  //
  // ⚠️ NUNCA contra una referencia que se contradice. Este respaldo existe para
  // datos SIN referencia (ventas al contado, extractos que no la traen). Cuando
  // los dos lados SÍ la traen y no coinciden, son operaciones distintas:
  // casarlas por monto+fecha es una lotería.
  //
  // A escala esto no es teórico. En una recaudadora de 20.000 movimientos hay
  // cientos de recibos de S/ 99 el mismo día: el pass 2 emparejó 541 pares con
  // códigos de operación que no tenían nada que ver, y los marcó `auto` — o
  // sea, conciliados sin que nadie los mirara. Peor aún, cada match falso se
  // lleva el movimiento que le tocaba al recibo legítimo, dejándolo huérfano:
  // el error se propaga y acaba inflando el descuadre del período.
  const compatiblePorRef = (i: number, j: number) => {
    const a = normRef(internos[i]!.referencia);
    const b = normRef(bancarios[j]!.referencia_banco);
    return !a || !b || a === b; // si a alguno le falta, no hay contradicción
  };

  internos.forEach((it, i) => {
    if (intUsado.has(i)) return;
    const j = tomarLibre(
      idxPorFecha.get(`${cents(it.monto)}|${it.fecha}`),
      (cand) => compatiblePorRef(i, cand),
    );
    if (j !== -1) registrar(i, j);
  });

  return {
    matches,
    pendientesInternos: internos.filter((_, i) => !intUsado.has(i)),
    pendientesBancarios: bancarios.filter((_, j) => !bancUsado.has(j)),
  };
}
