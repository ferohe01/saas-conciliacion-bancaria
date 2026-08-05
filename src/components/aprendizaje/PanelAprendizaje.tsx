import type { ResumenAprendizaje } from "@/lib/aprendizaje";

/**
 * Panel del pool de aprendizaje.
 *
 * Vivía dentro de `ReporteVista.tsx` —la salsa secreta del producto hospedada
 * como anexo del módulo de reportes— y se mudó a su propia sección. Es GLOBAL:
 * mira todo el historial y no depende de los filtros de período.
 */

const NUM = (n: number) => n.toLocaleString("es-PE");

export function PanelAprendizaje({ ap }: { ap: ResumenAprendizaje }) {
  const totalBalance = ap.positivos + ap.negativos || 1;
  const pctPos = Math.round((ap.positivos / totalBalance) * 100);

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-neutral-900">
            Lo que la IA ha aprendido de ti
          </h2>
          <p className="text-xs text-neutral-600">
            Cada decisión tuya se convierte en un ejemplo que la IA lee antes de
            proponer la siguiente conciliación.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-800">
          Few-shot dinámico
        </span>
      </div>

      {ap.total === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-violet-200 bg-white/60 px-4 py-3 text-sm text-neutral-700">
          Aún no hay decisiones registradas. A medida que aceptes o rechaces
          sugerencias, la IA aprenderá el criterio de tu empresa y afinará las
          próximas conciliaciones.
        </p>
      ) : (
        <div className="mt-4 grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums text-violet-800">
              {NUM(ap.activos)}
            </span>
            <span className="text-sm text-neutral-600">
              ejemplos activos
              <br />
              por conciliación
            </span>
          </div>

          <div>
            {/* Los tonos anteriores (emerald-500 / rose-400) quedaban a ΔE 3.9
                en deuteranopía: para un daltónico rojo-verde la barra era un
                bloque único. Con emerald-700 / rose-600 sube a 7.3 —dentro de
                la banda mínima, legal porque hay etiquetas de texto debajo— y
                el hueco de 2px (gap-0.5) separa los segmentos sin depender del
                color. Validado con el script del skill dataviz. */}
            <div
              className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-neutral-100"
              role="img"
              aria-label={`${ap.positivos} aceptados y ${ap.negativos} rechazados`}
            >
              {ap.positivos > 0 && (
                <div
                  className="h-3 rounded-full bg-emerald-700"
                  style={{ width: `${pctPos}%` }}
                />
              )}
              {ap.negativos > 0 && (
                <div className="h-3 flex-1 rounded-full bg-rose-600" />
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5 text-neutral-700">
                <span
                  className="h-2.5 w-2.5 rounded-sm bg-emerald-700"
                  aria-hidden
                />
                Aceptados (la IA acertó):{" "}
                <span className="font-medium tabular-nums text-neutral-900">
                  {NUM(ap.positivos)}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-neutral-700">
                <span
                  className="h-2.5 w-2.5 rounded-sm bg-rose-600"
                  aria-hidden
                />
                Rechazados (corregidos):{" "}
                <span className="font-medium tabular-nums text-neutral-900">
                  {NUM(ap.negativos)}
                </span>
              </span>
            </div>
            <p className="mt-2 text-xs text-neutral-600">
              {ap.total > ap.activos
                ? `De ${NUM(ap.total)} decisiones acumuladas, las más recientes y balanceadas alimentan cada corrida.`
                : "Estas decisiones se envían como ejemplos en cada nueva conciliación."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
