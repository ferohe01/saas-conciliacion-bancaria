import { z } from "zod";

/**
 * Enumeraciones canónicas compartidas por toda la app y el contrato con n8n.
 * Un único origen de verdad para literales que viajan en JSON y se guardan en BD.
 */

// Estado del job de conciliación (columna `estado` de jobs_conciliacion).
export const EstadoJob = z.enum([
  "pendiente",
  "procesando",
  "completado",
  "error",
]);
export type EstadoJob = z.infer<typeof EstadoJob>;

// Tipo de registro interno (comprobante / cobranza / pago).
export const TipoRegistroInterno = z.enum(["cobranza", "pago"]);
export type TipoRegistroInterno = z.infer<typeof TipoRegistroInterno>;

// Tipo de movimiento bancario según la convención de signos:
//   abono  → dinero que ENTRA  (monto positivo)
//   cargo  → dinero que SALE    (monto negativo)
export const TipoMovimientoBancario = z.enum(["abono", "cargo"]);
export type TipoMovimientoBancario = z.infer<typeof TipoMovimientoBancario>;

// Método por el que se logró un match.
export const MetodoMatch = z.enum(["exacta", "difusa", "ia"]);
export type MetodoMatch = z.infer<typeof MetodoMatch>;

// Estado de revisión humana de un match.
export const EstadoRevision = z.enum([
  "pendiente",
  "aceptado",
  "rechazado",
  "modificado",
  "auto",
]);
export type EstadoRevision = z.infer<typeof EstadoRevision>;

// Lado de una partida no conciliada.
export const LadoPartida = z.enum(["interno", "bancario"]);
export type LadoPartida = z.infer<typeof LadoPartida>;

// Categoría de una partida no conciliada.
export const CategoriaNoConciliado = z.enum([
  "diferencia_temporal",
  "ajuste_requerido",
  "requiere_investigacion",
]);
export type CategoriaNoConciliado = z.infer<typeof CategoriaNoConciliado>;
