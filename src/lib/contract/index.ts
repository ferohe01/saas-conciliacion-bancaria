/**
 * Contrato compartido entre frontend, backend y n8n.
 *
 * - `payload.ts`   → JSON que el backend envía al webhook (§7.2).
 * - `resultado.ts` → estructura de `resultado` que escribe n8n (§7.3).
 * - `config.ts`    → tolerancias por request + defaults.
 * - `enums.ts`     → literales canónicos (estados, métodos, tipos).
 * - `primitives.ts`→ validadores reutilizables (fecha ISO, monto, confianza).
 *
 * Toda validación de I/O del contrato pasa por estos esquemas zod. Ni el
 * frontend ni n8n deben redefinir estas formas por su cuenta.
 */
export * from "./enums";
export * from "./primitives";
export * from "./config";
export * from "./payload";
export * from "./resultado";
