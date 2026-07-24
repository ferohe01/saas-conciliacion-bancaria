"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";

const CuentaSchema = z.object({
  banco: z.string().trim().min(1, "Indica el banco"),
  numero: z
    .string()
    .trim()
    .regex(/^\d{4,20}$/, "El número debe tener entre 4 y 20 dígitos")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  moneda: z.enum(["PEN", "USD"]),
});

export type AccionResultado = { ok: boolean; error?: string };

/** Enmascara un número de cuenta dejando visibles los últimos 4 dígitos. */
function enmascarar(numero?: string): string | null {
  if (!numero) return null;
  return "····" + numero.slice(-4);
}

export async function crearCuenta(
  _prev: AccionResultado,
  formData: FormData,
): Promise<AccionResultado> {
  const parsed = CuentaSchema.safeParse({
    banco: formData.get("banco"),
    numero: formData.get("numero"),
    moneda: formData.get("moneda"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };

  const supabase = await createClient();
  const { error } = await supabase.from("cuentas_bancarias").insert({
    empresa_id: empresa.empresa_id,
    banco: parsed.data.banco,
    numero_enmascarado: enmascarar(parsed.data.numero),
    moneda: parsed.data.moneda,
  });

  if (error) return { ok: false, error: "No se pudo crear la cuenta." };

  revalidatePath("/cuentas");
  return { ok: true };
}

export async function eliminarCuenta(id: string): Promise<AccionResultado> {
  const supabase = await createClient();
  // RLS garantiza que solo se elimine una cuenta de la empresa del usuario.
  const { error } = await supabase
    .from("cuentas_bancarias")
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: "No se pudo eliminar la cuenta." };

  revalidatePath("/cuentas");
  return { ok: true };
}
