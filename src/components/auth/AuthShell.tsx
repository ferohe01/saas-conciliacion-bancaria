import Link from "next/link";

/**
 * Contenedor visual compartido por login y registro: tarjeta blanca centrada
 * sobre fondo neutro, con título, subtítulo y un pie de enlace.
 */
export function AuthShell({
  titulo,
  subtitulo,
  children,
  pie,
}: {
  titulo: string;
  subtitulo: string;
  children: React.ReactNode;
  pie: { texto: string; enlaceTexto: string; href: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-emerald-600">
          Conciliación Bancaria
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-neutral-900">
          {titulo}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{subtitulo}</p>

        <div className="mt-6">{children}</div>

        <p className="mt-6 text-center text-sm text-neutral-500">
          {pie.texto}{" "}
          <Link
            href={pie.href}
            className="font-medium text-blue-600 hover:underline"
          >
            {pie.enlaceTexto}
          </Link>
        </p>
      </div>
    </main>
  );
}

/** Campo de formulario etiquetado, estilo consistente con el wizard. */
export function CampoTexto({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </span>
      <input
        {...props}
        className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-neutral-800 shadow-sm placeholder:text-neutral-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
      />
    </label>
  );
}
