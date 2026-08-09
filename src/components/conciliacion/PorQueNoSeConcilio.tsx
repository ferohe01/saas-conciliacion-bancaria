"use client";

import { useState } from "react";
import { porQueNoSeConcilio } from "@/app/(app)/conciliacion/[jobId]/actions";
import type { Diagnostico } from "@/lib/diagnosticoPartida";
import { formatearFecha, formatearPEN } from "@/lib/parsing/resumen";

/**
 * «¿Por qué?» de una partida sin conciliar.
 *
 * ⚠️ **Bajo demanda y de una en una.** Nadie va a leer 4.382 explicaciones, y
 * calcularlas todas devolvería el problema de escala que la parte B vino a
 * eliminar. Se pide al pinchar, que es cuando alguien está mirando esa fila.
 *
 * ⚠️ **No se guarda: se recalcula.** Los datos cambian —una conciliación manual
 * ocupa un movimiento, una aprobación mueve saldos— y un diagnóstico congelado
 * envejecería mintiendo.
 *
 * Se despliega en la misma fila en vez de abrir un modal: el usuario está
 * recorriendo una lista y sacarlo de ella rompe el barrido.
 */
export function PorQueNoSeConcilio({
  jobId,
  partidaId,
  moneda,
}: {
  jobId: string;
  partidaId: string;
  moneda: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [dx, setDx] = useState<Diagnostico | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function abrir() {
    if (abierto) {
      setAbierto(false);
      return;
    }
    setAbierto(true);
    if (dx || cargando) return; // ya se pidió: no se vuelve a preguntar
    setCargando(true);
    setError(null);
    try {
      const r = await porQueNoSeConcilio(jobId, partidaId);
      if (r.ok) setDx(r.diagnostico);
      else setError(r.error);
    } catch {
      setError("No se pudo analizar esta partida.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={abrir}
        aria-expanded={abierto}
        className="rounded text-xs font-medium text-blue-700 underline underline-offset-2 transition-colors hover:text-blue-800"
      >
        {abierto ? "Ocultar" : "¿Por qué?"}
      </button>

      {abierto && (
        <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs">
          {cargando && <p className="text-neutral-600">Analizando…</p>}
          {error && <p className="text-red-800">{error}</p>}
          {dx && (
            <>
              <p className="font-medium text-neutral-900">{dx.titulo}</p>
              <p className="mt-1 text-neutral-700">{dx.detalle}</p>
              {dx.accion && (
                <p className="mt-1.5 font-medium text-neutral-800">{dx.accion}</p>
              )}
              {dx.evidencia.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-neutral-200 pt-2">
                  {dx.evidencia.map((e) => (
                    <li key={e.id} className="text-neutral-600">
                      <span className="tabular-nums">
                        {formatearFecha(e.fecha)} ·{" "}
                        {formatearPEN(e.monto, moneda)}
                      </span>
                      {e.texto ? ` · ${e.texto}` : ""}
                      {e.referencia ? ` · ${e.referencia}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
