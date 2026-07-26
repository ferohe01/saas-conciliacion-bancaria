/**
 * Campo de formulario — ver DESIGN.md § Components › Inputs / Fields.
 *
 * La etiqueta SIEMPRE es visible (nunca placeholder-como-etiqueta) y el foco
 * usa el tratamiento único del sistema: borde azul + anillo de 2px.
 *
 * El `id` se deriva del `name` para poder enlazar la ayuda y el error con
 * `aria-describedby` sin necesitar un hook de cliente.
 */

export const CLASES_ENTRADA =
  "h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-neutral-800 shadow-asiento transition-colors placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-500";

export const CLASES_ENTRADA_ERROR =
  "border-red-400 focus:border-red-500 focus:ring-red-200";

type CampoProps = {
  label: string;
  name: string;
  /** Texto de ayuda permanente bajo el campo. */
  ayuda?: string;
  /** Mensaje de error; cuando existe, el control se marca como inválido. */
  error?: string | null;
  /** Etiqueta secundaria a la derecha del label, ej. "opcional". */
  nota?: string;
  children: (props: {
    id: string;
    name: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
    className: string;
  }) => React.ReactNode;
};

export function Campo({
  label,
  name,
  ayuda,
  error,
  nota,
  children,
}: CampoProps) {
  const id = `campo-${name}`;
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  const describedBy = [idError, idAyuda].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-baseline justify-between gap-2"
      >
        <span className="text-sm font-medium text-neutral-700">{label}</span>
        {nota && <span className="text-xs text-neutral-500">{nota}</span>}
      </label>

      {children({
        id,
        name,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        className: [CLASES_ENTRADA, error ? CLASES_ENTRADA_ERROR : ""]
          .filter(Boolean)
          .join(" "),
      })}

      {error && (
        <p id={idError} role="alert" className="mt-1.5 text-sm text-red-700">
          {error}
        </p>
      )}
      {ayuda && (
        <p id={idAyuda} className="mt-1.5 text-xs text-neutral-500">
          {ayuda}
        </p>
      )}
    </div>
  );
}
