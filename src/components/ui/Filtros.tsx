"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * Piezas compartidas de las barras de filtro.
 *
 * Cada pantalla filtra por lo suyo —los comprobantes no tienen cuenta bancaria,
 * y en el aging la pregunta no es de qué mes es sino cuánto lleva vencido—, así
 * que los CAMPOS no se comparten. Lo que sí se comparte es el aspecto y el
 * comportamiento: misma tarjeta, mismo foco visible, mismos filtros en la URL.
 * Que cada pantalla invente su propio look sería el camino a tres sistemas.
 *
 * Los filtros viven en la query string a propósito: así un recorte concreto se
 * puede guardar en marcadores y compartir por correo con quien lleva la
 * contabilidad.
 */

export const CLASES_CAMPO =
  "h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-800 transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none";

/** Escribe un filtro en la URL conservando los demás. */
export function useFiltroUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return {
    set(clave: string, valor: string, resetear: string[] = []) {
      const p = new URLSearchParams(searchParams.toString());
      if (valor === "todos" || valor === "") p.delete(clave);
      else p.set(clave, valor);
      for (const r of resetear) p.delete(r);
      const qs = p.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    limpiar() {
      router.push(pathname);
    },
  };
}

export function BarraFiltros({
  children,
  hayFiltro,
  onLimpiar,
  columnas = "sm:grid-cols-4",
}: {
  children: React.ReactNode;
  hayFiltro: boolean;
  onLimpiar: () => void;
  columnas?: string;
}) {
  return (
    <search className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className={`grid grid-cols-2 gap-3 ${columnas}`}>{children}</div>
      {hayFiltro && (
        <button
          type="button"
          onClick={onLimpiar}
          className="mt-3 min-h-9 rounded-lg px-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
        >
          Quitar filtros
        </button>
      )}
    </search>
  );
}

export function CampoFiltro({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
      </span>
      {children}
    </label>
  );
}

export function SelectFiltro({
  label,
  valor,
  opciones,
  onChange,
}: {
  label: string;
  valor: string;
  opciones: { valor: string; texto: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <CampoFiltro label={label}>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={CLASES_CAMPO}
      >
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </CampoFiltro>
  );
}
