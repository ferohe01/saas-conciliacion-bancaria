import { z } from "zod";
import { FechaISO, Monto } from "./primitives";
import { TipoRegistroInterno, TipoMovimientoBancario } from "./enums";
import { ConfigConciliacion } from "./config";

/**
 * Contrato de ENTRADA: el JSON normalizado que el backend envía al webhook de
 * n8n (§7.2). El frontend hace el parsing/mapeo de archivos; lo que el usuario
 * confirma en pantalla es exactamente lo que se valida aquí y se envía.
 * Nunca viajan archivos crudos — solo estos datos canónicos.
 */

// job_id generado por el backend. Formato "rec-YYYY-MM-xxxx".
export const JobId = z
  .string()
  .regex(
    /^rec-\d{4}-\d{2}-[a-z0-9]{4,}$/,
    "job_id inválido (esperado rec-YYYY-MM-xxxx)",
  );
export type JobId = z.infer<typeof JobId>;

export const Periodo = z
  .object({
    desde: FechaISO,
    hasta: FechaISO,
  })
  .refine((p) => p.desde <= p.hasta, {
    message: "El inicio del período no puede ser posterior al fin",
    path: ["hasta"],
  });

export const CuentaMeta = z.object({
  banco: z.string().min(1),
  numero: z.string().min(1), // enmascarado, ej. "****4521"
  moneda: z.string().min(1).default("PEN"),
});

export const Saldos = z.object({
  saldo_extracto_inicial: Monto.nullable().optional(),
  saldo_extracto_final: Monto.nullable().optional(),
  saldo_libros_final: Monto,
});

export const PayloadMetadata = z.object({
  empresa_id: z.string().min(1),
  usuario_id: z.string().min(1),
  periodo: Periodo,
  cuenta: CuentaMeta,
  saldos: Saldos,
  callback_url: z.string().url(),
});

export const RegistroInterno = z.object({
  id_interno: z.string().min(1),
  fecha: FechaISO,
  monto: Monto,
  tipo: TipoRegistroInterno,
  referencia: z.string().nullable().optional(),
  contraparte: z.string().nullable().optional(),
  descripcion: z.string().nullable().optional(),
});
export type RegistroInterno = z.infer<typeof RegistroInterno>;

export const MovimientoBancario = z.object({
  id_movimiento: z.string().min(1),
  fecha: FechaISO,
  monto: Monto,
  tipo: TipoMovimientoBancario,
  glosa: z.string().nullable().optional(),
  referencia_banco: z.string().nullable().optional(),
});
export type MovimientoBancario = z.infer<typeof MovimientoBancario>;

/**
 * Ejemplo de aprendizaje (few-shot dinámico): una decisión humana confirmada de
 * conciliaciones anteriores, resumida en texto. El backend los extrae de los
 * `resultado.matches[].decisiones` ya persistidos y los adjunta al payload para
 * que el LLM calibre su criterio con el historial real de la empresa. Los
 * nombres cambian entre períodos; lo transferible es el PATRÓN (cuánto difieren
 * monto/fecha/nombre y qué decidió la persona).
 */
export const EjemploAprendizaje = z.object({
  decision: z.enum(["aceptado", "rechazado"]),
  interno: z.string().min(1),
  banco: z.string().min(1),
  categoria: z.string().nullable().optional(),
});
export type EjemploAprendizaje = z.infer<typeof EjemploAprendizaje>;

/** Valida que los IDs de una colección sean únicos. */
function idsUnicos<T>(items: T[], getId: (item: T) => string): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

export const PayloadConciliacion = z
  .object({
    job_id: JobId,
    metadata: PayloadMetadata,
    config: ConfigConciliacion,
    registros_internos: z.array(RegistroInterno).min(1),
    movimientos_bancarios: z.array(MovimientoBancario).min(1),
    ejemplos_aprendizaje: z.array(EjemploAprendizaje).max(20).optional(),
  })
  .superRefine((p, ctx) => {
    if (!idsUnicos(p.registros_internos, (r) => r.id_interno)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hay id_interno duplicados en registros_internos",
        path: ["registros_internos"],
      });
    }
    if (!idsUnicos(p.movimientos_bancarios, (m) => m.id_movimiento)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hay id_movimiento duplicados en movimientos_bancarios",
        path: ["movimientos_bancarios"],
      });
    }
  });
export type PayloadConciliacion = z.infer<typeof PayloadConciliacion>;

/**
 * Respuesta inmediata esperada de n8n al aceptar el job (modo "Respond
 * Immediately"). El backend compara estos conteos contra lo enviado.
 */
export const RespuestaAceptacion = z.object({
  status: z.literal("accepted"),
  job_id: JobId,
  registros_recibidos: z.number().int().nonnegative(),
  movimientos_recibidos: z.number().int().nonnegative(),
});
export type RespuestaAceptacion = z.infer<typeof RespuestaAceptacion>;
