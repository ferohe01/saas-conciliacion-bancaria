"use client";

import { useActionState, useEffect, useRef } from "react";
import { crearCuenta, type AccionResultado } from "@/app/(app)/cuentas/actions";

const BANCOS = ["BCP", "BBVA", "Interbank", "Scotiabank", "BanBif", "Otro"];

const ESTADO_INICIAL: AccionResultado = { ok: false };

export function CuentaForm() {
  const [estado, formAction, pendiente] = useActionState(
    crearCuenta,
    ESTADO_INICIAL,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado.ok) formRef.current?.reset();
  }, [estado.ok]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <p className="font-semibold text-neutral-900">Agregar cuenta</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            Banco
          </span>
          <select
            name="banco"
            required
            className="h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-neutral-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          >
            {BANCOS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            Número (opcional)
          </span>
          <input
            name="numero"
            inputMode="numeric"
            placeholder="Solo dígitos"
            className="h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-neutral-800 shadow-sm placeholder:text-neutral-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            Moneda
          </span>
          <select
            name="moneda"
            defaultValue="PEN"
            className="h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-neutral-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          >
            <option value="PEN">Soles (PEN)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </label>
      </div>

      {estado.error && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {estado.error}
        </p>
      )}

      <div className="mt-4">
        <button
          type="submit"
          disabled={pendiente}
          className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {pendiente ? "Guardando…" : "Agregar cuenta"}
        </button>
      </div>
    </form>
  );
}
