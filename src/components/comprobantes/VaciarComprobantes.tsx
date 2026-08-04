"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { vaciarComprobantes } from "@/app/(app)/wizard/actions";
import { CONFIRMACION_VACIAR } from "@/lib/importacion";
import { Boton, CLASES_ENTRADA } from "@/components/ui";

/**
 * Reinicio de comprobantes.
 *
 * Va plegado y al final de la pantalla —no compite con lo que se usa a diario—
 * y exige escribir la palabra. Es la única acción del producto que borra datos
 * en masa: un clic accidental no debería poder dispararla, y un botón rojo
 * suelto entre filtros acabaría pulsado por error tarde o temprano.
 *
 * Lo conciliado nunca se borra; el servidor lo protege y aquí se avisa antes.
 */
export function VaciarComprobantes({ total }: { total: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [palabra, setPalabra] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function vaciar() {
    setError(null);
    startTransition(async () => {
      const res = await vaciarComprobantes(palabra);
      if (!res.ok) {
        setError(res.error ?? "No se pudieron borrar.");
        return;
      }
      setHecho(
        res.protegidos
          ? `Se borraron ${res.borrados} comprobantes. ${res.protegidos} se conservaron porque ya tienen cobros aplicados: esos se anulan desde su ficha, no se borran.`
          : `Se borraron ${res.borrados} comprobantes.`,
      );
      setPalabra("");
      setAbierto(false);
      router.refresh();
    });
  }

  if (total === 0 && !hecho) return null;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-neutral-900">Empezar de cero</h2>
          <p className="mt-0.5 max-w-prose text-sm text-neutral-600">
            Borra todos tus comprobantes para volver a cargarlos. Los que ya
            entraron en una conciliación se conservan.
          </p>
        </div>
        {!abierto && (
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={() => {
              setAbierto(true);
              setHecho(null);
            }}
          >
            Borrar todos
          </Boton>
        )}
      </div>

      {abierto && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-900">
            Se borrarán{" "}
            <span className="font-semibold tabular-nums">
              {total.toLocaleString("es-PE")}
            </span>{" "}
            {total === 1 ? "comprobante" : "comprobantes"}. No se puede deshacer.
            Escribe <strong>{CONFIRMACION_VACIAR}</strong> para confirmar.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="confirmar-vaciar">
              Escribe {CONFIRMACION_VACIAR} para confirmar
            </label>
            <input
              id="confirmar-vaciar"
              value={palabra}
              onChange={(e) => setPalabra(e.target.value)}
              placeholder={CONFIRMACION_VACIAR}
              autoComplete="off"
              className={`${CLASES_ENTRADA} w-40`}
            />
            <Boton
              variante="secundario"
              onClick={vaciar}
              disabled={pendiente || palabra.trim().toUpperCase() !== CONFIRMACION_VACIAR}
            >
              {pendiente ? "Borrando…" : "Sí, borrar todos"}
            </Boton>
            <Boton
              variante="secundario"
              onClick={() => {
                setAbierto(false);
                setPalabra("");
                setError(null);
              }}
              disabled={pendiente}
            >
              Cancelar
            </Boton>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-800">
              {error}
            </p>
          )}
        </div>
      )}

      {hecho && (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {hecho}
        </p>
      )}
    </section>
  );
}
