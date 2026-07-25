"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";
import { ConfigConciliacion } from "@/lib/contract/config";

/**
 * Guarda la configuración de tolerancias de la empresa. El umbral de
 * auto-conciliación llega como porcentaje (0-100) y se guarda como fracción.
 * RLS (empresas_update) asegura que solo se edite la empresa del usuario.
 */

const num = (v: FormDataEntryValue | null) => Number(v);

export type ConfigResultado = { ok: boolean; error?: string };

export async function guardarConfiguracion(
  _prev: ConfigResultado,
  formData: FormData,
): Promise<ConfigResultado> {
  const candidato = {
    tolerancia_monto_abs: num(formData.get("tolerancia_monto_abs")),
    tolerancia_monto_pct: num(formData.get("tolerancia_monto_pct")),
    tolerancia_dias: num(formData.get("tolerancia_dias")),
    tolerancia_ia_monto: num(formData.get("tolerancia_ia_monto")),
    umbral_confianza_auto: num(formData.get("umbral_confianza_pct")) / 100,
  };

  const parsed = ConfigConciliacion.safeParse(candidato);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Revisa los valores: deben ser números válidos.",
    };
  }

  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("empresas")
    .update({ config_conciliacion: parsed.data as z.infer<typeof ConfigConciliacion> })
    .eq("id", empresa.empresa_id);

  if (error) return { ok: false, error: "No se pudo guardar la configuración." };

  revalidatePath("/configuracion");
  return { ok: true };
}
