"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ENLACES = [
  { href: "/dashboard", label: "Inicio" },
  { href: "/wizard", label: "Nueva conciliación" },
  { href: "/conciliacion", label: "Historial" },
  { href: "/reportes", label: "Reportes" },
  { href: "/cuentas", label: "Cuentas" },
];

export function AppNav({ empresaNombre }: { empresaNombre: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function cerrarSesion() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-neutral-200 bg-white">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-neutral-900">
            Conciliación
          </span>
          <ul className="hidden items-center gap-1 sm:flex">
            {ENLACES.map((e) => {
              const activo =
                pathname === e.href || pathname.startsWith(e.href + "/");
              return (
                <li key={e.href}>
                  <Link
                    href={e.href}
                    className={[
                      "rounded-lg px-3 py-1.5 text-sm transition-colors",
                      activo
                        ? "bg-neutral-100 font-medium text-neutral-900"
                        : "text-neutral-500 hover:text-neutral-900",
                    ].join(" ")}
                  >
                    {e.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-[12rem] truncate text-sm text-neutral-500 sm:inline">
            {empresaNombre}
          </span>
          <button
            type="button"
            onClick={cerrarSesion}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Salir
          </button>
        </div>
      </nav>
    </header>
  );
}
