/**
 * Marca del producto. Fuente única del nombre y del logotipo: antes la portada
 * decía "Conciliaciones Inteligentes" y la barra de la app decía "Conciliación".
 *
 * El glifo son dos flechas opuestas: el par enfrentado, la forma primitiva del
 * producto (ver DESIGN.md § Components › El Par Enfrentado).
 */

export const NOMBRE_MARCA = "Conciliaciones Inteligentes";

export function Marca({
  className = "",
  /** Oculta el nombre bajo `sm:` y deja solo el glifo. */
  compacta = false,
}: {
  className?: string;
  compacta?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}
    >
      <span
        aria-hidden
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-600 text-white shadow-asiento"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 7h11M4 7l3-3M4 7l3 3" />
          <path d="M20 17H9M20 17l-3-3M20 17l-3 3" />
        </svg>
      </span>
      <span className={compacta ? "sr-only sm:not-sr-only" : undefined}>
        {NOMBRE_MARCA}
      </span>
    </span>
  );
}
