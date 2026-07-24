"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";
import { FechaISO } from "@/lib/contract/primitives";

/**
 * Importación de comprobantes desde la plantilla Excel (§6.4). El cliente ya
 * parseó y normalizó las filas; aquí se validan e insertan en `comprobantes`
 * con origen 'plantilla'. RLS garantiza el aislamiento por empresa.
 */

const ComprobanteImport = z.object({
  fecha: FechaISO,
  monto: z.number().finite(),
  tipo: z.enum(["cobranza", "pago"]),
  referencia: z.string().trim().optional().nullable(),
  ruc_contraparte: z.string().trim().optional().nullable(),
  razon_social: z.string().trim().optional().nullable(),
  descripcion: z.string().trim().optional().nullable(),
});

const ImportPayload = z.array(ComprobanteImport).min(1).max(5000);

export type ImportResultado = {
  ok: boolean;
  insertados?: number;
  error?: string;
};

export async function importarComprobantes(
  filas: unknown,
): Promise<ImportResultado> {
  const parsed = ImportPayload.safeParse(filas);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Hay filas con datos inválidos en la plantilla.",
    };
  }

  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };

  const supabase = await createClient();
  const registros = parsed.data.map((c) => ({
    empresa_id: empresa.empresa_id,
    fecha: c.fecha,
    monto: c.monto,
    tipo: c.tipo,
    serie_numero: c.referencia ?? null,
    ruc_contraparte: c.ruc_contraparte ?? null,
    razon_social_contraparte: c.razon_social ?? null,
    descripcion: c.descripcion ?? null,
    origen: "plantilla" as const,
  }));

  const { error } = await supabase.from("comprobantes").insert(registros);
  if (error) {
    return { ok: false, error: "No se pudieron guardar los comprobantes." };
  }

  return { ok: true, insertados: registros.length };
}
