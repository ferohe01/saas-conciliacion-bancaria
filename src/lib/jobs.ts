import { randomBytes } from "node:crypto";

/**
 * Genera un job_id de trazabilidad con el formato del contrato:
 *   rec-YYYY-MM-xxxx   (YYYY-MM tomado del inicio del período)
 * El sufijo aleatorio evita colisiones.
 */
export function generarJobId(periodoDesde: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(periodoDesde);
  const anioMes = m ? `${m[1]}-${m[2]}` : "0000-00";
  const sufijo = randomBytes(3).toString("hex"); // 6 hex chars
  return `rec-${anioMes}-${sufijo}`;
}
