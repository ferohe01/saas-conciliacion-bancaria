import "server-only";
import type { User } from "@supabase/supabase-js";
import { getEmpresaActual, getUsuarioActual, type EmpresaActual } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { motivoSinPermiso, puede, rolDe, type Permiso, type Rol } from "@/lib/roles";

export type Acceso =
  | { ok: true; usuario: User; empresa: EmpresaActual; rol: Rol }
  | { ok: false; error: string; status: 401 | 403 };

/**
 * El único punto donde se decide si la persona puede hacer algo.
 *
 * Cada server action y ruta que escribe empieza con `exigir(...)`. El rol sale
 * de `usuarios_empresa` (que el usuario no puede escribir: la 0006 solo concede
 * UPDATE sobre su nombre y teléfono, y la 0057 retira el INSERT), no de nada
 * que mande el navegador.
 */
export async function exigir(permiso: Permiso): Promise<Acceso> {
  const [usuario, empresa] = await Promise.all([getUsuarioActual(), getEmpresaActual()]);
  if (!usuario || !empresa) return { ok: false, error: "No autenticado.", status: 401 };
  const rol = rolDe(empresa.rol);
  if (!puede(rol, permiso)) {
    return { ok: false, error: motivoSinPermiso(rol, permiso), status: 403 };
  }
  return { ok: true, usuario, empresa, rol };
}

/** El rol de la persona actual, para que la interfaz oculte lo que no puede usar. */
export async function rolActual(): Promise<Rol | null> {
  const empresa = await getEmpresaActual();
  return empresa ? rolDe(empresa.rol) : null;
}

/**
 * Cuántos miembros de la empresa, aparte de `excluir`, pueden aprobar.
 * Lo usa la separación de funciones (`separacionAlAprobar`).
 *
 * ⚠️ Con `admin` y filtro explícito de empresa: la política de lectura de
 * `usuarios_empresa` solo deja ver la fila propia.
 */
export async function otrosAprobadores(empresaId: string, excluir: string): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("usuarios_empresa")
    .select("usuario_id, rol")
    .eq("empresa_id", empresaId)
    .neq("usuario_id", excluir);
  if (error) {
    // Ante la duda, se aplica el control: decir «hay otro aprobador» cuesta
    // pedirle a otra persona que apruebe; decir «no hay» saltaría el control.
    console.error("[roles] no se pudo contar los aprobadores:", error);
    return 1;
  }
  return (data ?? []).filter((m) => puede(rolDe(m.rol), "aprobar")).length;
}
