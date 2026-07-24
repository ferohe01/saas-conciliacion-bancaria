"use client";

import { useState, useTransition } from "react";
import { eliminarCuenta } from "@/app/(app)/cuentas/actions";
import { BancoIcon } from "@/components/wizard/icons";

export type Cuenta = {
  id: string;
  banco: string;
  numero_enmascarado: string | null;
  moneda: string;
};

export function CuentaItem({ cuenta }: { cuenta: Cuenta }) {
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onEliminar() {
    if (!confirm(`¿Eliminar la cuenta ${cuenta.banco}?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await eliminarCuenta(cuenta.id);
      if (!res.ok) setError(res.error ?? "No se pudo eliminar.");
    });
  }

  return (
    <li className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
          <BancoIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="font-medium text-neutral-900">
            {cuenta.banco}{" "}
            <span className="text-neutral-400">
              {cuenta.numero_enmascarado ?? ""}
            </span>
          </p>
          <p className="text-sm text-neutral-500">
            {cuenta.moneda === "USD" ? "Dólares (USD)" : "Soles (PEN)"}
          </p>
          {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={onEliminar}
        disabled={pendiente}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
      >
        {pendiente ? "Eliminando…" : "Eliminar"}
      </button>
    </li>
  );
}
