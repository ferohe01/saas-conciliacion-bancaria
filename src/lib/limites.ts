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
 * El motor corre dentro de la app, así que el tope protege la memoria del
 * servidor y el tamaño del `resultado` que se guarda en la fila del job. Ya no
 * va emparejado con el límite de payload de n8n, que dejó de existir; el valor
 * por defecto se conserva porque está medido, y se sube con
 * `MAX_FILAS_CONCILIACION`.
 */
export function maxFilasConciliacion(): number {
  return Math.max(
    1000,
    Math.min(200_000, Number(process.env.MAX_FILAS_CONCILIACION) || 20_000),
  );
}
