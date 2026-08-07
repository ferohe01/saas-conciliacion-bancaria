"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EstadoJob } from "@/lib/contract/enums";
import type { ResultadoConciliacion } from "@/lib/contract/resultado";
import { Boton, Tarjeta, clasesBoton } from "@/components/ui";
import { saludDelJob, minutosDesde } from "@/lib/jobsAtascados";

export type JobRow = {
  id: string;
  estado: EstadoJob;
  fase_actual: string | null;
  resultado: Partial<ResultadoConciliacion> | null;
  error_detalle: string | null;
  periodo_desde: string;
  periodo_hasta: string;
  /** Para detectar que se quedó colgada. Ver `lib/jobsAtascados.ts`. */
  created_at: string;
};

/**
 * Las cuatro etapas del motor, en el orden real del workflow de n8n:
 * Exacta → Difusa → Agrupación → IA (ver CLAUDE.md § Las capas de conciliación).
 */
const FASES = [
  {
    clave: "exacta",
    label: "Coincidencias exactas",
    detalle: "Mismo monto y mismo identificador de pago.",
  },
  {
    clave: "difusa",
    label: "Coincidencias aproximadas",
    detalle: "Montos y fechas dentro de tus tolerancias.",
  },
  {
    clave: "agrupacion",
    label: "Depósitos agrupados",
    detalle: "Un abono que junta varios de tus registros, o al revés.",
  },
  {
    clave: "ia",
    label: "Análisis con IA",
    detalle: "Propone los casos dudosos y explica cada diferencia.",
  },
];

function ordenFase(f: string | null): number {
  return FASES.findIndex((x) => x.clave === f);
}

export function ProgresoConciliacion({ jobInicial }: { jobInicial: JobRow }) {
  const [job, setJob] = useState<JobRow>(jobInicial);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`job-${jobInicial.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "jobs_conciliacion",
          filter: `id=eq.${jobInicial.id}`,
        },
        (payload) => setJob(payload.new as JobRow),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [jobInicial.id]);

  // Respaldo por polling: el flujo real de n8n hace UNA sola actualización al
  // final; si el navegador pierde ese único evento de Realtime (caída del
  // WebSocket durante la espera), Realtime no lo reenvía. El polling garantiza
  // que la pantalla transicione igual. Se detiene al completar o fallar.
  useEffect(() => {
    if (job.estado === "completado" || job.estado === "error") return;
    const supabase = createClient();
    const intervalo = setInterval(async () => {
      const { data } = await supabase
        .from("jobs_conciliacion")
        .select(
          "id, estado, fase_actual, resultado, error_detalle, periodo_desde, periodo_hasta, created_at",
        )
        .eq("id", jobInicial.id)
        .maybeSingle();
      if (data) setJob(data as JobRow);
    }, 3000);
    return () => clearInterval(intervalo);
  }, [job.estado, jobInicial.id]);

  // Al completarse (o fallar), recarga el server component para pasar a la
  // vista de revisión completa (ResultadoReview).
  useEffect(() => {
    if (job.estado === "completado" || job.estado === "error") router.refresh();
  }, [job.estado, router]);

  // Reloj propio: la salud del job depende del tiempo transcurrido, y sin un
  // tick la pantalla se quedaría diciendo "va bien" para siempre justo en el
  // caso en que nadie va a volver a tocarla.
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    if (job.estado === "completado" || job.estado === "error") return;
    const t = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(t);
  }, [job.estado]);

  const salud = saludDelJob(job.estado, job.created_at, ahora);
  const minutos = Math.floor(minutosDesde(job.created_at, ahora));

  const resumen = job.resultado?.resumen;

  // ── Error ─────────────────────────────────────────────────────────────
  if (job.estado === "error") {
    return (
      <Tarjeta tono="falla">
        <h2 className="font-semibold text-red-900">
          No se pudo completar la conciliación
        </h2>
        <p className="mt-1 text-sm text-red-800">
          {job.error_detalle ??
            "El motor no devolvió un resultado. Tus archivos no se han perdido: puedes volver a lanzarla."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/wizard" className={clasesBoton("primario", "sm")}>
            Intentar de nuevo
          </Link>
          <Link href="/conciliacion" className={clasesBoton("secundario", "sm")}>
            Volver al historial
          </Link>
        </div>
      </Tarjeta>
    );
  }

  // ── Completado pero sin resultado legible ─────────────────────────────
  // La página muestra la revisión cuando el resultado valida contra el
  // contrato. Si llegamos aquí es que terminó pero el JSON no encaja: hay que
  // decirlo, no fingir éxito.
  if (job.estado === "completado") {
    return (
      <Tarjeta tono="atencion">
        <h2 className="font-semibold text-amber-900">
          La conciliación terminó, pero el resultado no se puede mostrar
        </h2>
        <p className="mt-1 text-sm text-amber-900">
          El motor devolvió un resultado con un formato que esta pantalla no
          reconoce. Los datos siguen guardados; vuelve a lanzar la conciliación
          del período o revisa la ejecución en n8n.
        </p>
        {resumen && (
          <p className="mt-2 text-sm tabular-nums text-amber-900">
            Conteos recibidos: {resumen.conciliados_exactos ?? 0} exactos ·{" "}
            {resumen.conciliados_difusos ?? 0} aproximados ·{" "}
            {resumen.sugeridos_ia ?? 0} sugeridos.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/wizard" className={clasesBoton("primario", "sm")}>
            Lanzar de nuevo
          </Link>
          <Link href="/conciliacion" className={clasesBoton("secundario", "sm")}>
            Volver al historial
          </Link>
        </div>
      </Tarjeta>
    );
  }

  // ── Parece detenida ───────────────────────────────────────────────────
  // n8n responde en su SEGUNDO nodo, así que la aceptación no promete nada
  // sobre los ocho siguientes: puede aceptar y morir después. Sin esto, la
  // pantalla giraba indefinidamente y el período quedaba además bloqueado para
  // relanzarlo. No se afirma que haya fallado —no lo sabemos—, se dice lo que
  // se observa y se da salida.
  if (salud === "detenido") {
    return (
      <Tarjeta tono="atencion">
        <h2 className="font-semibold text-amber-900">
          Esta conciliación lleva {minutos} minutos sin terminar
        </h2>
        <p className="mt-1 text-sm text-amber-900">
          Un período de este tamaño suele resolverse en menos de un minuto, así
          que lo más probable es que el motor se haya interrumpido. Tus datos
          están guardados y no se ha modificado ningún saldo: puedes volver a
          lanzarla sobre el mismo período.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/wizard" className={clasesBoton("primario", "sm")}>
            Volver a lanzarla
          </Link>
          <Link href="/conciliacion" className={clasesBoton("secundario", "sm")}>
            Ver el historial
          </Link>
        </div>
      </Tarjeta>
    );
  }

  // ── En progreso ───────────────────────────────────────────────────────
  const idx = ordenFase(job.fase_actual);
  const enCola = job.estado === "pendiente" || idx === -1;
  const faseTexto = enCola
    ? "Preparando los datos"
    : (FASES[idx]?.label ?? "Procesando");

  return (
    <Tarjeta>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-blue-600"
        />
        <div>
          <h2 className="font-semibold text-neutral-900">
            Conciliando tu período…
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Puede tardar unos minutos según el volumen. Esta pantalla se
            actualiza sola; puedes cerrarla y volver desde el historial.
          </p>
          {/* Antes de dar nada por perdido, decirlo. Que la espera se alargue
              sin explicación es lo que hace pensar que el sistema se colgó. */}
          {salud === "lento" && (
            <p className="mt-2 text-sm font-medium text-amber-800">
              Lleva {minutos} minutos: más de lo habitual. Sigue en marcha —
              esperamos un poco más antes de darla por interrumpida.
            </p>
          )}
        </div>
      </div>

      {/* Barra indeterminada: no sabemos cuánto falta, y fingir un porcentaje
          sería mentir sobre el estado. */}
      <div className="relative mt-5 h-1.5 overflow-hidden rounded-full bg-neutral-100 text-blue-600">
        <div className="ci-avance absolute inset-0" />
      </div>

      {/* Un solo anuncio para lectores de pantalla cuando cambia la fase. */}
      <p aria-live="polite" className="sr-only">
        {faseTexto}
      </p>

      <ol className="mt-5 space-y-3">
        {FASES.map((fase, i) => {
          const hecha = idx > i;
          const activa = idx === i;
          const conteo =
            fase.clave === "exacta"
              ? resumen?.conciliados_exactos
              : fase.clave === "difusa"
                ? resumen?.conciliados_difusos
                : fase.clave === "ia"
                  ? resumen?.sugeridos_ia
                  : undefined;
          return (
            <li key={fase.clave} className="flex items-start gap-3">
              <span
                aria-hidden
                className={[
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  hecha
                    ? "bg-emerald-600 text-white"
                    : activa
                      ? "bg-blue-600 text-white"
                      : "border border-neutral-300 text-neutral-500",
                ].join(" ")}
              >
                {hecha ? "✓" : i + 1}
              </span>
              <div className="min-w-0">
                <p
                  className={[
                    "text-sm",
                    activa
                      ? "font-semibold text-neutral-900"
                      : hecha
                        ? "font-medium text-neutral-800"
                        : "text-neutral-600",
                  ].join(" ")}
                >
                  {fase.label}
                  {hecha && conteo != null && (
                    <span className="ml-1.5 font-normal tabular-nums text-neutral-600">
                      · {conteo}
                    </span>
                  )}
                  {activa && (
                    <span className="ml-1.5 font-normal text-blue-700">
                      · en curso
                    </span>
                  )}
                </p>
                {(activa || !hecha) && (
                  <p className="text-xs text-neutral-600">{fase.detalle}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 border-t border-neutral-200 pt-4">
        <p className="text-sm text-neutral-600">
          ¿Ya terminó en n8n y la pantalla no cambia?
        </p>
        <Boton
          variante="secundario"
          tamano="sm"
          onClick={() => router.refresh()}
          className="mt-2"
        >
          Buscar el resultado ahora
        </Boton>
      </div>
    </Tarjeta>
  );
}
