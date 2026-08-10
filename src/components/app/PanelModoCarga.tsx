"use client";

import { useState, useTransition } from "react";
import { guardarModoCarga } from "@/app/(app)/configuracion/actions";
import {
  ETIQUETA_MODO,
  DESCRIPCION_MODO,
  AVISO_ARCHIVO_PROPIO,
  type ModoCarga,
} from "@/lib/modoCarga";
import { Boton } from "@/components/ui";

/**
 * Cómo carga sus comprobantes esta empresa.
 *
 * ⚠️ **Vive en Configuración, NO en el flujo de carga.** Es la decisión de
 * diseño que sostiene todo lo demás: si la opción apareciera al subir un
 * archivo, cualquier PyME que se topase con un rechazo la activaría para salir
 * del paso —y acabaría eligiendo columnas a mano, que es justo lo que este modo
 * evita—. Aquí hay que venir a buscarla, leerla y decidirla.
 *
 * ⚠️ Y el aviso al activarla no es un trámite: quien la enciende se hace cargo
 * de que las columnas estén bien elegidas, y ese error **no da la cara hasta la
 * conciliación**.
 */
export function PanelModoCarga({ actual }: { actual: ModoCarga }) {
  const [modo, setModo] = useState<ModoCarga>(actual);
  const [guardando, startGuardado] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const cambiar = (nuevo: ModoCarga) => {
    setError(null);
    setAviso(null);
    // Pasar al modo abierto se confirma; volver a la plantilla no, porque
    // volver a lo seguro nunca necesita una advertencia.
    if (nuevo === "archivo_propio" && modo !== "archivo_propio") {
      setConfirmando(true);
      return;
    }
    guardar(nuevo);
  };

  const guardar = (nuevo: ModoCarga) => {
    setConfirmando(false);
    startGuardado(async () => {
      const r = await guardarModoCarga(nuevo);
      if (!r.ok) {
        setError(r.error ?? "No se pudo guardar.");
        return;
      }
      setModo(nuevo);
      setAviso("Listo. Se aplica a partir de la próxima carga.");
    });
  };

  const opciones: ModoCarga[] = ["plantilla", "archivo_propio"];

  return (
    <section aria-labelledby="h-modo" className="space-y-3">
      <div>
        <h2 id="h-modo" className="font-semibold text-neutral-900">
          Cómo cargas tus comprobantes
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Con la plantilla es más simple y no hay forma de equivocarse. La otra
          opción es para quien factura desde un sistema y no puede rehacer el
          archivo cada mes.
        </p>
      </div>

      <ul className="space-y-3">
        {opciones.map((o) => {
          const activo = modo === o;
          return (
            <li key={o}>
              <button
                type="button"
                onClick={() => cambiar(o)}
                disabled={guardando}
                aria-pressed={activo}
                className={`block w-full rounded-2xl border p-5 text-left transition-colors ${
                  activo
                    ? "border-neutral-900 bg-white"
                    : "border-neutral-200 bg-white hover:bg-neutral-50"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-neutral-900">
                    {ETIQUETA_MODO[o]}
                  </span>
                  {activo && (
                    <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs font-medium text-white">
                      En uso
                    </span>
                  )}
                  {o === "plantilla" && (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600">
                      Recomendado
                    </span>
                  )}
                </div>
                <p className="mt-1.5 max-w-prose text-sm text-neutral-600">
                  {DESCRIPCION_MODO[o]}
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      {confirmando && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="font-medium text-amber-900">
            ¿Seguro que quieres subir tu propio archivo?
          </p>
          <p className="mt-1 max-w-prose text-sm text-amber-900">
            {AVISO_ARCHIVO_PROPIO}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Boton tamano="sm" onClick={() => guardar("archivo_propio")}>
              Sí, uso mi propio archivo
            </Boton>
            <Boton
              tamano="sm"
              variante="secundario"
              onClick={() => setConfirmando(false)}
            >
              Mejor no
            </Boton>
          </div>
        </div>
      )}

      {aviso && (
        <p role="status" className="text-sm text-neutral-700">
          {aviso}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
