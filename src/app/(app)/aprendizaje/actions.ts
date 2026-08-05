"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";
import { normalizarCriterios } from "@/lib/criteriosIniciales";

/**
 * Guarda el criterio que la empresa declara sobre su operación (arranque en
 * frío del aprendizaje).
 *
 * ⚠️ Escribe con el cliente `anon` + RLS, así que depende del GRANT por columna
 * de la `0019`. Si esa migración no está aplicada, esto falla en silencio desde
 * el punto de vista de RLS —la política deja pasar la fila y es el permiso de
 * columna el que la para—, y el mensaje de error lo dice.
 */
export type CriteriosResultado = { ok: boolean; error?: string };

export async function guardarCriterios(
  ids: string[],
): Promise<CriteriosResultado> {
  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };

  // Se descartan los códigos desconocidos en vez de rechazar la petición: un
  // criterio retirado del catálogo no debe impedir guardar los demás.
  const criterios = normalizarCriterios(ids);

  const supabase = await createClient();
  const { error } = await supabase
    .from("empresas")
    .update({ criterios_conciliacion: criterios })
    .eq("id", empresa.empresa_id);

  if (error) {
    return {
      ok: false,
      error:
        "No se pudo guardar tu criterio. Si el problema persiste, puede faltar aplicar la migración 0019 en la base.",
    };
  }

  revalidatePath("/aprendizaje");
  return { ok: true };
}
