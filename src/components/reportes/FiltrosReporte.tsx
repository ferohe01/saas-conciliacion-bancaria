"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { nombreMes } from "@/lib/periodo";

type Cuenta = { id: string; banco: string; numero_enmascarado: string | null };

/* Estos selects no declaraban ningún estado de foco: con el teclado no se veía
   cuál estaba activo. Mismo tratamiento que el resto de campos del sistema. */
const CLASES_SELECT =
  "h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-800 transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none";

export function FiltrosReporte({
  anios,
  bancos,
  cuentas,
  valores,
}: {
  anios: number[];
  bancos: string[];
  cuentas: Cuenta[];
  valores: { anio: number; mes: string; banco: string; cuenta: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function set(clave: string, valor: string) {
    const p = new URLSearchParams(searchParams.toString());
    p.set(clave, valor);
    // Si cambia el banco, se resetea la cuenta.
    if (clave === "banco") p.set("cuenta", "todos");
    router.push(`${pathname}?${p.toString()}`);
  }

  // Cuentas visibles según el banco elegido.
  const cuentasVisibles =
    valores.banco === "todos"
      ? cuentas
      : cuentas.filter((c) => c.banco === valores.banco);

  const hayFiltro =
    valores.mes !== "todos" ||
    valores.banco !== "todos" ||
    valores.cuenta !== "todos";

  return (
    <search className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Campo label="Año">
        <select
          value={String(valores.anio)}
          onChange={(e) => set("anio", e.target.value)}
          className={CLASES_SELECT}
        >
          {anios.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Campo>

      <Campo label="Mes">
        <select
          value={valores.mes}
          onChange={(e) => set("mes", e.target.value)}
          className={CLASES_SELECT}
        >
          <option value="todos">Todo el año</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {nombreMes(m)}
            </option>
          ))}
        </select>
      </Campo>

      <Campo label="Banco">
        <select
          value={valores.banco}
          onChange={(e) => set("banco", e.target.value)}
          className={CLASES_SELECT}
        >
          <option value="todos">Todos</option>
          {bancos.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </Campo>

      <Campo label="Cuenta">
        <select
          value={valores.cuenta}
          onChange={(e) => set("cuenta", e.target.value)}
          className={CLASES_SELECT}
        >
          <option value="todos">Todas</option>
          {cuentasVisibles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.banco} {c.numero_enmascarado ?? ""}
            </option>
          ))}
        </select>
        </Campo>
      </div>

      {hayFiltro && (
        <button
          type="button"
          onClick={() => router.push(`${pathname}?anio=${valores.anio}`)}
          className="mt-3 min-h-9 rounded-lg px-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
        >
          Quitar filtros
        </button>
      )}
    </search>
  );
}

function Campo({
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
