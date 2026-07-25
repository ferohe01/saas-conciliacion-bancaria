"use client";

import { useActionState } from "react";
import {
  guardarConfiguracion,
  type ConfigResultado,
} from "@/app/(app)/configuracion/actions";
import type { ConfigConciliacion } from "@/lib/contract/config";

const ESTADO_INICIAL: ConfigResultado = { ok: false };

type CampoNum = {
  name: string;
  label: string;
  descripcion: string;
  sufijo: string;
  defaultValue: number;
  step: string;
  min?: string;
  max?: string;
};

export function ConfiguracionForm({ config }: { config: ConfigConciliacion }) {
  const [estado, formAction, pendiente] = useActionState(
    guardarConfiguracion,
    ESTADO_INICIAL,
  );

  const campos: CampoNum[] = [
    {
      name: "tolerancia_monto_abs",
      label: "Tolerancia de monto",
      descripcion:
        "Diferencia máxima en soles para conciliar automáticamente (capa difusa). Ej: comisiones bancarias.",
      sufijo: "S/",
      defaultValue: config.tolerancia_monto_abs,
      step: "0.01",
      min: "0",
    },
    {
      name: "tolerancia_monto_pct",
      label: "Tolerancia de monto (porcentaje)",
      descripcion:
        "Alternativa relativa: diferencia máxima como % del monto.",
      sufijo: "%",
      defaultValue: config.tolerancia_monto_pct,
      step: "0.1",
      min: "0",
      max: "100",
    },
    {
      name: "tolerancia_dias",
      label: "Tolerancia de días",
      descripcion:
        "Días de diferencia permitidos entre la fecha del registro y la del banco.",
      sufijo: "días",
      defaultValue: config.tolerancia_dias,
      step: "1",
      min: "0",
    },
    {
      name: "tolerancia_ia_monto",
      label: "Banda de monto para IA",
      descripcion:
        "Diferencia máxima en soles para que la IA sugiera un match (más amplia que la difusa, pero acotada).",
      sufijo: "S/",
      defaultValue: config.tolerancia_ia_monto,
      step: "0.01",
      min: "0",
    },
    {
      name: "umbral_confianza_pct",
      label: "Umbral de auto-conciliación IA",
      descripcion:
        "Confianza mínima (%) para que una sugerencia de IA se concilie sola. Por debajo, va a revisión humana.",
      sufijo: "%",
      defaultValue: Math.round(config.umbral_confianza_auto * 100),
      step: "1",
      min: "0",
      max: "100",
    },
  ];

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <div className="space-y-5">
        {campos.map((c) => (
          <div key={c.name} className="grid gap-1 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
            <div>
              <label
                htmlFor={c.name}
                className="block text-sm font-medium text-neutral-800"
              >
                {c.label}
              </label>
              <p className="mt-0.5 text-sm text-neutral-500">{c.descripcion}</p>
            </div>
            <div className="relative w-full sm:w-40">
              <input
                id={c.name}
                name={c.name}
                type="number"
                inputMode="decimal"
                required
                step={c.step}
                min={c.min}
                max={c.max}
                defaultValue={c.defaultValue}
                className="h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 pr-12 text-neutral-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-neutral-400">
                {c.sufijo}
              </span>
            </div>
          </div>
        ))}
      </div>

      {estado.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          Configuración guardada. Se aplicará a las próximas conciliaciones.
        </p>
      )}

      <div className="mt-6">
        <button
          type="submit"
          disabled={pendiente}
          className="rounded-xl bg-neutral-900 px-6 py-3 font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {pendiente ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </form>
  );
}
