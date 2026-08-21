/**
 * Por qué no entran todos los comprobantes cargados — la cuenta del Paso 1.
 *
 * ⚠️⚠️ Existe por un fallo concreto: la tarjeta decía «el resto es de otros
 * períodos» siempre que sobrara alguno, sin haberlo contado. Con el juego de
 * junio —236 cargados, 233 entran— los 3 que faltaban eran facturas en dólares
 * fechadas el 03, el 15 y el 24 de junio: ni una fuera del período. La pantalla
 * afirmaba dos cosas incompatibles sobre las mismas tres filas, y la primera
 * era inventada.
 *
 * Mismo criterio que `origenPartidas` (0043): **cada exclusión se nombra por su
 * causa real y la cuenta CIERRA siempre**. Cuando las causas conocidas no suman
 * lo que tienen que sumar, aparece una línea «sin explicar» con el resto en vez
 * de repartirlo — una explicación que no cuadra es peor que ninguna, porque
 * convierte una duda concreta en desconfianza general.
 */

export type ConteosPeriodo = {
  /** Los que entran a conciliar. */
  registros: number;
  /** Todo lo cargado en la empresa, sin filtrar por período. */
  totalCargados: number;
  yaCobrados: number;
  otrasMonedas: number;
  /** Puede faltar si la migración 0053 no está aplicada todavía. */
  fueraPeriodo?: number;
  anulados?: number;
  /**
   * De los `registros`, cuántos vienen de meses anteriores por seguir
   * pendientes (0054). NO es una exclusión —está dentro de `registros`— así que
   * no entra en la cuenta que tiene que cerrar. Puede faltar si el despliegue
   * va por delante de la migración, y entonces es que no hay arrastre.
   */
  arrastrados?: number;
};

export type Exclusion = {
  clave: "fuera_periodo" | "ya_cobrados" | "otras_monedas" | "anulados" | "sin_explicar";
  cantidad: number;
  /** La frase completa, ya en plural o singular. */
  texto: string;
};

const plural = (n: number, uno: string, varios: string) =>
  `${n.toLocaleString("es-PE")} ${n === 1 ? uno : varios}`;

/**
 * Las exclusiones, cada una con su causa, ordenadas de más a menos frecuente.
 *
 * Devuelve `[]` cuando entran todos: entonces no hay nada que explicar y la
 * tarjeta no pinta ninguna línea.
 */
export function exclusionesDelPeriodo(
  c: ConteosPeriodo,
  moneda: string,
): Exclusion[] {
  const sobran = c.totalCargados - c.registros;
  if (sobran <= 0) return [];

  const fuera = c.fueraPeriodo ?? 0;
  const anulados = c.anulados ?? 0;

  const out: Exclusion[] = [];

  if (fuera > 0) {
    out.push({
      clave: "fuera_periodo",
      cantidad: fuera,
      texto: `${plural(fuera, "es de otro período", "son de otros períodos")} y no entran.`,
    });
  }
  if (c.yaCobrados > 0) {
    out.push({
      clave: "ya_cobrados",
      cantidad: c.yaCobrados,
      // Callarlo haría pensar que faltan facturas.
      texto: `${plural(c.yaCobrados, "ya está cobrado", "ya están cobrados")} y no entra${c.yaCobrados === 1 ? "" : "n"}: se conciliaron antes.`,
    });
  }
  if (c.otrasMonedas > 0) {
    out.push({
      clave: "otras_monedas",
      cantidad: c.otrasMonedas,
      // Un comprobante en dólares no se concilia contra una cuenta en soles
      // porque no hay conversión (0041).
      texto: `${plural(c.otrasMonedas, "está en otra moneda", "están en otra moneda")} y no entra${c.otrasMonedas === 1 ? "" : "n"}: esta cuenta es en ${moneda}.`,
    });
  }
  if (anulados > 0) {
    out.push({
      clave: "anulados",
      cantidad: anulados,
      texto: `${plural(anulados, "está anulado", "están anulados")}.`,
    });
  }

  const explicados = out.reduce((s, e) => s + e.cantidad, 0);
  const resto = sobran - explicados;
  if (resto > 0) {
    // ⚠️ NO se reparte entre las causas conocidas. Si sobra, se dice.
    out.push({
      clave: "sin_explicar",
      cantidad: resto,
      texto: `${plural(resto, "queda", "quedan")} sin explicar.`,
    });
  }

  return out;
}

/**
 * La frase de cabecera: cuántos hay en total.
 *
 * Se enseña solo cuando hay exclusiones; con todos dentro, decir «tienes 233 en
 * total» al lado de «233 registros» es ruido.
 */
export function fraseTotal(c: ConteosPeriodo): string | null {
  if (c.totalCargados <= c.registros) return null;
  return `Tienes ${c.totalCargados.toLocaleString("es-PE")} cargados en total:`;
}

/**
 * El desglose de los que SÍ entran: cuántos son de este período y cuántos
 * vienen arrastrados de meses anteriores.
 *
 * ⚠️ Existe porque el arrastre (0054) cambia un número que el usuario ya sabía
 * reconocer. Su archivo de julio tiene 233 facturas y la tarjeta pasa a decir
 * 281: sin esta línea, lo primero que piensa es que el sistema duplicó algo, y
 * la reacción natural —volver a cargar, o «empezar de cero»— es la peor
 * posible. Mismo criterio que las exclusiones: cada partida nombrada por lo que
 * es.
 *
 * Devuelve `null` cuando no se arrastró nada, que es el caso de una empresa que
 * cobra al contado y el de la primera conciliación de cualquiera. Un desglose
 * de «233 de este período · 0 arrastrados» es ruido.
 */
export function desgloseDeRegistros(c: ConteosPeriodo): string | null {
  const arrastrados = c.arrastrados ?? 0;
  if (arrastrados <= 0) return null;

  const propios = Math.max(0, c.registros - arrastrados);
  return (
    `${propios.toLocaleString("es-PE")} emitidos en este período · ` +
    `${arrastrados.toLocaleString("es-PE")} ${
      arrastrados === 1 ? "pendiente" : "pendientes"
    } de meses anteriores`
  );
}
