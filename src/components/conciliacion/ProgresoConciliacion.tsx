"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatearPEN } from "@/lib/parsing/resumen";
import type { EstadoJob } from "@/lib/contract/enums";
import type { ResultadoConciliacion } from "@/lib/contract/resultado";

export type JobRow = {
  id: string;
  estado: EstadoJob;
  fase_actual: string | null;
  resultado: Partial<ResultadoConciliacion> | null;
  error_detalle: string | null;
  periodo_desde: string;
  periodo_hasta: string;
};

const FASES = [
  { clave: "exacta", label: "Conciliación exacta" },
  { clave: "difusa", label: "Conciliación difusa" },
  { clave: "ia", label: "Análisis con IA" },
];

function ordenFase(f: string | null): number {
  const i = FASES.findIndex((x) => x.clave === f);
  return i === -1 ? -1 : i;
}

export function ProgresoConciliacion({ jobInicial }: { jobInicial: JobRow }) {
  const [job, setJob] = useState<JobRow>(jobInicial);

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

  const resumen = job.resultado?.resumen;
  const cuadre = job.resultado?.cuadre;

  // ── Error ───────────────────────────────────────────────────────────
  if (job.estado === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <p className="font-semibold text-red-800">Ocurrió un error</p>
        <p className="mt-1 text-sm text-red-700">
          {job.error_detalle ?? "No se pudo completar la conciliación."}
        </p>
        <Link
          href="/wizard"
          className="mt-4 inline-block rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Reintentar
        </Link>
      </div>
    );
  }

  // ── Completado ──────────────────────────────────────────────────────
  if (job.estado === "completado" && resumen) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="font-semibold text-emerald-900">
            ✓ Conciliación completada
          </p>
          <p className="mt-1 text-sm text-emerald-700">
            {resumen.conciliados_exactos + resumen.conciliados_difusos} de{" "}
            {resumen.total_internos} registros conciliados automáticamente.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tarjeta label="Exactos" valor={resumen.conciliados_exactos} />
          <Tarjeta label="Difusos" valor={resumen.conciliados_difusos} />
          <Tarjeta
            label="Sugeridos IA"
            valor={resumen.sugeridos_ia}
            tono="ia"
          />
          <Tarjeta
            label="Sin conciliar"
            valor={
              resumen.sin_conciliar_internos + resumen.sin_conciliar_bancarios
            }
            tono="alerta"
          />
        </div>

        {cuadre && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-5">
            <p className="font-semibold text-neutral-900">Cuadre de saldos</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Linea label="Saldo extracto final" valor={cuadre.saldo_extracto_final} />
              <Linea label="+ Depósitos en tránsito" valor={cuadre.depositos_en_transito} />
              <Linea label="− Cheques no cobrados" valor={cuadre.cheques_no_cobrados} />
              <Linea label="± Cargos no registrados" valor={cuadre.cargos_no_registrados} />
              <div className="my-2 border-t border-neutral-200" />
              <Linea label="Saldo banco ajustado" valor={cuadre.saldo_banco_ajustado} fuerte />
              <Linea label="Saldo según libros" valor={cuadre.saldo_libros_final} fuerte />
              <Linea
                label="Diferencia"
                valor={cuadre.diferencia}
                fuerte
                resaltar
              />
            </dl>
          </div>
        )}

        <p className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
          La revisión detallada (dos paneles, cola de IA, conciliación manual y
          exportación) llega en la Fase 6.
        </p>
      </div>
    );
  }

  // ── En progreso ─────────────────────────────────────────────────────
  const faseActualIdx = ordenFase(job.fase_actual);
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full bg-blue-600" />
        <p className="font-semibold text-neutral-900">
          Procesando conciliación…
        </p>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Esto puede tardar unos segundos. La pantalla se actualiza sola.
      </p>

      <ol className="mt-5 space-y-3">
        {FASES.map((fase, i) => {
          const hecha = faseActualIdx > i;
          const activa = faseActualIdx === i;
          const conteo =
            fase.clave === "exacta"
              ? resumen?.conciliados_exactos
              : fase.clave === "difusa"
                ? resumen?.conciliados_difusos
                : resumen?.sugeridos_ia;
          return (
            <li key={fase.clave} className="flex items-center gap-3">
              <span
                className={[
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                  hecha
                    ? "bg-emerald-600 text-white"
                    : activa
                      ? "bg-blue-600 text-white"
                      : "border border-neutral-300 text-neutral-400",
                ].join(" ")}
              >
                {hecha ? "✓" : i + 1}
              </span>
              <span
                className={
                  activa || hecha ? "text-neutral-900" : "text-neutral-400"
                }
              >
                {fase.label}
              </span>
              {(hecha || activa) && conteo != null && (
                <span className="text-sm text-neutral-500">
                  · {conteo} {activa ? "procesando…" : "conciliados"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Tarjeta({
  label,
  valor,
  tono,
}: {
  label: string;
  valor: number;
  tono?: "ia" | "alerta";
}) {
  const color =
    tono === "ia"
      ? "text-blue-700"
      : tono === "alerta"
        ? "text-amber-700"
        : "text-neutral-900";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{valor}</p>
    </div>
  );
}

function Linea({
  label,
  valor,
  fuerte,
  resaltar,
}: {
  label: string;
  valor: number;
  fuerte?: boolean;
  resaltar?: boolean;
}) {
  const cero = Math.abs(valor) < 0.005;
  return (
    <div className="flex items-center justify-between">
      <dt className={fuerte ? "font-medium text-neutral-800" : "text-neutral-600"}>
        {label}
      </dt>
      <dd
        className={[
          "tabular-nums",
          fuerte ? "font-semibold" : "",
          resaltar ? (cero ? "text-emerald-700" : "text-red-600") : "text-neutral-900",
        ].join(" ")}
      >
        {formatearPEN(valor)}
      </dd>
    </div>
  );
}
