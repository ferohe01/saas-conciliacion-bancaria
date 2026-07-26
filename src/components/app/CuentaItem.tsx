"use client";

import { useState, useTransition } from "react";
import { eliminarCuenta } from "@/app/(app)/cuentas/actions";
import { BancoIcon } from "@/components/wizard/icons";
import { Boton } from "@/components/ui";

export type Cuenta = {
  id: string;
  banco: string;
  numero_enmascarado: string | null;
  moneda: string;
};

export function CuentaItem({ cuenta }: { cuenta: Cuenta }) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  function onEliminar() {
    setError(null);
    startTransition(async () => {
      const res = await eliminarCuenta(cuenta.id);
      if (!res.ok) {
        setError(res.error ?? "No se pudo eliminar la cuenta.");
        setConfirmando(false);
      }
    });
  }

  return (
    <li className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-asiento">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
            <BancoIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-neutral-900">
              {cuenta.banco}{" "}
              <span className="tabular-nums text-neutral-600">
                {cuenta.numero_enmascarado ?? ""}
              </span>
            </p>
            <p className="text-sm text-neutral-600">
              {cuenta.moneda === "USD" ? "Dólares (USD)" : "Soles (PEN)"}
            </p>
          </div>
        </div>

        {/* Confirmación en línea en vez de `confirm()` del navegador: se lee en
            el contexto de la fila y funciona con teclado como el resto. */}
        {confirmando ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-neutral-700">
              ¿Eliminar esta cuenta?
            </span>
            <Boton
              variante="peligro"
              tamano="sm"
              disabled={pendiente}
              onClick={onEliminar}
            >
              {pendiente ? "Eliminando…" : "Sí, eliminar"}
            </Boton>
            <Boton
              variante="secundario"
              tamano="sm"
              disabled={pendiente}
              onClick={() => setConfirmando(false)}
            >
              Cancelar
            </Boton>
          </div>
        ) : (
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={() => setConfirmando(true)}
          >
            Eliminar
          </Boton>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}
