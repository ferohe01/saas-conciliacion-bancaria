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

  // ⚠️ NO se sale aquí cuando n8n no devolvió matches.
  //
  // El resumen que escribe n8n cuenta solo lo que ÉL vio: el residuo. En una
  // corrida donde la IA no propuso nada, salir antes dejaba
  // `total_internos: 4.382` en una conciliación de 452.177 — y la pantalla
  // pintaba "0 % emparejado" sobre un 99 % real.
  //
  // Absorber matches es opcional; **corregir los totales no lo es**.

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
  if (filas.length > 0) {
    const { error: errBorrado } = await admin
      .from("matches_conciliacion")
      .delete()
      .eq("job_id", jobId)
      .neq("metodo", "exacta");
    if (errBorrado) {
      throw new Error(`No se pudieron limpiar los matches previos: ${errBorrado.message}`);
    }
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

  // ── El resumen, recalculado desde la VERDAD y no incrementalmente ────────
  //
  // ⚠️ Los totales se piden a `totales_conciliacion`, no se suman a lo que
  // había. Sumar sería correcto una vez y erróneo dos: esta función la llama la
  // pantalla en cada carga, y un incremento se aplicaría cada vez.
  const [tot, exactos, difusos, ia] = await Promise.all([
    // ⚠️ Las partidas que la conciliación TOCÓ, no las que hoy siguen sin
    // cobrar. `totales_conciliacion` cuenta comprobantes no cobrados: al
    // aprobar, 447.795 pasan a `cobrado` y el total se desplomaba de 452.177 a
    // 4.382. Como esta función corre en cada carga de la pantalla, el número
    // empeoraba cada vez que alguien lo miraba.
    admin.rpc("partidas_conciliadas_job", { p_job_id: jobId }),
    contarPorMetodo(admin, jobId, "exacta"),
    contarPorMetodo(admin, jobId, "difusa"),
    contarPorMetodo(admin, jobId, "ia"),
  ]);
  const cubiertas = (tot.data as { internos: number; movimientos: number }[])?.[0];
  // Total del período = lo emparejado + lo que quedó suelto. Los sueltos los
  // cuenta n8n sobre el residuo, que es exactamente lo que sobró del período.
  const totales = cubiertas
    ? {
        internos: Number(cubiertas.internos) + resultado.resumen.sin_conciliar_internos,
        movimientos: Number(cubiertas.movimientos) + resultado.resumen.sin_conciliar_bancarios,
      }
    : null;

  const { error: errJob } = await admin
    .from("jobs_conciliacion")
    .update({
      resultado: {
        ...resultado,
        // El JSONB se queda sin `matches`: ya no es su sitio. Conserva el
        // resumen y el cuadre, que son de tamaño fijo.
        matches: [],
        resumen: {
          ...resultado.resumen,
          total_internos: Number(totales?.internos ?? resultado.resumen.total_internos),
          total_bancarios: Number(totales?.movimientos ?? resultado.resumen.total_bancarios),
          conciliados_exactos: exactos,
          conciliados_difusos: difusos,
          sugeridos_ia: ia,
        },
      },
    })
    .eq("id", jobId);
  if (errJob) {
    throw new Error(`No se pudo actualizar el resumen: ${errJob.message}`);
  }

  return { absorbidos, sinCambios: false };
}

async function contarPorMetodo(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  metodo: string,
): Promise<number> {
  const { count } = await admin
    .from("matches_conciliacion")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("metodo", metodo);
  return count ?? 0;
}
