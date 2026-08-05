"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { excluirDelAprendizaje } from "@/app/(app)/aprendizaje/actions";
import type { EjemploConOrigen } from "@/lib/aprendizaje";

/**
 * Los ejemplos que la IA está leyendo ahora mismo, y el botón para quitar uno.
 *
 * Es la "configuración" del módulo, pero de curación y no de perillas: el
 * aprendizaje se degrada por ejemplos malos —una aceptación hecha de trámite
 * enseña a aceptar de trámite— y eso no se arregla ajustando cuántos ejemplos
 * se mandan, sino quitando el que está mal.
 *
 * ⚠️ Quitar un ejemplo NO deshace la decisión ni toca la conciliación. El texto
 * lo dice explícitamente: confundir ambas cosas —creer que esto revierte un
 * cobro— sería un error caro y perfectamente posible.
 */
export function CuracionEjemplos({
  ejemplos,
}: {
  ejemplos: EjemploConOrigen[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function quitar(jobId: string, matchIndex: number) {
    setError(null);
    startTransition(async () => {
      const res = await excluirDelAprendizaje(jobId, matchIndex, true);
      if (!res.ok) setError(res.error ?? "No se pudo quitar el ejemplo.");
      else router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="h-curacion"
      className="rounded-2xl border border-neutral-200 bg-white p-5"
    >
      <h2 id="h-curacion" className="font-semibold text-neutral-900">
        Lo que la IA está leyendo
      </h2>
      <p className="mt-0.5 max-w-prose text-sm text-neutral-600">
        Estos son los ejemplos exactos que se le envían en cada conciliación. Si
        alguno enseña algo que no querías, quítalo.
      </p>

      {ejemplos.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          Todavía no hay ejemplos. Aparecerán en cuanto revises sugerencias.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {ejemplos.map((e) => {
            const acepto = e.ejemplo.decision === "aceptado";
            return (
              <li
                key={`${e.jobId}-${e.matchIndex}`}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-xl border border-neutral-200 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {/* La palabra, no solo el color. */}
                    <span
                      className={acepto ? "text-emerald-800" : "text-rose-700"}
                    >
                      {acepto ? "Aceptaste" : "Rechazaste"}
                    </span>
                    {e.ejemplo.motivo && (
                      <span className="text-neutral-500">
                        {" "}
                        · {e.ejemplo.motivo}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 truncate font-mono text-xs text-neutral-700">
                    {e.ejemplo.interno}
                  </p>
                  <p className="truncate font-mono text-xs text-neutral-500">
                    ↔ {e.ejemplo.banco}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {e.jobId && (
                    <Link
                      href={`/conciliacion/${e.jobId}`}
                      className="rounded text-xs text-blue-700 underline underline-offset-2 hover:text-blue-800"
                    >
                      Ver origen
                    </Link>
                  )}
                  <button
                    type="button"
                    disabled={pendiente || !e.jobId}
                    onClick={() => quitar(e.jobId, e.matchIndex)}
                    className="min-h-9 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    No aprendas de esto
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-neutral-500">
        Quitar un ejemplo no deshace la decisión ni cambia la conciliación: solo
        deja de usarse para enseñar.
      </p>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
