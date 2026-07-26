import Link from "next/link";

/**
 * Encabezado de página del área autenticada. Un solo `h1` por ruta, con la
 * acción principal a la derecha (debajo en móvil).
 */
export function EncabezadoPagina({
  titulo,
  descripcion,
  accion,
  volver,
}: {
  titulo: string;
  descripcion?: string;
  accion?: React.ReactNode;
  volver?: { href: string; texto: string };
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {volver && (
          <Link
            href={volver.href}
            className="mb-1.5 inline-flex items-center gap-1 rounded text-sm text-neutral-600 transition-colors hover:text-neutral-900"
          >
            <span aria-hidden>←</span> {volver.texto}
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-balance text-neutral-900">
          {titulo}
        </h1>
        {descripcion && (
          <p className="mt-1 text-neutral-600">{descripcion}</p>
        )}
      </div>
      {accion && <div className="shrink-0">{accion}</div>}
    </div>
  );
}
