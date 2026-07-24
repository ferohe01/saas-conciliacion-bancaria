import Link from "next/link";
import { getEmpresaActual } from "@/lib/auth";

export default async function DashboardPage() {
  const empresa = await getEmpresaActual();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Hola, {empresa?.nombre}
        </h1>
        <p className="mt-1 text-neutral-500">
          Empieza una conciliación o administra tus cuentas bancarias.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/wizard"
          className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition-colors hover:border-neutral-300"
        >
          <p className="text-lg font-semibold text-neutral-900">
            Nueva conciliación
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Carga tus registros y el extracto bancario para conciliar el
            período.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-blue-600">
            Empezar →
          </span>
        </Link>

        <Link
          href="/cuentas"
          className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition-colors hover:border-neutral-300"
        >
          <p className="text-lg font-semibold text-neutral-900">
            Cuentas bancarias
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Registra y administra las cuentas de tu empresa.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-blue-600">
            Administrar →
          </span>
        </Link>
      </div>
    </div>
  );
}
