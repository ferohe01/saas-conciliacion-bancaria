"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";
import { FechaISO } from "@/lib/contract/primitives";
import type { MapeoColumnas } from "@/lib/parsing/deteccion";
import type { RegistroInterno } from "@/lib/contract/payload";

/**
 * Importación de comprobantes desde la plantilla Excel (§6.4). El cliente ya
 * parseó y normalizó las filas; aquí se validan e insertan en `comprobantes`
 * con origen 'plantilla'. RLS garantiza el aislamiento por empresa.
 */

const ComprobanteImport = z.object({
  fecha: FechaISO,
  fecha_vencimiento: FechaISO.optional().nullable(),
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
    fecha_vencimiento: c.fecha_vencimiento ?? null,
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

/**
 * Memoria de formatos: guarda el mapeo de columnas confirmado en
 * `cuentas_bancarias.mapeo_columnas` bajo la clave `extracto`, para
 * autoaplicarlo la próxima vez con los mismos encabezados. (La clave `internos`
 * quedó huérfana al retirarse la fuente "Subir archivo"; el merge conserva lo
 * que hubiera guardado antes, simplemente ya no se lee ni se escribe.)
 */
export async function guardarMapeoCuenta(
  cuentaId: string,
  mapeos: { extracto?: MapeoColumnas },
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  // Merge con lo existente (RLS asegura que la cuenta sea de la empresa).
  const { data: actual } = await supabase
    .from("cuentas_bancarias")
    .select("mapeo_columnas")
    .eq("id", cuentaId)
    .maybeSingle();

  const previo = (actual?.mapeo_columnas ?? {}) as Record<string, unknown>;
  const nuevo = {
    ...previo,
    ...(mapeos.extracto ? { extracto: mapeos.extracto } : {}),
  };

  const { error } = await supabase
    .from("cuentas_bancarias")
    .update({ mapeo_columnas: nuevo })
    .eq("id", cuentaId);

  return { ok: !error };
}

/**
 * Registros internos desde la tabla `comprobantes` para el período, ya en forma
 * canónica RegistroInterno (fuente "Usar mis comprobantes registrados").
 *
 * ⚠️ Deja fuera lo que ya está cobrado y lo anulado. Un comprobante saldado no
 * es materia de conciliación: volver a ofrecerlo lleva a conciliarlo por
 * segunda vez desde otra cuenta bancaria del mismo período —algo que el sistema
 * permite a propósito, porque son extractos distintos— y a descontar su importe
 * dos veces. Lo que ya se cobró no vuelve a la mesa.
 */
export async function getComprobantesCanonicos(
  desde: string,
  hasta: string,
): Promise<RegistroInterno[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("comprobantes")
    .select(
      "id, fecha, monto, saldo, tipo, estado, serie_numero, ruc_contraparte, razon_social_contraparte, descripcion",
    )
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .not("estado", "in", "(cobrado,anulado)")
    .order("fecha", { ascending: true });

  const filas = data ?? [];
  return filas.map((c, i) => {
    const tipo = c.tipo === "pago" ? "pago" : "cobranza";
    const monto = Math.abs(Number(c.monto ?? 0));
    return {
      // Se conserva el id legible para la pantalla de revisión —un UUID en una
      // tabla de dos mil filas no hay quien lo lea— y el vínculo real al
      // comprobante viaja aparte, en `comprobante_id`.
      id_interno: `REG-${String(i + 1).padStart(4, "0")}`,
      fecha: String(c.fecha),
      monto: tipo === "pago" ? -monto : monto,
      tipo,
      referencia: c.serie_numero ?? null,
      contraparte: c.razon_social_contraparte ?? null,
      descripcion: c.descripcion ?? null,
      comprobante_id: c.id,
    };
  });
}
