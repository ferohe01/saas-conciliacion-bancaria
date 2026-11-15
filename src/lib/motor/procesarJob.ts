import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EjemploAprendizaje, PayloadConciliacion } from "@/lib/contract/payload";
import { absorberResultado } from "@/lib/conciliacion/absorber";
import { elegirEjemplosSimilares } from "@/lib/ejemplosSimilares-servidor";
import { ejecutarMotor } from "./motor";
import { consultarModeloConciliacion } from "./llm";

/**
 * Corre el motor sobre un job ya creado y guarda su resultado.
 *
 * Sustituye al webhook de n8n: `/api/conciliacion/iniciar` responde al
 * navegador y deja esto corriendo en segundo plano (`after`). La pantalla de
 * progreso no cambia: sigue leyendo `estado` y `fase_actual` del job por
 * Realtime + polling, y ahora además ve avanzar cada capa — n8n solo escribía
 * una vez, al final.
 *
 * ⚠️ Un fallo deja el job en `error` CON el motivo. Con n8n un flujo que moría
 * a medias dejaba el job en `procesando` para siempre, reteniendo la clave de
 * idempotencia del período; aquí sí se sabe que falló, así que se dice. Lo
 * único que sigue sin poder marcarse es que el proceso entero muera (un
 * reinicio del contenedor): para eso sigue el vigilante de `jobsAtascados`.
 */
export async function procesarJob(
  jobId: string,
  payload: PayloadConciliacion,
  opciones: {
    /**
     * Todas las decisiones humanas de la empresa que pueden servir de ejemplo
     * (no solo las 12 recientes del payload). De ahí se eligen las más
     * parecidas a los casos de esta corrida (pgvector, 0059).
     */
    poolEjemplos?: EjemploAprendizaje[];
  } = {},
): Promise<void> {
  const admin = createAdminClient();
  const actualizar = (campos: Record<string, unknown>) =>
    admin.from("jobs_conciliacion").update(campos).eq("id", jobId);
  const pool = opciones.poolEjemplos ?? [];

  try {
    await actualizar({ estado: "procesando" });

    const { resultado, traza } = await ejecutarMotor(payload, {
      consultarIa: consultarModeloConciliacion,
      elegirEjemplos:
        pool.length > 0
          ? (shortlists) => elegirEjemplosSimilares(payload.metadata.empresa_id, pool, shortlists)
          : null,
      alEntrarEnFase: async (fase) => {
        // El avance es informativo: si una escritura falla, el motor sigue.
        const { error } = await actualizar({ fase_actual: fase });
        if (error) console.error(`[motor] no se pudo marcar la fase ${fase}:`, error);
      },
    });

    console.info(
      `[motor] ${jobId}: ${resultado.matches.length} pares; IA consultada sobre ${traza.consultadasIa}` +
        ` (omitidas ${traza.omitidasIa}; respondió: ${traza.iaRespondio ?? "no hizo falta"};` +
        ` ejemplos: ${traza.ejemplos})`,
    );

    // La escritura del resultado SÍ tiene que salir: tres intentos, como el
    // nodo «Actualizar Supabase». Un corte de red no debe costar la corrida.
    let ultimoError: unknown = null;
    for (let intento = 1; intento <= 3; intento++) {
      const { error } = await actualizar({
        estado: "completado",
        fase_actual: "ia",
        resultado,
        completed_at: new Date().toISOString(),
      });
      if (!error) {
        ultimoError = null;
        break;
      }
      ultimoError = error;
      console.error(`[motor] no se pudo guardar el resultado (intento ${intento}/3):`, error);
      await new Promise((r) => setTimeout(r, 2_000));
    }
    if (ultimoError) throw new Error("No se pudo guardar el resultado de la conciliación.");
  } catch (e) {
    const detalle = e instanceof Error ? e.message : "El motor de conciliación falló.";
    console.error(`[motor] ${jobId} falló:`, e);
    await actualizar({ estado: "error", error_detalle: detalle });
    return;
  }

  // Modo tabla: los pares del residuo pasan a `matches_conciliacion` ya, sin
  // esperar a que alguien abra la pantalla (que también lo hace, y es
  // idempotente). Si falla aquí, se reintenta en esa carga.
  try {
    await absorberResultado(jobId);
  } catch (e) {
    console.error(`[motor] ${jobId}: no se pudo absorber el resultado ahora:`, e);
  }
}
