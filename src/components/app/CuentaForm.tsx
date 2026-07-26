"use client";

import { useActionState, useEffect, useRef } from "react";
import { crearCuenta, type AccionResultado } from "@/app/(app)/cuentas/actions";
import { Boton, Campo, Tarjeta } from "@/components/ui";

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
    <Tarjeta>
      <form ref={formRef} action={formAction}>
        <h2 className="font-semibold text-neutral-900">Agregar una cuenta</h2>
        <p className="mt-0.5 text-sm text-neutral-600">
          Solo el banco y la moneda. El número es opcional y se guarda
          enmascarado.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Campo label="Banco" name="banco">
            {(p) => (
              <select {...p} required>
                {BANCOS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            )}
          </Campo>

          <Campo
            label="Número"
            name="numero"
            nota="opcional"
            ayuda="Solo los dígitos; guardamos los 4 últimos."
          >
            {(p) => (
              <input
                {...p}
                inputMode="numeric"
                placeholder="Ej. 1234567890"
                className={`${p.className} tabular-nums`}
              />
            )}
          </Campo>

          <Campo label="Moneda" name="moneda">
            {(p) => (
              <select {...p} defaultValue="PEN">
                <option value="PEN">Soles (PEN)</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            )}
          </Campo>
        </div>

        {estado.error && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
          >
            {estado.error}
          </p>
        )}

        <div className="mt-4">
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? "Guardando…" : "Agregar cuenta"}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
