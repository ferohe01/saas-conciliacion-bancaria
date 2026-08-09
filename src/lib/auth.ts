import "server-only";
import { createClient } from "@/lib/supabase/server";

export type EmpresaActual = {
  empresa_id: string;
  nombre: string;
  ruc: string | null;
  rol: string;
  /** Plan y fin de la prueba: los consume `lib/suscripcion`. */
  plan: string | null;
  prueba_hasta: string | null;
  created_at: string | null;
  /** Qué columna del archivo del cliente es cada campo. Ver 0039. */
  mapeo_comprobantes: unknown;
};

/**
 * Devuelve el usuario autenticado (o null). Usa getUser(), que revalida el
 * token contra Supabase.
 */
export async function getUsuarioActual() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Devuelve la empresa del usuario actual. En el MVP se asume una sola membresía
 * por usuario; si hubiera varias, toma la primera. Devuelve null si no hay
 * sesión o membresía.
 */
export async function getEmpresaActual(): Promise<EmpresaActual | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("usuarios_empresa")
    .select("rol, empresa_id, empresas(nombre, ruc, plan, prueba_hasta, created_at, mapeo_comprobantes)")
    .eq("usuario_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  // Supabase tipa la relación como objeto o arreglo según la inferencia; se
  // normaliza a objeto.
  const empresa = Array.isArray(data.empresas)
    ? data.empresas[0]
    : data.empresas;
  if (!empresa) return null;

  return {
    empresa_id: data.empresa_id,
    nombre: empresa.nombre,
    ruc: empresa.ruc ?? null,
    rol: data.rol,
    plan: empresa.plan ?? null,
    prueba_hasta: empresa.prueba_hasta ?? null,
    created_at: empresa.created_at ?? null,
    mapeo_comprobantes: empresa.mapeo_comprobantes ?? null,
  };
}
