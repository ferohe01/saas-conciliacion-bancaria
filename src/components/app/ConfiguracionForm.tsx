"use client";

import { useActionState } from "react";
import {
  guardarConfiguracion,
  type ConfigResultado,
} from "@/app/(app)/configuracion/actions";
import type { ConfigConciliacion } from "@/lib/contract/config";
import { Boton, Tarjeta } from "@/components/ui";

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

type Grupo = {
  titulo: string;
  intro: string;
  campos: CampoNum[];
};

export function ConfiguracionForm({ config }: { config: ConfigConciliacion }) {
  const [estado, formAction, pendiente] = useActionState(
    guardarConfiguracion,
    ESTADO_INICIAL,
  );

  // Nueve campos numéricos en una lista plana son difíciles de situar. Agrupados
  // por la etapa del motor a la que afectan, cada ajuste se lee en su contexto.
  const grupos: Grupo[] = [
    {
      titulo: "Conciliación automática",
      intro:
        "Cuánto puede diferir un registro del movimiento del banco para emparejarse solo, sin preguntarte.",
      campos: [
        {
          name: "tolerancia_monto_abs",
          label: "Tolerancia de monto",
          descripcion:
            "Diferencia máxima en soles. Sirve para absorber comisiones bancarias pequeñas.",
          sufijo: "S/",
          defaultValue: config.tolerancia_monto_abs,
          step: "0.01",
          min: "0",
        },
        {
          name: "tolerancia_monto_pct",
          label: "Tolerancia de monto (porcentaje)",
          descripcion:
            "Alternativa relativa: la diferencia máxima como porcentaje del monto.",
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
            "Días de diferencia permitidos entre la fecha de tu registro y la del banco.",
          sufijo: "días",
          defaultValue: config.tolerancia_dias,
          step: "1",
          min: "0",
        },
      ],
    },
    {
      titulo: "Sugerencias de la IA",
      intro:
        "Qué tan lejos puede buscar la IA y cuándo se le permite concluir sola. Todo lo que quede por debajo del umbral llega a tu revisión.",
      campos: [
        {
          name: "tolerancia_ia_monto",
          label: "Banda de monto para IA",
          descripcion:
            "Diferencia máxima en soles para que la IA proponga un match. Más amplia que la automática, pero acotada.",
          sufijo: "S/",
          defaultValue: config.tolerancia_ia_monto,
          step: "0.01",
          min: "0",
        },
        {
          name: "ventana_ia_dias",
          label: "Ventana de fecha para la IA",
          descripcion:
            "Días máximos entre tu fecha y la del banco. Conviene amplia: el depósito suele llegar días o semanas después. No afecta a la conciliación automática.",
          sufijo: "días",
          defaultValue: config.ventana_ia_dias,
          step: "1",
          min: "0",
          max: "365",
        },
        {
          name: "top_k_candidatos",
          label: "Candidatos que evalúa la IA",
          descripcion:
            "Cuántos movimientos del banco se le presentan por cada registro tuyo. Más candidatos dan más cobertura y cuestan más. Entre 1 y 10.",
          sufijo: "",
          defaultValue: config.top_k_candidatos,
          step: "1",
          min: "1",
          max: "10",
        },
        {
          name: "umbral_confianza_pct",
          label: "Umbral de auto-conciliación",
          descripcion:
            "Confianza mínima para que una sugerencia se concilie sola. Por debajo de este valor, siempre pasa por ti.",
          sufijo: "%",
          defaultValue: Math.round(config.umbral_confianza_auto * 100),
          step: "1",
          min: "0",
          max: "100",
        },
      ],
    },
    {
      titulo: "Cobros de meses anteriores",
      intro:
        "Una factura de junio con crédito a 30 días se cobra en julio. Si al " +
        "conciliar julio solo entraran las facturas de julio, ese par no se " +
        "conciliaría nunca: en junio el abono todavía no existía. Esto es " +
        "cuántos meses hacia atrás se siguen ofreciendo tus comprobantes " +
        "pendientes.",
      campos: [
        {
          name: "arrastre_meses",
          label: "Meses que se arrastran",
          descripcion:
            "Cuánta antigüedad se admite. Con 12 entra todo lo que sigue vivo. " +
            "Un número corto acota el riesgo de que un abono case con una " +
            "factura vieja del mismo importe, pero deja fuera deuda antigua " +
            "real. Cero desactiva el arrastre: solo se concilia lo emitido " +
            "dentro del período.",
          sufijo: "meses",
          defaultValue: config.arrastre_meses,
          step: "1",
          min: "0",
          max: "120",
        },
      ],
    },
    {
      titulo: "Depósitos agrupados",
      intro:
        "Cuando un solo abono del banco junta varios de tus registros (o al revés).",
      campos: [
        {
          name: "max_combinacion",
          label: "Tamaño máximo de una agrupación",
          descripcion:
            "Cuántos registros puede reunir un mismo depósito. Con 3, un abono puede corresponder a hasta 3 pagos. Más grande abre más combinaciones y más riesgo.",
          sufijo: "",
          defaultValue: config.max_combinacion,
          step: "1",
          min: "2",
          max: "5",
        },
      ],
    },
  ];

  return (
    <form action={formAction} className="space-y-5">
      {grupos.map((g) => (
        <Tarjeta key={g.titulo}>
          <h2 className="font-semibold text-neutral-900">{g.titulo}</h2>
          <p className="mt-0.5 max-w-prose text-sm text-neutral-600">
            {g.intro}
          </p>

          <div className="mt-5 space-y-5">
            {g.campos.map((c) => (
              <div
                key={c.name}
                className="grid gap-1.5 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4"
              >
                <div>
                  <label
                    htmlFor={c.name}
                    className="block text-sm font-medium text-neutral-800"
                  >
                    {c.label}
                  </label>
                  <p
                    id={`${c.name}-ayuda`}
                    className="mt-0.5 max-w-prose text-sm text-neutral-600"
                  >
                    {c.descripcion}
                  </p>
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
                    aria-describedby={`${c.name}-ayuda`}
                    className="h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 pr-12 tabular-nums text-neutral-800 shadow-asiento transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
                  />
                  {c.sufijo && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-neutral-600"
                    >
                      {c.sufijo}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>
      ))}

      <div aria-live="polite">
        {estado.error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {estado.error}
          </p>
        )}
        {estado.ok && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Configuración guardada. Se aplicará a las próximas conciliaciones;
            las ya hechas no cambian.
          </p>
        )}
      </div>

      <div className="sticky bottom-4 flex justify-end">
        <Boton type="submit" tamano="lg" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar configuración"}
        </Boton>
      </div>
    </form>
  );
}
