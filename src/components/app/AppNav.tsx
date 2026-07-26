"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Marca } from "@/components/ui/Marca";
import { Boton } from "@/components/ui";

const ENLACES = [
  { href: "/dashboard", label: "Inicio" },
  { href: "/wizard", label: "Nueva conciliación" },
  { href: "/conciliacion", label: "Historial" },
  { href: "/reportes", label: "Reportes" },
  { href: "/cuentas", label: "Cuentas" },
  { href: "/configuracion", label: "Configuración" },
];

function esActivo(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppNav({ empresaNombre }: { empresaNombre: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const idPanel = useId();
  const botonRef = useRef<HTMLButtonElement>(null);

  // El menú móvil se cierra al navegar.
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  // Escape cierra y devuelve el foco al disparador.
  useEffect(() => {
    if (!abierto) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAbierto(false);
        botonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierto]);

  async function cerrarSesion() {
    setSaliendo(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white">
      <nav
        aria-label="Principal"
        className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3"
      >
        <div className="flex min-w-0 items-center gap-6">
          <Link href="/dashboard" className="rounded-lg">
            <Marca className="text-[15px] text-neutral-900" compacta />
          </Link>

          {/* Navegación de escritorio */}
          <ul className="hidden items-center gap-1 lg:flex">
            {ENLACES.map((e) => {
              const activo = esActivo(pathname, e.href);
              return (
                <li key={e.href}>
                  <Link
                    href={e.href}
                    aria-current={activo ? "page" : undefined}
                    className={[
                      "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                      activo
                        ? "bg-neutral-100 font-medium text-neutral-900"
                        : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900",
                    ].join(" ")}
                  >
                    {e.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden max-w-[12rem] truncate text-sm text-neutral-600 lg:inline">
            {empresaNombre}
          </span>
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={cerrarSesion}
            disabled={saliendo}
            className="hidden lg:inline-flex"
          >
            {saliendo ? "Saliendo…" : "Salir"}
          </Boton>

          {/* Disparador del menú móvil */}
          <button
            ref={botonRef}
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            aria-controls={idPanel}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 lg:hidden"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              {abierto ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
            {abierto ? "Cerrar" : "Menú"}
          </button>
        </div>
      </nav>

      {/* Panel móvil */}
      <div
        id={idPanel}
        hidden={!abierto}
        className="border-t border-neutral-200 bg-white lg:hidden"
      >
        <ul className="mx-auto max-w-5xl px-4 py-2">
          {ENLACES.map((e) => {
            const activo = esActivo(pathname, e.href);
            return (
              <li key={e.href}>
                <Link
                  href={e.href}
                  aria-current={activo ? "page" : undefined}
                  className={[
                    "flex min-h-11 items-center rounded-lg px-3 text-sm transition-colors",
                    activo
                      ? "bg-neutral-100 font-medium text-neutral-900"
                      : "text-neutral-700 hover:bg-neutral-50",
                  ].join(" ")}
                >
                  {e.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3">
          <span className="min-w-0 truncate text-sm text-neutral-600">
            {empresaNombre}
          </span>
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={cerrarSesion}
            disabled={saliendo}
          >
            {saliendo ? "Saliendo…" : "Salir"}
          </Boton>
        </div>
      </div>
    </header>
  );
}
