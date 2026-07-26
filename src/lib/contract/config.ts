import { z } from "zod";
import { MontoNoNegativo, Confianza } from "./primitives";

/**
 * Configuración de tolerancias que viaja en cada request al webhook.
 * Va por request para permitir valores por empresa; en el MVP se usan los
 * defaults sensatos de abajo.
 */
export const ConfigConciliacion = z.object({
  // Tolerancia absoluta de diferencia de monto (en la moneda de la cuenta).
  tolerancia_monto_abs: MontoNoNegativo,
  // Tolerancia relativa de diferencia de monto, en porcentaje (0.5 = 0.5%).
  tolerancia_monto_pct: z.number().min(0).max(100),
  // Tolerancia de días entre la fecha interna y la bancaria.
  tolerancia_dias: z.number().int().min(0),
  // Umbral de confianza a partir del cual un match de IA llega como "auto".
  umbral_confianza_auto: Confianza,
  // Banda de diferencia de monto para SUGERIR con IA (más amplia que la difusa,
  // pero acotada). Solo se sugiere si |diferencia| <= este valor.
  tolerancia_ia_monto: MontoNoNegativo.default(10),
  // Cuántos candidatos (los mejores por score) se le presentan a la IA por cada
  // registro interno. Más candidatos = más recall pero más costo/tokens.
  top_k_candidatos: z.number().int().min(1).max(10).default(3),
});
export type ConfigConciliacion = z.infer<typeof ConfigConciliacion>;

export const CONFIG_CONCILIACION_DEFAULT: ConfigConciliacion = {
  tolerancia_monto_abs: 5.0,
  tolerancia_monto_pct: 0.5,
  tolerancia_dias: 3,
  umbral_confianza_auto: 0.95,
  tolerancia_ia_monto: 10.0,
  top_k_candidatos: 3,
};
