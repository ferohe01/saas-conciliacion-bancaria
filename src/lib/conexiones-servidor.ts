import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ConexionErp } from "@/lib/conexiones";

/**
 * Lectura de la ficha de conexión (solo servidor). `lib/conexiones.ts` queda
 * puro —se testea y también se usa en componentes cliente—; aquí vive lo que
 * toca la base.
 */
export async function getConexionErp(): Promise<ConexionErp | null> {
  const supabase = await createClient(); // RLS: solo la empresa del usuario
  const { data } = await supabase
    .from("conexiones_erp")
    .select(
      "sistema, nombre_sistema, url_base, identificador, frecuencia, contacto, notas, estado, updated_at",
    )
    .maybeSingle();

  return (data as ConexionErp | null) ?? null;
}
