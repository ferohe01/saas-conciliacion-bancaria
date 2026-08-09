/**
 * Topes del sistema que dependen del despliegue.
 *
 * Vive aparte porque lo consultan dos sitios que deben coincidir: el endpoint
 * que rechaza la conciliación (`/api/conciliacion/iniciar`) y el diagnóstico
 * previo del Paso 3, que avisa **antes** de que la rechace. Si cada uno tuviera
 * su número, el wizard diría que cabe algo que luego falla al iniciarse — y el
 * usuario habría subido y mapeado sus archivos para nada.
 */

/**
 * Máximo de partidas POR LADO en una conciliación.
 *
 * Es un techo, no un objetivo: el caso para el que está pensado el producto
 * —500 a 2.000 movimientos— no lo roza nunca.
 *
 * ⚠️ No se sube solo. Cada fila pesa ~194 bytes medidos, así que el payload son
 * `filas × 2 × 194`: 20.000 son 7,8 MB (caben en el defecto de n8n, 16 MB) y
 * 50.000 son 19,4 MB (NO caben: hay que subir también `N8N_PAYLOAD_SIZE_MAX`).
 * Por eso el valor por defecto es prudente y quien necesite más lo sube en los
 * dos sitios.
 */
export function maxFilasConciliacion(): number {
  return Math.max(
    1000,
    Math.min(200_000, Number(process.env.MAX_FILAS_CONCILIACION) || 20_000),
  );
}
