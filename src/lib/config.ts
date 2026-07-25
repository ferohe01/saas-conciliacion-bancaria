import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";
import {
  ConfigConciliacion,
  CONFIG_CONCILIACION_DEFAULT,
} from "@/lib/contract/config";

/**
 * Config de conciliación de la empresa actual: lo guardado en
 * `empresas.config_conciliacion` mezclado sobre los defaults del contrato.
 * Si no hay nada guardado o es inválido, devuelve los defaults.
 */
export async function getConfigEmpresa(): Promise<ConfigConciliacion> {
  const empresa = await getEmpresaActual();
  if (!empresa) return CONFIG_CONCILIACION_DEFAULT;

  const supabase = await createClient();
  const { data } = await supabase
    .from("empresas")
    .select("config_conciliacion")
    .eq("id", empresa.empresa_id)
    .maybeSingle();

  const guardado = (data?.config_conciliacion ?? {}) as Record<string, unknown>;
  const parsed = ConfigConciliacion.safeParse({
    ...CONFIG_CONCILIACION_DEFAULT,
    ...guardado,
  });
  return parsed.success ? parsed.data : CONFIG_CONCILIACION_DEFAULT;
}
