"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsuarioActual, getEmpresaActual } from "@/lib/auth";

/**
 * Anular un cobro concreto sin tumbar la conciliación entera.
 *
 * El caso real: el banco revierte un depósito ya conciliado (cheque devuelto,
 * transferencia revertida, contracargo). Antes había que anular la conciliación
 * completa, lo que también deshacía los demás cobros —correctos— de esa misma
 * corrida.
 *
 * La reversión NO borra la aplicación: se guarda aparte (migración 0016) para
 * conservar las dos caras de la historia y para que sobreviva a que
 * `sincronizarCobranzas` rehaga las aplicaciones del job. El saldo lo recalcula
 * el trigger de la base, no este código.
 *
 * Escribe con `service_role` porque RLS solo concede SELECT sobre estas tablas;
 * la pertenencia se comprueba antes leyendo con el cliente del usuario.
 */

const RevertirSchema = z.object({
  comprobante_id: z.string().uuid(),
  job_id: z.string().min(1),
  id_movimiento: z.string().min(1),
  motivo: z.string().trim().max(500).optional(),
});

type Resultado = { ok: boolean; error?: string };

export async function revertirCobro(
  entrada: z.infer<typeof RevertirSchema>,
): Promise<Resultado> {
  const parsed = RevertirSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const usuario = await getUsuarioActual();
  const empresa = await getEmpresaActual();
  if (!usuario || !empresa) return { ok: false, error: "No autenticado." };

  const { comprobante_id, job_id, id_movimiento, motivo } = parsed.data;

  // Lectura con RLS: garantiza que la aplicación es de su empresa. Sin esto,
  // `service_role` escribiría sobre cualquier comprobante del sistema.
  const supabase = await createClient();
  const { data: aplicacion } = await supabase
    .from("aplicaciones_cobro")
    .select("id, monto_aplicado, empresa_id")
    .eq("comprobante_id", comprobante_id)
    .eq("job_id", job_id)
    .eq("id_movimiento", id_movimiento)
    .maybeSingle();

  if (!aplicacion) {
    return { ok: false, error: "No se encontró ese cobro." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("reversiones_cobro").insert({
    empresa_id: aplicacion.empresa_id,
    comprobante_id,
    job_id,
    id_movimiento,
    monto_revertido: aplicacion.monto_aplicado,
    motivo: motivo?.trim() || null,
    usuario_id: usuario.id,
  });

  if (error) {
    // 23505 = ya existe una reversión para esa aplicación.
    if (error.code === "23505") {
      return { ok: false, error: "Ese cobro ya estaba anulado." };
    }
    console.error(`[reversion] no se pudo revertir ${comprobante_id}:`, error);
    return { ok: false, error: "No se pudo anular el cobro." };
  }

  revalidar(comprobante_id);
  return { ok: true };
}

/** Deshace la reversión: el cobro vuelve a contar. Para el error de dedo. */
export async function deshacerReversion(
  comprobante_id: string,
  job_id: string,
  id_movimiento: string,
): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario) return { ok: false, error: "No autenticado." };

  const supabase = await createClient();
  const { data: reversion } = await supabase
    .from("reversiones_cobro")
    .select("id")
    .eq("comprobante_id", comprobante_id)
    .eq("job_id", job_id)
    .eq("id_movimiento", id_movimiento)
    .maybeSingle();

  if (!reversion) return { ok: false, error: "Esa anulación ya no existe." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("reversiones_cobro")
    .delete()
    .eq("id", reversion.id);

  if (error) {
    console.error(`[reversion] no se pudo deshacer ${reversion.id}:`, error);
    return { ok: false, error: "No se pudo deshacer la anulación." };
  }

  revalidar(comprobante_id);
  return { ok: true };
}

/** Revertir mueve saldo, así que hay que refrescar todo lo que lo muestra. */
function revalidar(comprobanteId: string) {
  revalidatePath(`/comprobantes/${comprobanteId}`);
  revalidatePath("/comprobantes");
  revalidatePath("/cobranzas");
  revalidatePath("/pagos");
  revalidatePath("/dashboard");
}
