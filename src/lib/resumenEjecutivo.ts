/**
 * Las cifras que mira quien decide.
 *
 * No es "otro reporte". Los reportes responden *cómo fue la conciliación*;
 * esto responde *cómo está la empresa*, que es otra pregunta y la hace otra
 * persona: quien tiene que decidir si puede pagar la planilla, a quién reclamar
 * y si puede fiarse de sus propios saldos.
 *
 * ⚠️ DOS RELOJES. Lo conciliado pertenece a un período; lo que te deben es una
 * foto de HOY. Un "por cobrar de junio" no significa nada —o son las facturas
 * emitidas en junio, que quizá ya se cobraron, o el saldo vivo, que no es de
 * junio— así que van separados y la pantalla lo dice.
 */

export type ResumenEjecutivo = {
  /** Del período elegido. */
  periodo: {
    conciliaciones: number;
    sinAprobar: number;
    partidas: number;
    partidasConciliadas: number;
    cobrado: number;
    pagado: number;
    /** Lo que quedó sin explicar en los cuadres. */
    diferenciaCuadre: number;
  };
  /** Foto de hoy, sin período. */
  hoy: {
    porCobrar: number;
    porCobrarVencido: number;
    porCobrarDocs: number;
    porPagar: number;
    porPagarVencido: number;
    porPagarDocs: number;
  };
};

/**
 * Porcentaje de partidas que el sistema emparejó solo.
 *
 * `null` cuando no hubo partidas: 0% diría "no automatizó nada" sobre un
 * período en el que no había nada que automatizar.
 */
export function porcentajeAutomatizado(p: ResumenEjecutivo["periodo"]): number | null {
  if (p.partidas === 0) return null;
  return Math.round((p.partidasConciliadas / p.partidas) * 100);
}

/**
 * Posición neta: lo que te deben menos lo que debes.
 *
 * ⚠️ Se presenta SIEMPRE junto a los dos lados, nunca sola. El aging nunca los
 * mezcla —«sumar lo que te deben con lo que debes da un número que no responde
 * a ninguna pregunta»— y ahí es cierto, porque se gestionan distinto. Aquí la
 * pregunta sí existe y es de dirección: *si todo se cobra y todo se paga, ¿me
 * queda a favor o en contra?*. Lo que no puede es sustituir a los dos lados,
 * porque no dice nada del CALENDARIO: cobrar en 90 días y pagar en 30 da neto
 * positivo y aun así te quedas sin caja.
 */
export function posicionNeta(h: ResumenEjecutivo["hoy"]): number {
  return h.porCobrar - h.porPagar;
}
