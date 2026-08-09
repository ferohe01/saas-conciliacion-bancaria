/**
 * Diagnóstico previo: revisar una conciliación ANTES de dispararla.
 *
 * La base cuenta (`diagnostico_previo`, migración 0037) y aquí se decide qué
 * significan esos números. Función pura y con tests: el mismo criterio vale
 * para la pantalla que lo pinta y para cualquier texto que lo explique.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Una conciliación de 450.999 movimientos terminó en **0 %** porque la columna
 * "Recibos" del extracto no se mapeó a *referencia*. Nada lo dijo hasta ver el
 * resultado, media hora después.
 *
 * El Paso 2 ya avisa de esa causa, y está bien, pero **avisar de una causa no
 * es lo mismo que medir su consecuencia**: "no mapeaste la referencia" se
 * despacha sin leer, y más cuando el propio aviso aclara —con razón— que se
 * puede conciliar igual. "Casarían 12 de 450.999 movimientos" no se despacha.
 *
 * ⚠️ Nada de esto BLOQUEA. Hay extractos que no traen referencia y para ellos el
 * respaldo por monto + fecha es legítimo; impedirlo sería cerrar un caso de uso
 * válido. Lo que sí hace un hallazgo crítico es **cambiar cuál es el botón
 * principal** (ver `debeRevisar`): no prohíbe, obliga a mirar.
 */

/** Contadores tal como los devuelve `diagnostico_previo`. */
export type ContadoresPrevios = {
  internos: number;
  internos_con_ref: number;
  internos_ref_repetida: number;
  movimientos: number;
  movimientos_con_ref: number;
  movimientos_ref_repetida: number;
  movimientos_abono: number;
  movimientos_cargo: number;
  movimientos_fuera: number;
  movimientos_dia_bajo: number;
  refs_compartidas: number;
  /**
   * Pares que casarían por monto + referencia.
   *
   * `null` cuando no se estimó por volumen — emparejar medio millón contra
   * medio millón se pasa del `statement_timeout`. No es un fallo y no se
   * disimula: la pantalla dice que no se estimó y por qué.
   */
  pares_estimados: number | null;
};

export type Severidad = "critico" | "aviso" | "info";

export type Hallazgo = {
  codigo: string;
  severidad: Severidad;
  titulo: string;
  detalle: string;
  /** Qué hacer, en pasos de esta pantalla. `null` si no hay nada que hacer. */
  accion: string | null;
};

/**
 * Por debajo de esta cobertura, el resultado va a ser malo y conviene mirar el
 * mapeo antes de gastar la corrida.
 *
 * 20 % está elegido contra el histórico real: junio completo de la recaudadora
 * dio 99,03 % y el corte de un solo día 88,44 %. Un umbral más alto convertiría
 * el aviso en ruido para quien concilia por día, y un aviso que sale siempre se
 * aprende a despachar sin leerlo.
 */
export const COBERTURA_MINIMA = 0.2;

/** Con menos movimientos que esto, las señales estadísticas no dicen nada. */
const MIN_PARA_ESTADISTICA = 20;

/** Cuántos movimientos fuera de período hacen sospechar del archivo. */
const FUERA_DE_PERIODO_PCT = 0.3;

const pct = (n: number) => `${Math.round(n * 100)} %`;
const num = (n: number) => n.toLocaleString("es-PE");

/**
 * Interpreta los contadores. Devuelve los hallazgos ordenados por gravedad;
 * lista vacía = todo en orden y nada que decir.
 *
 * `maxFilas` es el tope de partidas por lado (`MAX_FILAS_CONCILIACION`).
 */
export function evaluarDiagnostico(
  c: ContadoresPrevios,
  maxFilas: number,
): Hallazgo[] {
  const h: Hallazgo[] = [];

  // ── Lo que impide conciliar del todo ────────────────────────────────────
  if (c.internos === 0) {
    h.push({
      codigo: "sin_internos",
      severidad: "critico",
      titulo: "No hay comprobantes en este período",
      detalle:
        "No se encontró ningún comprobante pendiente entre las fechas elegidas. " +
        "Sin registros propios no hay contra qué conciliar el extracto.",
      accion: "Revisa el período, o carga tus comprobantes desde Comprobantes.",
    });
  }

  if (c.internos > maxFilas || c.movimientos > maxFilas) {
    const lado = c.internos > maxFilas ? "comprobantes" : "movimientos";
    const cuantos = Math.max(c.internos, c.movimientos);
    h.push({
      codigo: "volumen",
      severidad: "critico",
      titulo: "Demasiadas partidas para una sola corrida",
      detalle:
        `Hay ${num(cuantos)} ${lado} y el tope por corrida es ${num(maxFilas)}. ` +
        "La conciliación se rechazaría al iniciarla.",
      accion: "Concilia un rango de fechas más corto.",
    });
  }

  // ── La referencia: el dato del que depende el resultado ──────────────────
  const hayRefInternos = c.internos_con_ref > 0;
  const hayRefBanco = c.movimientos_con_ref > 0;

  if (c.movimientos > 0 && !hayRefBanco) {
    h.push({
      codigo: "sin_referencia_extracto",
      severidad: "critico",
      titulo: "El extracto no trae referencia",
      detalle:
        "Ninguno de los movimientos del banco tiene número de operación. " +
        "Es el dato con el que se empareja la mayoría: sin él, solo casará lo " +
        "que coincida en importe y fecha exacta.",
      accion:
        "Vuelve al Paso 2 y elige la columna de referencia / nº de operación. " +
        "Si tu extracto de verdad no la trae, puedes continuar.",
    });
  } else if (c.internos > 0 && !hayRefInternos) {
    h.push({
      codigo: "sin_referencia_internos",
      severidad: "aviso",
      titulo: "Tus comprobantes no traen referencia",
      detalle:
        "El extracto sí trae número de operación, pero tus comprobantes no. " +
        "El emparejamiento por código no puede usarse en un solo lado.",
      accion:
        "Al cargar comprobantes, completa la columna de referencia con el " +
        "código con el que aparecen en el banco.",
    });
  } else if (hayRefInternos && hayRefBanco && c.refs_compartidas === 0) {
    // El caso traicionero: las dos columnas están mapeadas y aun así no son el
    // mismo dato. Un recaudador numera sus recibos "SR11-02748951" mientras el
    // banco trae "00000001300486": ambos son referencias, ninguna casa.
    h.push({
      codigo: "referencias_incompatibles",
      severidad: "critico",
      titulo: "Las referencias no coinciden en ningún caso",
      detalle:
        `Tus comprobantes traen ${num(c.internos_con_ref)} referencias y el ` +
        `extracto ${num(c.movimientos_con_ref)}, pero no hay ni una sola en ` +
        "común. Probablemente son dos códigos distintos: el número de tu " +
        "documento por un lado y el de la operación bancaria por el otro.",
      accion:
        "Comprueba en el Paso 2 que la columna elegida sea la que el banco " +
        "comparte contigo.",
    });
  }

  // ── El número que decide: cuánto casaría ────────────────────────────────
  if (c.pares_estimados !== null && c.movimientos > 0) {
    const cobertura = c.pares_estimados / c.movimientos;
    if (cobertura < COBERTURA_MINIMA) {
      h.push({
        codigo: "cobertura_baja",
        severidad: "critico",
        titulo: `Con este mapeo casarían ${num(c.pares_estimados)} de ${num(c.movimientos)} movimientos`,
        detalle:
          `Es el ${pct(cobertura)}. El resto quedaría para las capas de ` +
          "monto y fecha, que son mucho menos certeras. Suele significar que " +
          "falta una columna o que la elegida no es la correcta.",
        accion: "Revisa el mapeo del Paso 2 antes de gastar la corrida.",
      });
    } else {
      h.push({
        codigo: "cobertura_alta",
        severidad: "info",
        titulo: `Casarían ${num(c.pares_estimados)} de ${num(c.movimientos)} movimientos (${pct(cobertura)})`,
        detalle:
          "Es lo que resolverá el emparejamiento por importe y referencia. " +
          "El resto pasa a las capas de tolerancia y de IA.",
        accion: null,
      });
    }
  } else if (c.movimientos > 0) {
    // Callarlo daría a entender que se comprobó y salió bien.
    h.push({
      codigo: "cobertura_no_estimada",
      severidad: "info",
      titulo: "No se estimó cuánto casará",
      detalle:
        `Son demasiadas partidas para calcularlo al vuelo. La señal ` +
        `disponible es que hay ${num(c.refs_compartidas)} referencias ` +
        "presentes en los dos lados.",
      accion: null,
    });
  }

  // ── Señales sobre la forma de los datos ──────────────────────────────────
  if (
    c.movimientos >= MIN_PARA_ESTADISTICA &&
    (c.movimientos_abono === 0 || c.movimientos_cargo === 0)
  ) {
    const soloEntradas = c.movimientos_cargo === 0;
    h.push({
      codigo: "un_solo_signo",
      severidad: "aviso",
      titulo: soloEntradas
        ? "Todos los movimientos son entradas"
        : "Todos los movimientos son salidas",
      detalle:
        `Los ${num(c.movimientos)} movimientos del extracto tienen el mismo ` +
        "signo. Puede ser correcto en una cuenta recaudadora, pero también " +
        "pasa cuando el archivo trae cargos y abonos en columnas separadas y " +
        "solo se mapeó una.",
      accion: "Si tu extracto tiene dos columnas de importe, revisa el Paso 2.",
    });
  }

  if (
    c.movimientos >= MIN_PARA_ESTADISTICA &&
    c.movimientos_dia_bajo === c.movimientos
  ) {
    h.push({
      codigo: "fechas_ambiguas",
      severidad: "aviso",
      titulo: "Ninguna fecha pasa del día 12",
      detalle:
        "En los movimientos del extracto no hay ningún día 13 o posterior. " +
        "Es la huella de una fecha leída al revés (mes por día), que " +
        "descoloca todo el emparejamiento por fecha sin dar ningún error.",
      accion: "Comprueba una fecha concreta en la vista previa del Paso 2.",
    });
  }

  if (
    c.movimientos > 0 &&
    c.movimientos_fuera / c.movimientos >= FUERA_DE_PERIODO_PCT
  ) {
    h.push({
      codigo: "fuera_de_periodo",
      severidad: "aviso",
      titulo: `${num(c.movimientos_fuera)} movimientos caen fuera del período`,
      detalle:
        `De ${num(c.movimientos)} movimientos del archivo, ` +
        `${num(c.movimientos_fuera)} tienen fecha fuera del rango elegido. ` +
        "Suele ser el extracto de otro mes.",
      accion: "Revisa el período o el archivo.",
    });
  }

  if (c.internos_ref_repetida > 0 || c.movimientos_ref_repetida > 0) {
    const cuantos = Math.max(c.internos_ref_repetida, c.movimientos_ref_repetida);
    h.push({
      codigo: "referencias_repetidas",
      severidad: "info",
      titulo: "Hay referencias que se repiten",
      detalle:
        `${num(cuantos)} partidas comparten su referencia con otra. Es normal ` +
        "cuando un cliente paga varios documentos en una sola operación: esos " +
        "casos los resuelve la capa de agrupación y llegan como sugerencias " +
        "para que los apruebes.",
      accion: null,
    });
  }

  const ORDEN: Record<Severidad, number> = { critico: 0, aviso: 1, info: 2 };
  return h.sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad]);
}

/**
 * ¿Conviene revisar el mapeo antes de conciliar?
 *
 * No impide nada: cambia cuál es el botón principal. Un usuario que sabe lo que
 * hace sigue teniendo "Conciliar de todas formas" a un clic.
 */
export function debeRevisar(hallazgos: Hallazgo[]): boolean {
  return hallazgos.some((x) => x.severidad === "critico");
}

/** Resumen de una línea, para cuando no cabe la lista entera. */
export function resumenDiagnostico(hallazgos: Hallazgo[]): string | null {
  const criticos = hallazgos.filter((x) => x.severidad === "critico").length;
  const avisos = hallazgos.filter((x) => x.severidad === "aviso").length;
  if (criticos === 0 && avisos === 0) return null;
  const partes: string[] = [];
  if (criticos > 0) {
    partes.push(criticos === 1 ? "1 problema" : `${criticos} problemas`);
  }
  if (avisos > 0) {
    partes.push(avisos === 1 ? "1 aviso" : `${avisos} avisos`);
  }
  return partes.join(" y ");
}
