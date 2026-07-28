import Link from "next/link";
import { Marca } from "@/components/ui/Marca";
import { ChevronIcon } from "@/components/wizard/icons";

/**
 * Contenedor visual compartido por login y registro: tarjeta blanca centrada
 * sobre fondo neutro, con título, subtítulo y un pie de enlace.
 *
 * La cabecera usa la marca real. Antes decía "Conciliación Bancaria" en verde,
 * y el verde de este sistema significa "conciliado", no marca.
 */
export function AuthShell({
  titulo,
  subtitulo,
  children,
  pie,
  ancho = "estrecho",
}: {
  titulo: string;
  subtitulo: string;
  children: React.ReactNode;
  /**
   * "estrecho" (448px) para el login, que es un formulario corto.
   * "amplio" (768px) para el registro, que va en dos columnas.
   */
  ancho?: "estrecho" | "amplio";
  pie: { texto: string; enlaceTexto: string; href: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 py-10">
      <div
        className={`w-full rounded-3xl border border-neutral-200 bg-white p-6 shadow-asiento sm:p-8 ${
          ancho === "amplio" ? "max-w-3xl" : "max-w-md"
        }`}
      >
        <Link href="/" className="inline-flex rounded-lg">
          <Marca className="text-sm text-neutral-900" />
        </Link>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-balance text-neutral-900">
          {titulo}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{subtitulo}</p>

        <div className="mt-6">{children}</div>

        <p className="mt-6 text-center text-sm text-neutral-600">
          {pie.texto}{" "}
          <Link
            href={pie.href}
            className="rounded font-medium text-blue-700 hover:underline"
          >
            {pie.enlaceTexto}
          </Link>
        </p>
      </div>
    </main>
  );
}

/** Campo de formulario etiquetado, estilo consistente con el wizard. */
/**
 * Desplegable con el mismo alto, radio y tratamiento de foco que CampoTexto:
 * un formulario con campos que no se parecen entre sí se lee como dos
 * formularios pegados.
 */
export function CampoSelect({
  label,
  ayuda,
  opciones,
  placeholder,
  ...props
}: {
  label: string;
  ayuda?: string;
  opciones: readonly string[];
  placeholder?: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const idAyuda = ayuda && props.name ? `${props.name}-ayuda` : undefined;
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </span>
      <span className="relative block">
        <select
          {...props}
          aria-describedby={idAyuda}
          className="h-12 w-full appearance-none rounded-xl border border-neutral-300 bg-white px-4 pr-10 text-neutral-800 shadow-asiento transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {opciones.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-neutral-500" />
      </span>
      {ayuda && (
        <span id={idAyuda} className="mt-1.5 block text-xs text-neutral-600">
          {ayuda}
        </span>
      )}
    </label>
  );
}

export function CampoTexto({
  label,
  ayuda,
  ...props
}: {
  label: string;
  ayuda?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const idAyuda = ayuda && props.name ? `${props.name}-ayuda` : undefined;
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </span>
      <input
        {...props}
        aria-describedby={idAyuda}
        className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-neutral-800 shadow-asiento transition-colors placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
      />
      {ayuda && (
        <span id={idAyuda} className="mt-1.5 block text-xs text-neutral-600">
          {ayuda}
        </span>
      )}
    </label>
  );
}
