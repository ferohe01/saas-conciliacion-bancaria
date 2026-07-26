/**
 * Botón del sistema — ver DESIGN.md § Components › Buttons.
 *
 * `clasesBoton` se exporta aparte para que `next/link` pueda vestirse igual sin
 * duplicar la escala de tamaños ni las variantes.
 */

export type VarianteBoton =
  | "primario"
  | "secundario"
  | "confirmar"
  | "peligro"
  | "sutil";

export type TamanoBoton = "sm" | "md" | "lg";

const VARIANTE: Record<VarianteBoton, string> = {
  // Tinta, no azul: el azul ya significa "paso vivo".
  primario:
    "bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-300 disabled:cursor-not-allowed",
  secundario:
    "bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50 disabled:text-neutral-400 disabled:cursor-not-allowed",
  // La única acción con botón verde: es la única que produce una conciliación.
  confirmar:
    "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/40 disabled:cursor-not-allowed",
  peligro:
    "bg-white text-red-700 border border-red-300 hover:bg-red-50 disabled:text-red-400 disabled:cursor-not-allowed",
  sutil:
    "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-400 disabled:cursor-not-allowed",
};

const TAMANO: Record<TamanoBoton, string> = {
  sm: "min-h-9 gap-1.5 rounded-lg px-3 py-1.5 text-sm",
  md: "min-h-11 gap-2 rounded-xl px-5 py-2.5 text-sm",
  lg: "min-h-12 gap-2 rounded-xl px-6 py-3 text-base",
};

const BASE =
  "inline-flex items-center justify-center font-medium transition-colors";

export function clasesBoton(
  variante: VarianteBoton = "primario",
  tamano: TamanoBoton = "md",
  extra = "",
): string {
  return [BASE, TAMANO[tamano], VARIANTE[variante], extra]
    .filter(Boolean)
    .join(" ");
}

type BotonProps = {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Boton({
  variante = "primario",
  tamano = "md",
  className = "",
  type = "button",
  ...props
}: BotonProps) {
  return (
    <button
      {...props}
      type={type}
      className={clasesBoton(variante, tamano, className)}
    />
  );
}
