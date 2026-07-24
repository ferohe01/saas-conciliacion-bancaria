import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div>
        <p className="text-sm font-medium text-emerald-600">
          Fase 1 · Fundaciones
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Conciliación Bancaria
        </h1>
        <p className="mt-3 text-base text-neutral-600">
          Conciliación bancaria asistida por IA para PyMEs peruanas. La
          interfaz orquesta, normaliza y presenta; n8n procesa.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        <p className="font-medium text-neutral-800">Estado del scaffold</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>Next.js (App Router) + TypeScript estricto + Tailwind ✓</li>
          <li>Clientes Supabase (anon / service_role) ✓</li>
          <li>Migraciones SQL + RLS ✓</li>
          <li>Contrato del webhook (zod) ✓</li>
        </ul>
        <p className="mt-3 text-neutral-500">
          Las pantallas de autenticación y el wizard llegan en las
          siguientes fases.
        </p>
      </div>

      <Link
        href="/wizard"
        className="inline-flex w-fit items-center rounded-xl bg-neutral-900 px-6 py-3 font-medium text-white transition-colors hover:bg-neutral-800"
      >
        Ver prototipo del wizard →
      </Link>
    </main>
  );
}
