import { z } from "zod";

/**
 * Primitivas de validación reutilizables para el contrato canónico.
 * Todo dato que viaja a n8n o se persiste usa estas reglas.
 */

// Fecha en formato ISO 8601 (YYYY-MM-DD). El almacenamiento y el transporte
// siempre usan ISO; el formato dd/mm/yyyy es solo de presentación.
export const FechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe estar en formato ISO YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Fecha inválida");
export type FechaISO = z.infer<typeof FechaISO>;

// Monto decimal. Se transporta como número (no string con formato). El signo
// sigue la convención global: entradas positivas, salidas negativas.
export const Monto = z
  .number()
  .finite("El monto debe ser un número finito")
  .refine(
    (n) => Number.isInteger(Math.round(n * 100)) || true,
    "Monto inválido",
  );
export type Monto = z.infer<typeof Monto>;

// Monto estrictamente no negativo (p. ej. saldos, tolerancias).
export const MontoNoNegativo = Monto.refine(
  (n) => n >= 0,
  "El monto no puede ser negativo",
);

// Score de confianza de la IA en [0, 1].
export const Confianza = z
  .number()
  .min(0, "La confianza no puede ser menor que 0")
  .max(1, "La confianza no puede ser mayor que 1");
export type Confianza = z.infer<typeof Confianza>;
