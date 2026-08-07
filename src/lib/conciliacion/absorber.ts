import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enLotes } from "@/lib/supabase/paginado";
import { ResultadoConciliacion } from "@/lib/contract/resultado";

/**
 * Vuelca los matches que devolvió n8n a `matches_conciliacion` (parte B).
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * En modo tabla la conciliación queda partida en dos: la capa exacta escribió
 * sus pares en la tabla, y n8n devuelve los suyos —los del residuo— dentro del
 * JSONB `resultado`. Dos sitios para la misma cosa es exactamente el estado en
 * el que una pantalla acaba contando la mitad y nadie sabe por qué.
 *
 * Aquí se unifican: los del JSONB pasan a la tabla y el JSONB se queda con lo
 * que NO crece —el resumen y el cuadre—, que es lo que lo hacía inviable a
 * medio millón de partidas.
 *
 * ── El puente de los ids ───────────────────────────────────────────────────
 *
 * `resultado` referencia las partidas por su id sintético ("REG-0007"), que
 * solo tiene sentido dentro de su payload. El uuid real viaja en el propio
 * payload (`comprobante_id`, `movimiento_id`), así que la traducción sale de
 * ahí. Sin ese puente no habría forma de atar un match a una fila — es el mismo
 * problema que resolvió `comprobante_id` para cerrar el bucle de cobranzas.
 *
 * Es **idempotente**: si ya se absorbió, no hace nada. La pantalla la llama en
 * cada carga y no puede duplicar pares.
 */

type PayloadGuardado = {
  registros_internos?: { id_interno: string; comprobante_id?: string | null }[];
  movimientos_bancarios?: { id_movimiento: string; movimiento_id?: string | null }[];
};

export type ResultadoAbsorcion = {
  absorbidos: number;
  /** Ya estaba unificado: no había nada que mover. */
  sinCambios: boolean;
};

export async function absorberResultado(
  jobId: string,
): Promise<ResultadoAbsorcion> {
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("jobs_conciliacion")
    .select("id, empresa_id, lote_extracto_id, payload_entrada, resultado")
    .eq("id", jobId)
    .maybeSingle();

  // Solo el modo tabla. Las conciliaciones de siempre siguen viviendo en su
  // JSONB y no se tocan: migrarlas no aportaría nada y sí podría romperlas.
  if (!job?.lote_extracto_id) return { absorbidos: 0, sinCambios: true };

  const parsed = ResultadoConciliacion.safeParse(job.resultado);
  if (!parsed.success) return { absorbidos: 0, sinCambios: true };
  const resultado = parsed.data;
  if (resultado.matches.length === 0) return { absorbidos: 0, sinCambios: true };

  const payload = (job.payload_entrada ?? {}) as PayloadGuardado;
  const porInterno = new Map(
    (payload.registros_internos ?? [])
      .filter((r) => r.comprobante_id)
      .map((r) => [r.id_interno, r.comprobante_id as string]),
  );
  const porMovimiento = new Map(
    (payload.movimientos_bancarios ?? [])
      .filter((m) => m.movimiento_id)
      .map((m) => [m.id_movimiento, m.movimiento_id as string]),
  );

  const filas = resultado.matches.map((m) => ({
    job_id: jobId,
    empresa_id: job.empresa_id as string,
    comprobante_ids: m.ids_internos
      .map((id) => porInterno.get(id))
      .filter((x): x is string => Boolean(x)),
    movimiento_ids: m.ids_movimientos
      .map((id) => porMovimiento.get(id))
      .filter((x): x is string => Boolean(x)),
    metodo: m.metodo,
    estado_revision: m.estado_revision,
    confianza: m.confianza ?? null,
    categoria_diferencia: m.categoria_diferencia ?? null,
    diferencia_monto: m.diferencia_monto ?? null,
    justificacion: m.justificacion ?? null,
    decisiones: m.decisiones ?? [],
    excluido_aprendizaje: m.excluido_aprendizaje ?? false,
  }));

  // Reentrante: se borra lo que no sea de la capa exacta y se reescribe. La
  // capa exacta la escribió `conciliar_exacta` y no se toca.
  const { error: errBorrado } = await admin
    .from("matches_conciliacion")
    .delete()
    .eq("job_id", jobId)
    .neq("metodo", "exacta");
  if (errBorrado) {
    throw new Error(`No se pudieron limpiar los matches previos: ${errBorrado.message}`);
  }

  // Por lotes y comprobando el error de cada uno: con el `statement_timeout` de
  // 8 s de Postgres, un insert único de miles de filas se cancela — y
  // `supabase-js` DEVUELVE ese error en vez de lanzarlo, así que sin mirarlo se
  // daría por absorbido lo que no se escribió.
  let absorbidos = 0;
  for (const parte of enLotes(filas, 500)) {
    const { error } = await admin.from("matches_conciliacion").insert(parte);
    if (error) {
      throw new Error(`No se pudieron guardar los matches: ${error.message}`);
    }
    absorbidos += parte.length;
  }

  // El JSONB se queda sin `matches`: ya no es su sitio. Conserva el resumen y
  // el cuadre, que son de tamaño fijo.
  const { count: exactos } = await admin
    .from("matches_conciliacion")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("metodo", "exacta");

  const { error: errJob } = await admin
    .from("jobs_conciliacion")
    .update({
      resultado: {
        ...resultado,
        matches: [],
        resumen: {
          ...resultado.resumen,
          // n8n solo vio el residuo, así que su cuenta de exactas ignora las
          // que resolvió el SQL. Sin sumarlas, la pantalla diría que se
          // conciliaron 12 de 452.177.
          conciliados_exactos: (exactos ?? 0),
          total_internos: (exactos ?? 0) + resultado.resumen.total_internos,
          total_bancarios: (exactos ?? 0) + resultado.resumen.total_bancarios,
        },
      },
    })
    .eq("id", jobId);
  if (errJob) {
    throw new Error(`No se pudo actualizar el resumen: ${errJob.message}`);
  }

  return { absorbidos, sinCambios: false };
}
