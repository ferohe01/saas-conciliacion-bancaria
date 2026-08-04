"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";
import { ConexionErpInput } from "@/lib/conexiones-schema";

/**
 * Ficha de "Conectar sistema". Guarda lo que el cliente declara sobre su
 * sistema de facturación; NO activa ninguna sincronización (todavía no existe)
 * ni guarda credenciales (ver `0017_conexiones_erp.sql`).
 */

export type ConexionResultado = {
  ok: boolean;
  error?: string;
  /** Campo concreto que falló, para señalarlo en el formulario. */
  campo?: string;
};

const texto = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

export async function guardarConexion(
  _prev: ConexionResultado,
  formData: FormData,
): Promise<ConexionResultado> {
  const parsed = ConexionErpInput.safeParse({
    sistema: texto(formData, "sistema") ?? "",
    nombre_sistema: texto(formData, "nombre_sistema"),
    url_base: texto(formData, "url_base"),
    identificador: texto(formData, "identificador"),
    frecuencia: texto(formData, "frecuencia") ?? "diaria",
    contacto: texto(formData, "contacto"),
    notas: texto(formData, "notas"),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Revisa los datos del formulario.",
      campo: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    };
  }

  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };

  const supabase = await createClient();
  const { data: usuario } = await supabase.auth.getUser();

  const { data: existente } = await supabase
    .from("conexiones_erp")
    .select("empresa_id")
    .eq("empresa_id", empresa.empresa_id)
    .maybeSingle();

  // No se usa `upsert`: su ON CONFLICT DO UPDATE tocaría también `empresa_id` y
  // `solicitado_por`, y `0017` concede el UPDATE solo sobre las columnas que el
  // cliente edita. Insertar o actualizar por separado encaja con esos permisos
  // —y deja claro que `estado` no se escribe nunca desde aquí.
  const campos = {
    sistema: parsed.data.sistema,
    nombre_sistema: parsed.data.nombre_sistema,
    url_base: parsed.data.url_base,
    identificador: parsed.data.identificador,
    frecuencia: parsed.data.frecuencia,
    contacto: parsed.data.contacto,
    notas: parsed.data.notas,
  };

  const { error } = existente
    ? await supabase
        .from("conexiones_erp")
        .update({ ...campos, updated_at: new Date().toISOString() })
        .eq("empresa_id", empresa.empresa_id)
    : await supabase.from("conexiones_erp").insert({
        empresa_id: empresa.empresa_id,
        ...campos,
        solicitado_por: usuario.user?.id ?? null,
      });

  if (error) {
    return { ok: false, error: "No se pudieron guardar los datos de tu sistema." };
  }

  revalidatePath("/conexiones");
  revalidatePath("/wizard");
  return { ok: true };
}

export async function eliminarConexion(): Promise<ConexionResultado> {
  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("conexiones_erp")
    .delete()
    .eq("empresa_id", empresa.empresa_id);

  if (error) return { ok: false, error: "No se pudo quitar la conexión." };

  revalidatePath("/conexiones");
  revalidatePath("/wizard");
  return { ok: true };
}
