import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * La ficha de una carga de comprobantes.
 *
 * ── Por qué se guarda ──────────────────────────────────────────────────────
 *
 * Estos contadores ya existían: la importación los devuelve para componer el
 * mensaje de pantalla («se agregaron 452.309, 8 venían repetidas»). Pero ese
 * mensaje **desaparece al recargar**, y la pregunta que provoca —«mi archivo
 * tiene 452.605 filas, ¿dónde están las otras?»— se hace días después, delante
 * de un cliente, sobre datos que están perfectamente bien.
 *
 * ⚠️ Se escribe con `admin`: `importaciones_comprobantes` no tiene política de
 * insert a propósito. Describe lo que hizo el sistema al leer un archivo, no
 * algo que el usuario declare; si se pudiera escribir desde el navegador, la
 * cascada dejaría de ser una comprobación para pasar a ser una afirmación del
 * propio interesado.
 *
 * ⚠️ Nunca interrumpe la carga. Los comprobantes ya están insertados cuando esto
 * corre: fallar aquí solo cuesta la explicación, y devolver un error haría creer
 * que la importación se deshizo.
 */
export async function registrarImportacion(datos: {
  lote: string;
  empresaId: string;
  archivo: string | null;
  filasLeidas: number;
  insertados: number;
  yaExistian: number;
  repetidasEnArchivo: number;
  invalidas: number;
  /** Fechas ISO de las filas cargadas; solo se guardan los extremos. */
  fechas?: string[];
  fechaMin?: string | null;
  fechaMax?: string | null;
}): Promise<void> {
  const admin = createAdminClient();

  let min = datos.fechaMin ?? null;
  let max = datos.fechaMax ?? null;
  for (const f of datos.fechas ?? []) {
    if (min === null || f < min) min = f;
    if (max === null || f > max) max = f;
  }

  const { error } = await admin.from("importaciones_comprobantes").upsert({
    lote: datos.lote,
    empresa_id: datos.empresaId,
    archivo: datos.archivo?.slice(0, 200) ?? null,
    filas_leidas: datos.filasLeidas,
    insertados: datos.insertados,
    ya_existian: datos.yaExistian,
    repetidas_en_archivo: datos.repetidasEnArchivo,
    invalidas: datos.invalidas,
    fecha_min: min,
    fecha_max: max,
  });
  if (error) {
    console.error("[comprobantes] no se pudo registrar la importación:", error);
  }
}
