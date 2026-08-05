"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarCriterios } from "@/app/(app)/aprendizaje/actions";
import {
  CRITERIOS_INICIALES,
  faseAprendizaje,
  DECISIONES_PARA_CALIBRAR,
} from "@/lib/criteriosIniciales";
import { Boton } from "@/components/ui";

/**
 * Arranque en frío: enséñale tu criterio antes de tener historial.
 *
 * Es la respuesta al peor problema comercial del módulo: una empresa nueva no
 * ha decidido nada, y eso ocurre durante los 30 días de prueba —el momento
 * exacto en que juzga si el producto vale—. Aquí puede declarar cómo trabaja y
 * la IA lo usa desde la primera conciliación.
 *
 * La barra de progreso NO es adorno: convierte una espera opaca ("algún día
 * aprenderá") en una meta con final visible, y de paso explica por qué conviene
 * revisar las sugerencias en vez de despacharlas en lote.
 */
export function CriteriosIniciales({
  seleccionados,
  decisiones,
}: {
  seleccionados: string[];
  decisiones: number;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set(seleccionados));
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const fase = faseAprendizaje(decisiones);

  function alternar(id: string) {
    setGuardado(false);
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function guardar() {
    setError(null);
    startTransition(async () => {
      const res = await guardarCriterios([...sel]);
      if (!res.ok) {
        setError(res.error ?? "No se pudo guardar.");
        return;
      }
      setGuardado(true);
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="h-criterios"
      className="rounded-2xl border border-neutral-200 bg-white p-5"
    >
      <h2 id="h-criterios" className="font-semibold text-neutral-900">
        Enséñale tu criterio
      </h2>
      <p className="mt-0.5 max-w-prose text-sm text-neutral-600">
        Mientras la IA acumula tus decisiones, dile cómo trabaja tu empresa.
        Marca lo que sea cierto en tu caso; lo usará desde la próxima
        conciliación.
      </p>

      {/* El estado de calibración, dicho sin rodeos. Un cliente en prueba
          merece saber que lo que está viendo todavía no es el producto en
          régimen — y cuánto le falta. */}
      {fase.fase !== "calibrada" && (
        <div className="mt-4 rounded-xl bg-violet-50 px-4 py-3">
          <p className="text-sm text-violet-900">
            {fase.fase === "sin_datos" ? (
              <>
                <span className="font-medium">Fase de entrenamiento.</span>{" "}
                Todavía no has revisado ninguna sugerencia, así que la IA solo
                cuenta con lo que declares aquí.
              </>
            ) : (
              <>
                <span className="font-medium">Fase de entrenamiento.</span>{" "}
                Llevas{" "}
                <span className="tabular-nums">{fase.decisiones}</span> de{" "}
                <span className="tabular-nums">{DECISIONES_PARA_CALIBRAR}</span>{" "}
                decisiones. Faltan{" "}
                <span className="tabular-nums">{fase.faltan}</span> para que tu
                criterio real mande sobre lo declarado.
              </>
            )}
          </p>
          <div
            className="mt-2 h-2 rounded-full bg-violet-100"
            role="img"
            aria-label={`${fase.progreso}% del entrenamiento`}
          >
            <div
              className="h-2 rounded-full bg-violet-600"
              style={{ width: `${Math.max(fase.progreso, 2)}%` }}
            />
          </div>
        </div>
      )}

      {fase.fase === "calibrada" && (
        <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="font-medium">Ya está calibrada con tus datos.</span>{" "}
          Tus {fase.decisiones} decisiones mandan sobre lo que declares aquí;
          esto se mantiene solo como apoyo.
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {CRITERIOS_INICIALES.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 p-3 transition-colors hover:bg-neutral-50 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-50/60 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-500">
              <input
                type="checkbox"
                checked={sel.has(c.id)}
                onChange={() => alternar(c.id)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-400 accent-violet-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-neutral-800">
                  {c.label}
                </span>
                <span className="block text-sm text-neutral-600">{c.ayuda}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div aria-live="polite" className="mt-3">
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {guardado && !error && (
          <p className="text-sm text-emerald-800">
            Guardado. Se aplicará en tu próxima conciliación.
          </p>
        )}
      </div>

      <div className="mt-3">
        <Boton onClick={guardar} disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar mi criterio"}
        </Boton>
      </div>
    </section>
  );
}
