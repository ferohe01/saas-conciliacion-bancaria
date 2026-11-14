/**
 * Tokenizador de nombres del motor: MAYÚSCULAS sin acentos, palabras de ≥3
 * caracteres, sin términos bancarios genéricos.
 *
 * Lo usan la difusa, la agrupación y los candidatos de IA para exigir
 * identidad compartida (≥1 palabra en común). Vivía copiado en cuatro nodos de
 * n8n porque un nodo Code no puede importar nada; aquí hay una sola copia, así
 * que ya no hay forma de que las capas tokenicen distinto.
 */
const STOP = new Set([
  "DEPOSITO", "TRANSFERENCIA", "TRANSF", "TRANSFER", "RECIBIDA", "RECIBIDO",
  "ENVIADA", "ENVIADO", "PAGO", "PAGOS", "ABONO", "CARGO", "CUOTA",
  "REPETICION", "DEVOLUCION", "CCE", "INTERBANCARIA", "INTERBANCARIO",
  "OPERACION", "NRO", "REF", "REFERENCIA", "FACTURA", "BOLETA", "SAC", "EIRL",
  "SRL", "DEL", "LOS", "LAS", "POR", "CON",
  "EFECTIVO", "MENSUALIDAD", "MATRICULA", "PENSION", "INSCRIPCION",
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO",
  "SEPTIEMBRE", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
]);

export function palabras(texto: unknown): string[] {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Diferencia de dos importes redondeada a céntimos, como la escribía n8n. */
export function diferencia(a: number, b: number): number {
  return Number((a - b).toFixed(2));
}
