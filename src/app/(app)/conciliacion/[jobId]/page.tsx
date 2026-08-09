import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ProgresoConciliacion,
  type JobRow,
} from "@/components/conciliacion/ProgresoConciliacion";
import { ResultadoReview } from "@/components/conciliacion/ResultadoReview";
import { asistenteDisponible } from "@/lib/ia/cliente";
import { formatearFecha } from "@/lib/parsing/resumen";
import { ResultadoConciliacion } from "@/lib/contract/resultado";
import { absorberResultado } from "@/lib/conciliacion/absorber";
import { estadoCobros } from "./actions";
import { cargarVistaResultado } from "@/lib/conciliacion/vista";
import { PayloadConciliacion } from "@/lib/contract/payload";
import { EncabezadoPagina, BadgeEstadoJob } from "@/components/ui";
import { EstadoContablePanel } from "@/components/conciliacion/EstadoContablePanel";
import { getPrecedentes } from "@/lib/precedentes-servidor";
import type { EstadoContable } from "@/lib/cicloContable";

/**
 * Pantalla de una conciliación:
 *  - en progreso → ProgresoConciliacion (Realtime).
 *  - completada  → ResultadoReview (dos paneles, cola IA, manual, exportación).
 */
export default async function ConciliacionPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs_conciliacion")
    .select(
      "id, estado, fase_actual, resultado, error_detalle, periodo_desde, periodo_hasta, created_at, payload_entrada, estado_contable, version, fecha_aprobacion, cuenta_id, lote_extracto_id",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (!data) notFound();

  // ⚠️ En modo tabla, n8n devuelve sus pares dentro del JSONB y aquí se pasan a
  // `matches_conciliacion`, donde ya están los de la capa exacta. Se hace al
  // abrir la pantalla porque n8n escribe directo en Supabase y la app no recibe
  // ningún aviso; es idempotente, así que recargar no duplica nada.
  //
  // Sin esto la conciliación quedaría contada en dos sitios y la pantalla
  // enseñaría la mitad.
  if (data.lote_extracto_id && data.estado === "completado") {
    try {
      await absorberResultado(jobId);
    } catch (e) {
      console.error(`[conciliacion] no se pudo unificar ${jobId}:`, e);
    }
  }

  // ¿Hay otras corridas de este mismo rango? Cambia lo que hay que advertir
  // antes de aprobar: si las hay, aprobar reemplaza a otra.
  const { count: corridasDelRango } = await supabase
    .from("jobs_conciliacion")
    .select("id", { count: "exact", head: true })
    .eq("cuenta_id", data.cuenta_id)
    .eq("periodo_desde", data.periodo_desde)
    .eq("periodo_hasta", data.periodo_hasta);
  const hayVersionesPrevias = (corridasDelRango ?? 1) > 1;

  // Tras absorber, `resultado` cambió: se relee.
  const { data: fresco } = data.lote_extracto_id
    ? await supabase
        .from("jobs_conciliacion")
        .select("resultado")
        .eq("id", jobId)
        .maybeSingle()
    : { data: null };

  // Solo tiene sentido en el modo tabla: en el de siempre, el reparto va con
  // las decisiones y no puede quedarse a medias.
  const cobros =
    data.lote_extracto_id && data.estado_contable === "aprobada"
      ? await estadoCobros(jobId)
      : null;

  const resultadoParsed =
    data.estado === "completado"
      ? ResultadoConciliacion.safeParse(fresco?.resultado ?? data.resultado)
      : null;
  const payloadParsed = PayloadConciliacion.safeParse(data.payload_entrada);

  const mostrarReview =
    resultadoParsed?.success && payloadParsed.success;

  // Los pares salen de la TABLA cuando el job es de modo tabla; del JSONB
  // cuando es de los de siempre. Las conciliaciones ya guardadas no se migran:
  // migrarlas no aportaría nada y sí podría romperlas.
  const vista =
    mostrarReview && data.lote_extracto_id
      ? await cargarVistaResultado(
          jobId,
          resultadoParsed!.data,
          payloadParsed.data,
        )
      : null;

  // Casos parecidos ya resueltos, para las sugerencias que esperan decisión.
  // Se calcula en el servidor: el historial de otros jobs no tiene por qué
  // viajar entero al navegador.
  const precedentes = mostrarReview
    ? await getPrecedentes(
        data.id,
        vista?.resultado.matches ?? resultadoParsed!.data.matches,
        payloadParsed.data,
      )
    : {};

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <EncabezadoPagina
        titulo={`Conciliación · ${formatearFecha(data.periodo_desde)} – ${formatearFecha(data.periodo_hasta)}`}
        volver={{ href: "/conciliacion", texto: "Historial" }}
        accion={<BadgeEstadoJob estado={data.estado} />}
      />
      <p className="-mt-3 text-sm text-neutral-600">
        Identificador del proceso:{" "}
        <span className="font-mono text-xs">{data.id}</span>
      </p>

      {/* Va antes que el resultado: si el documento no rige, revisar sus
          sugerencias es trabajo perdido. */}
      <EstadoContablePanel
        jobId={data.id}
        estadoContable={(data.estado_contable ?? "borrador") as EstadoContable}
        estadoTecnico={data.estado}
        version={data.version ?? 1}
        fechaAprobacion={data.fecha_aprobacion ?? null}
        hayVersionesPrevias={hayVersionesPrevias}
        cobros={cobros}
      />

      {mostrarReview ? (
        <>
          {vista && vista.totalPares > vista.resultado.matches.length && (
            <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-700">
              Esta conciliación tiene{" "}
              <span className="font-semibold tabular-nums">
                {vista.totalPares.toLocaleString("es-PE")}
              </span>{" "}
              pares. Abajo se muestran los{" "}
              {vista.resultado.matches.length.toLocaleString("es-PE")} que
              esperan tu criterio o los más recientes: el resto está conciliado
              automáticamente y no necesita revisión.
            </p>
          )}
          <ResultadoReview
            jobId={data.id}
            resultado={vista?.resultado ?? resultadoParsed!.data}
            internos={vista?.internos ?? payloadParsed.data.registros_internos}
            bancarios={vista?.bancarios ?? payloadParsed.data.movimientos_bancarios}
            moneda={payloadParsed.data.metadata.cuenta.moneda}
            precedentes={precedentes}
            totalPares={vista?.totalPares}
            asistente={asistenteDisponible()}
          />
        </>
      ) : (
        <ProgresoConciliacion jobInicial={data as unknown as JobRow} />
      )}
    </div>
  );
}
