/**
 * SALDO VIVO — cuánto hay hoy, sin fingir que está conciliado.
 *
 * Fase 2 del módulo de caja (ver `docs/diseno-saldo-vivo.md`). La fase 1 dice
 * cuánto había al cierre del último período conciliado; a mitad de mes eso es
 * verdad y es viejo, y el desfase es **estructural**: aunque el cliente cierre
 * el día 3, del 4 al 31 la cifra vuelve a envejecer.
 *
 * ⚠️⚠️ **Lo provisional nunca se suma con lo probado, y nunca hereda su
 * aspecto.** Este módulo produce una cifra que NO está conciliada, y todo lo
 * que hay aquí existe para que no se confunda con la que sí lo está: lleva su
 * propia fecha, dice de dónde sale, caduca, y no alimenta el «disponible».
 *
 * SQL busca, TypeScript decide: `extracto_vigente()` (0051) devuelve hechos
 * consultables y la elección se hace aquí, que es lo que permite probarla.
 */

import { formatearFecha } from "@/lib/parsing/resumen";

/** Una fila de `extracto_vigente()`, en camelCase. */
export type ExtractoVigente = {
  cuentaId: string;
  loteId: string;
  fechaMin: string | null;
  fechaMax: string | null;
  filas: number;
  /** El saldo de la última fila del archivo. Lo declara el banco. */
  saldoDeclarado: number | null;
  subidoEn: string;
  /** Hasta dónde llega la última conciliación aprobada de la cuenta. */
  corteAprobado: string | null;
  /** Suma de los movimientos del lote POSTERIORES a ese corte. */
  sumaPosterior: number;
  movsPosteriores: number;
};

/**
 * Cuántos días puede tener un extracto y seguir presentándose como «hoy».
 *
 * ⚠️ Un saldo vivo rancio es PEOR que no tenerlo: ocupa el sitio de arriba y
 * hereda la confianza de estar ahí sin merecerla. Pasado el plazo no se
 * esconde —el dato sigue siendo cierto sobre su fecha— pero deja de anunciarse
 * como el saldo de hoy.
 */
export const DIAS_VIGENCIA = 10;

export type FuenteSaldo = "banco" | "calculado";

export type SaldoVivo = {
  cuentaId: string;
  saldo: number;
  /** La fecha a la que corresponde: la última del extracto. */
  fecha: string;
  fuente: FuenteSaldo;
  dias: number;
  /** Falso cuando el extracto ya no describe el presente. */
  vigente: boolean;
  /** Movimientos del extracto que todavía no se han conciliado. */
  porConciliar: number;
  /** saldo vivo − saldo probado. `null` si la cuenta no tiene aprobada. */
  diferencia: number | null;
  /**
   * El extracto empieza ANTES del último corte aprobado. Los días repetidos no
   * se suman —la guarda vive en la consulta— pero conviene decirlo.
   */
  solapa: boolean;
  loteId: string;
};

const MS_DIA = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

function diasEntre(iso: string, hoy: Date): number | null {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const h = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Math.max(0, Math.floor((h - t) / MS_DIA));
}

/**
 * Por qué una cuenta con extracto subido no produce saldo vivo. Se devuelve en
 * vez de un `null` mudo porque cada motivo lleva a una acción distinta, y la
 * pantalla tiene que poder decir cuál.
 */
export type SinSaldoVivo = {
  cuentaId: string;
  motivo: "no_supera_el_corte" | "sin_base" | "sin_fechas";
  fechaMax: string | null;
  corteAprobado: string | null;
};

export const esSaldoVivo = (x: SaldoVivo | SinSaldoVivo): x is SaldoVivo =>
  !("motivo" in x);

/**
 * El saldo vivo de una cuenta, o el motivo por el que no lo hay.
 *
 * Dos candidatos, y el orden no es arbitrario:
 *
 *   (a) el saldo que DECLARA EL BANCO en la última fila del extracto. Gana
 *       siempre que exista: no es un cálculo nuestro, así que no puede tener
 *       un error nuestro.
 *   (b) el último saldo aprobado + los movimientos posteriores. Derivado, y
 *       correcto solo gracias a la guarda de solape de `extracto_vigente()`.
 *
 * ⚠️ Sin ninguno de los dos NO se devuelve la suma del extracto: sumar
 * movimientos sin saber de qué saldo se parte da un flujo, no un saldo, y
 * enseñarlo como «lo que tienes» sería exactamente el número plausible y falso
 * que este producto existe para evitar.
 */
export function saldoVivo(
  e: ExtractoVigente,
  saldoAprobado: number | null,
  hoy: Date,
): SaldoVivo | SinSaldoVivo {
  const no = (motivo: SinSaldoVivo["motivo"]): SinSaldoVivo => ({
    cuentaId: e.cuentaId,
    motivo,
    fechaMax: e.fechaMax,
    corteAprobado: e.corteAprobado,
  });

  if (!e.fechaMax) return no("sin_fechas");
  const dias = diasEntre(e.fechaMax, hoy);
  if (dias == null) return no("sin_fechas");

  /**
   * ⚠️⚠️ UN EXTRACTO QUE NO PASA DEL ÚLTIMO CORTE APROBADO NO DICE NADA DE HOY.
   *
   * Y no es una sutileza: sin esta guarda el módulo produce su peor salida
   * posible. Al resubir el extracto de julio sobre julio ya conciliado no queda
   * ni un movimiento posterior, así que (b) devuelve el saldo aprobado **tal
   * cual** y la pantalla enseña «Saldo declarado 1.271.478,87 · Diferencia
   * 0,00» — que se lee como *«el banco confirma tu conciliación»* cuando la
   * cifra se copió de la propia conciliación. Una comprobación circular
   * disfrazada de corroboración independiente: exactamente el número plausible
   * y falso contra el que existe todo lo demás de este archivo.
   *
   * Con columna de saldo el número sí sería del banco, pero seguiría sin ser el
   * de hoy —es una verificación de un corte pasado, otra pregunta— así que el
   * corte se aplica igual y la pantalla pide el extracto del período siguiente.
   */
  if (e.corteAprobado != null && e.fechaMax <= e.corteAprobado) {
    return no("no_supera_el_corte");
  }

  let saldo: number;
  let fuente: FuenteSaldo;
  if (e.saldoDeclarado != null) {
    saldo = e.saldoDeclarado;
    fuente = "banco";
  } else if (saldoAprobado != null) {
    saldo = r2(saldoAprobado + e.sumaPosterior);
    fuente = "calculado";
  } else {
    return no("sin_base");
  }

  return {
    cuentaId: e.cuentaId,
    saldo: r2(saldo),
    fecha: e.fechaMax,
    fuente,
    dias,
    vigente: dias <= DIAS_VIGENCIA,
    porConciliar: e.movsPosteriores,
    diferencia: saldoAprobado == null ? null : r2(saldo - saldoAprobado),
    solapa:
      e.corteAprobado != null && e.fechaMin != null && e.fechaMin <= e.corteAprobado,
    loteId: e.loteId,
  };
}

/** El saldo vivo agregado de un bloque de moneda. */
export type BloqueVivo = {
  /**
   * ⚠️ `null` mientras NO todas las cuentas del bloque tengan extracto
   * vigente. Un total al que le falta una cuenta saldría más bajo que el
   * probado y parecería que el dinero desapareció — y nadie tendría cómo
   * notarlo, porque la cifra es perfectamente creíble.
   */
  saldo: number | null;
  /** La fecha más ANTIGUA de las que componen el total: manda la peor. */
  fecha: string | null;
  cubiertas: number;
  cuentas: number;
  porConciliar: number;
  diferencia: number | null;
  vigente: boolean;
  /** El detalle por cuenta, que sí se enseña siempre. */
  detalle: SaldoVivo[];
};

/**
 * Agrega los saldos vivos de las cuentas de una misma moneda.
 *
 * `cuentasDelBloque` son las que aportan saldo probado: son las que tienen que
 * estar cubiertas para que el total signifique algo.
 */
export function consolidarVivo(
  cuentasDelBloque: readonly string[],
  vivos: readonly SaldoVivo[],
): BloqueVivo {
  const suyos = vivos.filter((v) => cuentasDelBloque.includes(v.cuentaId));
  const completo = cuentasDelBloque.length > 0 && suyos.length === cuentasDelBloque.length;

  const fechas = suyos.map((v) => v.fecha).sort();
  const conDiferencia = suyos.filter((v) => v.diferencia != null);

  return {
    saldo: completo ? r2(suyos.reduce((s, v) => s + v.saldo, 0)) : null,
    fecha: completo ? (fechas[0] ?? null) : null,
    cubiertas: suyos.length,
    cuentas: cuentasDelBloque.length,
    porConciliar: suyos.reduce((s, v) => s + v.porConciliar, 0),
    diferencia:
      completo && conDiferencia.length === suyos.length && suyos.length > 0
        ? r2(conDiferencia.reduce((s, v) => s + (v.diferencia ?? 0), 0))
        : null,
    // Basta con que uno haya caducado para que el conjunto no sea «hoy».
    vigente: suyos.length > 0 && suyos.every((v) => v.vigente),
  detalle: suyos,
  };
}

/**
 * Cómo se titula el bloque y su cifra.
 *
 * ⚠️ **El rótulo tiene que seguir a la FUENTE.** La primera versión decía
 * siempre «Según el banco · Saldo declarado» y debajo, en letra pequeña,
 * «calculado sobre tu última conciliación»: el titular afirmaba una cosa y el
 * detalle otra. Quien lee el titular se queda con que el banco lo dijo — y no
 * lo dijo.
 */
export function rotulos(detalle: readonly SaldoVivo[]): {
  titulo: string;
  cifra: string;
  /** La frase de abajo. También tiene que seguir a la fuente — ver ⚠️ abajo. */
  nota: string;
} {
  const todosDelBanco = detalle.length > 0 && detalle.every((v) => v.fuente === "banco");
  return todosDelBanco
    ? {
        titulo: "~ Según el banco, sin conciliar",
        cifra: "Saldo declarado por el banco",
        nota: "Esta cifra no está conciliada: es el saldo que declara tu extracto.",
      }
    : {
        titulo: "~ Estimado a hoy, sin conciliar",
        cifra: "Saldo estimado",
        // ⚠️ La primera versión decía «es lo que dice el banco» SIEMPRE, dos
        // líneas debajo de «calculado sobre tu última conciliación». Es el mismo
        // fallo que el titular tenía y se corrigió: una frase que atribuye al
        // banco un número que el banco no dio, contradiciendo al detalle que
        // tiene al lado.
        nota:
          "Esta cifra no está conciliada y el banco no la declara: se estima sumando los movimientos del extracto sobre tu última conciliación aprobada.",
      };
}

/** Qué se dice cuando hay extracto subido pero no produce saldo vivo. */
export function frasePorLaQueNoHay(s: SinSaldoVivo): string {
  switch (s.motivo) {
    case "no_supera_el_corte":
      return `El extracto que subiste llega al ${formatearFecha(s.fechaMax ?? "")}, que es justo hasta donde alcanza tu última conciliación aprobada. No añade nada sobre hoy: sube el del período siguiente.`;
    case "sin_base":
      return "Este extracto no trae columna de saldo y la cuenta no tiene ninguna conciliación aprobada de la que partir, así que no se puede afirmar un saldo. Concilia un período primero.";
    case "sin_fechas":
      return "No se pudieron leer las fechas del extracto subido.";
  }
}

/** Cómo se rotula la fecha de un saldo vivo. Nunca «hoy» a secas. */
export function etiquetaVivo(v: { fecha: string; dias: number; vigente: boolean }): string {
  const f = formatearFecha(v.fecha);
  if (v.vigente) {
    return v.dias === 0
      ? `Al ${f} · extracto de hoy, sin conciliar`
      : `Al ${f} · extracto subido, sin conciliar`;
  }
  return `Al ${f} · hace ${v.dias} días, ya no es el saldo de hoy`;
}
