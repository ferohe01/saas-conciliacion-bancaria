"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ResultadoConciliacion } from "@/lib/contract/resultado";
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

/**
 * Saca un ejemplo del pool de aprendizaje (o lo devuelve).
 *
 * ⚠️ NO revierte la decisión ni toca la conciliación: el match sigue aceptado o
 * rechazado, con su historial intacto. Lo único que cambia es que deja de
 * enseñar. Confundir ambas cosas sería grave —"quitar de los ejemplos" no puede
 * significar "deshacer un cobro"—, y por eso esto vive aquí y no en la pantalla
 * de revisión.
 */
export async function excluirDelAprendizaje(
  jobId: string,
  matchIndex: number,
  excluir: boolean,
): Promise<CriteriosResultado> {
  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };

  const supabase = await createClient(); // RLS: solo jobs de su empresa
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select("resultado")
    .eq("id", jobId)
    .maybeSingle();

  if (!data?.resultado) return { ok: false, error: "Conciliación no encontrada." };

  const parsed = ResultadoConciliacion.safeParse(data.resultado);
  if (!parsed.success) {
    return { ok: false, error: "Resultado con formato inesperado." };
  }

  const match = parsed.data.matches[matchIndex];
  if (!match) return { ok: false, error: "Ejemplo no encontrado." };
  match.excluido_aprendizaje = excluir;

  // service_role: escribir el resultado es cosa del backend, igual que en la
  // pantalla de revisión.
  const admin = createAdminClient();
  const { error } = await admin
    .from("jobs_conciliacion")
    .update({ resultado: parsed.data })
    .eq("id", jobId);

  if (error) return { ok: false, error: "No se pudo actualizar el ejemplo." };

  revalidatePath("/aprendizaje");
  return { ok: true };
}
