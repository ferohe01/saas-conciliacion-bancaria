"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/ui";
import {
  cambiarEstadoContable,
  impactoDeAprobar,
} from "@/app/(app)/conciliacion/[jobId]/actions";
import {
  accionesPosibles,
  puedeAprobarse,
  avisoDeReemplazo,
  ETIQUETA,
  EXPLICACION,
  type AccionContable,
  type EstadoContable,
} from "@/lib/cicloContable";

/**
 * DIRECCIÓN — Estado contable de una conciliación
 *
 * THESIS: la pregunta que resuelve esta franja no es "¿terminó de procesarse?"
 * sino "¿esta conciliación vale?". Va arriba del todo porque condiciona el
 * sentido de todo lo que hay debajo: revisar sugerencias de un documento
 * anulado es trabajo perdido.
 * STORY: el usuario ve en qué punto está, qué significa en su idioma, y qué
 * puede hacer al respecto. Aprobar dice de antemano lo que va a pasar con el
 * saldo, porque es el efecto que no se ve en esta pantalla.
 */

const TONO: Record<EstadoContable, { caja: string; punto: string; texto: string }> = {
  borrador: {
    caja: "border-neutral-200 bg-white",
    punto: "bg-neutral-400",
    texto: "text-neutral-700",
  },
  en_proceso: {
    caja: "border-neutral-200 bg-white",
    punto: "bg-neutral-400",
    texto: "text-neutral-700",
  },
  observada: {
    caja: "border-amber-200 bg-amber-50",
    punto: "bg-amber-500",
    texto: "text-amber-900",
  },
  aprobada: {
    caja: "border-emerald-200 bg-emerald-50",
    punto: "bg-emerald-600",
    texto: "text-emerald-900",
  },
  anulada: {
    caja: "border-neutral-200 bg-neutral-50",
    punto: "bg-neutral-400",
    texto: "text-neutral-600",
  },
  reemplazada: {
    caja: "border-neutral-200 bg-neutral-50",
    punto: "bg-neutral-400",
    texto: "text-neutral-600",
  },
};

const ETIQUETA_ACCION: Record<AccionContable, string> = {
  aprobar: "Aprobar",
  observar: "Marcar como observada",
  anular: "Anular",
  reabrir: "Volver a borrador",
};

/** Las que piden confirmación explícita: descartan trabajo o mueven dinero. */
const CONFIRMA: Partial<Record<AccionContable, string>> = {
  anular:
    "Se descartará esta conciliación y dejará de contar. Si estaba aprobada, el saldo de los comprobantes que descontó volverá atrás. ¿Continuar?",
  observar:
    "Dejará de regir mientras esté observada, y el saldo que hubiera descontado volverá atrás. ¿Continuar?",
};

export function EstadoContablePanel({
  jobId,
  estadoContable,
  estadoTecnico,
  version,
  fechaAprobacion,
  hayVersionesPrevias,
}: {
  jobId: string;
  estadoContable: EstadoContable;
  estadoTecnico: string;
  version: number;
  fechaAprobacion: string | null;
  hayVersionesPrevias: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const tono = TONO[estadoContable];
  const acciones = accionesPosibles(estadoContable);
  const permisoAprobar = puedeAprobarse(estadoContable, estadoTecnico);

  function ejecutar(accion: AccionContable) {
    const confirmacion = CONFIRMA[accion];
    if (confirmacion && !window.confirm(confirmacion)) return;

    setError(null);
    setAviso(null);
    startTransition(async () => {
      // Aprobar es la única acción cuyo aviso depende de datos: solo hay algo
      // que advertir si existe otra aprobada que se cruce con este rango. Por
      // eso se consulta antes de preguntar, en vez de un texto fijo — y si no
      // hay nada que reemplazar no se pregunta nada, para que el diálogo no se
      // vuelva un trámite que se despacha sin leer.
      if (accion === "aprobar") {
        const impacto = await impactoDeAprobar(jobId);
        const texto = avisoDeReemplazo(impacto);
        if (texto && !window.confirm(texto)) return;
      }
      const r = await cambiarEstadoContable(jobId, accion);
      if (!r.ok) {
        setError(r.error ?? "No se pudo completar la acción.");
        return;
      }
      if (accion === "aprobar") {
        setAviso(
          r.reemplazadas
            ? `Aprobada. Se reemplazó ${r.reemplazadas === 1 ? "la versión anterior" : `${r.reemplazadas} versiones anteriores`} de este período.`
            : "Aprobada. Ya descuenta el saldo de tus comprobantes.",
        );
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="h-estado-contable"
      className={`rounded-2xl border p-5 ${tono.caja}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden className={`h-2 w-2 rounded-full ${tono.punto}`} />
            <h2
              id="h-estado-contable"
              className={`font-semibold ${tono.texto}`}
            >
              {ETIQUETA[estadoContable]}
            </h2>
            {(version > 1 || hayVersionesPrevias) && (
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium tabular-nums text-neutral-600 ring-1 ring-neutral-200">
                versión {version}
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-prose text-sm text-neutral-700">
            {EXPLICACION[estadoContable]}
          </p>
          {estadoContable === "aprobada" && fechaAprobacion && (
            <p className="mt-1 text-xs text-neutral-600">
              Aprobada el{" "}
              <span className="tabular-nums">
                {new Date(fechaAprobacion).toLocaleString("es-PE", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
              .
            </p>
          )}
        </div>

        {acciones.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {acciones.map((a) => {
              const esAprobar = a === "aprobar";
              const bloqueada = esAprobar && !permisoAprobar.ok;
              return (
                <Boton
                  key={a}
                  variante={
                    esAprobar ? "confirmar" : a === "anular" ? "peligro" : "secundario"
                  }
                  tamano="sm"
                  disabled={pendiente || bloqueada}
                  title={bloqueada && !permisoAprobar.ok ? permisoAprobar.motivo : undefined}
                  onClick={() => ejecutar(a)}
                >
                  {ETIQUETA_ACCION[a]}
                </Boton>
              );
            })}
          </div>
        )}
      </div>

      {/* El efecto de aprobar no se ve en esta pantalla, así que se anuncia. */}
      {estadoContable !== "aprobada" && permisoAprobar.ok && (
        <p className="mt-4 border-t border-neutral-200/70 pt-3 text-sm text-neutral-600">
          Al aprobarla pasará a ser la conciliación que vale para este período y
          se descontará el saldo de los comprobantes cobrados.
          {hayVersionesPrevias &&
            " La versión anterior quedará marcada como reemplazada, sin borrarse."}
        </p>
      )}

      {aviso && (
        <p
          role="status"
          className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900"
        >
          {aviso}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}
    </section>
  );
}
