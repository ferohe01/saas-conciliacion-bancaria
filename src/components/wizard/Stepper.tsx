import { CheckIcon } from "./icons";

export type PasoWizard = 1 | 2 | 3;

const PASOS: { numero: PasoWizard; titulo: string }[] = [
  { numero: 1, titulo: "Cargar datos" },
  { numero: 2, titulo: "Verificar columnas" },
  { numero: 3, titulo: "Conciliar" },
];

/**
 * Stepper de los 3 pasos del wizard. `actual` marca el paso activo; los pasos
 * anteriores se muestran completados (✓).
 */
export function Stepper({ actual }: { actual: PasoWizard }) {
  return (
    <ol className="flex items-center gap-2">
      {PASOS.map((paso, i) => {
        const completado = paso.numero < actual;
        const activo = paso.numero === actual;
        return (
          <li key={paso.numero} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                  activo
                    ? "bg-blue-600 text-white"
                    : completado
                      ? "bg-blue-600 text-white"
                      : "border-2 border-neutral-300 text-neutral-400",
                ].join(" ")}
                aria-current={activo ? "step" : undefined}
              >
                {completado ? (
                  <CheckIcon className="h-4 w-4" />
                ) : (
                  paso.numero
                )}
              </span>
              <span
                className={[
                  "text-sm",
                  activo
                    ? "font-semibold text-blue-600"
                    : completado
                      ? "font-medium text-neutral-700"
                      : "text-neutral-400",
                ].join(" ")}
              >
                {paso.titulo}
              </span>
            </div>
            {i < PASOS.length - 1 && (
              <span className="mx-2 h-px flex-1 bg-neutral-200" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
