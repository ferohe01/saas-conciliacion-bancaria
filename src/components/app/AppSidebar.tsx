"use client";

/**
 * DIRECCIÓN — Shell lateral del área autenticada
 *
 * THESIS: la navegación deja de ser una cinta horizontal que compite con el
 * contenido y pasa a ser una guarda vertical siempre presente. Rechaza la barra
 * superior centrada a 1024px, que desperdiciaba el ancho de pantalla en tablas
 * de 2000 movimientos.
 * OWN-WORLD: se hereda "El Libro Mayor Iluminado" sin cambios — guarda de papel
 * blanco separada por una línea de 1px, lienzo Papel #f5f5f5 a la derecha,
 * activo marcado por FONDO (nunca acento: el azul sigue siendo "paso vivo").
 * STORY: el usuario ve dónde está y qué más hay sin desplegar nada, y la acción
 * que da sentido al producto —conciliar un período— vive fija arriba.
 * FIRST VIEWPORT: guarda de 256px con marca, botón Nueva conciliación, seis
 * destinos; a la derecha el contenido con su propio ancho por tarea.
 * FORM: patrón de guarda persistente fijado por el usuario (ChatGPT/Claude).
 */

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Marca } from "@/components/ui/Marca";
import { Boton } from "@/components/ui";

type IconProps = { className?: string };

/** Íconos de navegación en la gramática del sistema: trazo 1.75, sin relleno. */
function Ico({ d, className = "h-4 w-4" }: { d: string[]; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

const IconoPanel = (p: IconProps) => (
  <Ico {...p} d={["M4 5h7v6H4z", "M13 5h7v3h-7z", "M13 10h7v9h-7z", "M4 13h7v6H4z"]} />
);
const IconoNueva = (p: IconProps) => <Ico {...p} d={["M12 5v14", "M5 12h14"]} />;
const IconoHistorial = (p: IconProps) => (
  <Ico {...p} d={["M3 12a9 9 0 1 0 3-6.7", "M3 4v4h4", "M12 8v4l3 2"]} />
);
const IconoReportes = (p: IconProps) => (
  <Ico {...p} d={["M4 19h16", "M7 16V9", "M12 16V5", "M17 16v-4"]} />
);
const IconoCuentas = (p: IconProps) => (
  <Ico {...p} d={["M3 9l9-5 9 5", "M5 9v9", "M12 9v9", "M19 9v9", "M3 19h18"]} />
);
const IconoConfig = (p: IconProps) => (
  <Ico
    {...p}
    d={[
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
      "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.4 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z",
    ]}
  />
);

const IconoDocumento = (p: IconProps) => (
  <Ico {...p} d={["M6 3h8l4 4v14H6z", "M14 3v4h4", "M9 12h6", "M9 16h6"]} />
);
const IconoCobranzas = (p: IconProps) => (
  <Ico
    {...p}
    d={["M12 2v20", "M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.7 5 3.2 5 1.3 5 3.3-2.2 3-5 3-5-1.1-5-3"]}
  />
);

type Enlace = {
  href: string;
  label: string;
  Icono: (p: IconProps) => React.JSX.Element;
  /** Solo se muestra si el módulo correspondiente está contratado. */
  modulo?: "cobranzas";
};

const ENLACES: Enlace[] = [
  { href: "/dashboard", label: "Panel", Icono: IconoPanel },
  { href: "/conciliacion", label: "Historial", Icono: IconoHistorial },
  // Base: cargar comprobantes alimenta la conciliación. El módulo Cobranzas
  // solo añade la vista de quién te debe.
  { href: "/comprobantes", label: "Comprobantes", Icono: IconoDocumento },
  { href: "/cobranzas", label: "Cobranzas", Icono: IconoCobranzas, modulo: "cobranzas" },
  { href: "/reportes", label: "Reportes", Icono: IconoReportes },
  { href: "/cuentas", label: "Cuentas", Icono: IconoCuentas },
  { href: "/configuracion", label: "Configuración", Icono: IconoConfig },
];

function esActivo(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** Contenido de la guarda. Se reutiliza en escritorio y en el cajón móvil. */
function Contenido({
  pathname,
  empresaNombre,
  puedeConciliar,
  modulos,
  saliendo,
  cerrarSesion,
}: {
  pathname: string;
  empresaNombre: string;
  puedeConciliar: boolean;
  modulos: string[];
  saliendo: boolean;
  cerrarSesion: () => void;
}) {
  const enWizard = esActivo(pathname, "/wizard");
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-4">
        <Link href="/dashboard" className="inline-block rounded-lg">
          <Marca className="text-[15px] text-neutral-900" />
        </Link>
      </div>

      {/* La acción que da sentido al producto, fija y siempre alcanzable.
          Con la prueba vencida deja de ser el botón primario negro: sigue
          llevando a /wizard, que es donde se explica por qué está en pausa,
          pero no promete en negro una acción que ya no puede cumplir. */}
      <div className="px-3 pb-3">
        <Link
          href="/wizard"
          aria-current={enWizard ? "page" : undefined}
          className={[
            "flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
            !puedeConciliar
              ? "border border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50"
              : enWizard
                ? "bg-neutral-800 text-white"
                : "bg-neutral-900 text-white hover:bg-neutral-800",
          ].join(" ")}
        >
          <IconoNueva className="h-4 w-4 shrink-0" />
          <span className="truncate">Nueva conciliación</span>
        </Link>
        {!puedeConciliar && (
          <p className="px-1 pt-2 text-xs text-amber-800">Prueba vencida</p>
        )}
      </div>

      <nav aria-label="Principal" className="min-h-0 flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">
          {ENLACES.filter(
            (e) => !e.modulo || modulos.includes(e.modulo),
          ).map(({ href, label, Icono }) => {
            const activo = esActivo(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={activo ? "page" : undefined}
                  className={[
                    "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    activo
                      ? "bg-neutral-100 font-medium text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900",
                  ].join(" ")}
                >
                  <Icono
                    className={`h-4 w-4 shrink-0 ${activo ? "text-neutral-900" : "text-neutral-400"}`}
                  />
                  <span className="truncate">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-neutral-200 px-3 py-3">
        <p className="truncate px-3 pb-2 text-xs text-neutral-500" title={empresaNombre}>
          {empresaNombre}
        </p>
        <Boton
          variante="secundario"
          tamano="sm"
          onClick={cerrarSesion}
          disabled={saliendo}
          className="w-full justify-center"
        >
          {saliendo ? "Saliendo…" : "Salir"}
        </Boton>
      </div>
    </div>
  );
}

export function AppSidebar({
  empresaNombre,
  puedeConciliar,
  modulos,
}: {
  empresaNombre: string;
  puedeConciliar: boolean;
  /** Ids de los módulos contratados y vigentes. */
  modulos: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const idPanel = useId();
  const botonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  // Escape cierra el cajón y devuelve el foco a su disparador.
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

  const props = {
    pathname,
    empresaNombre,
    puedeConciliar,
    modulos,
    saliendo,
    cerrarSesion,
  };

  return (
    <>
      {/* Guarda de escritorio */}
      <aside className="hidden border-r border-neutral-200 bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block lg:w-64">
        <Contenido {...props} />
      </aside>

      {/* Barra móvil */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-2.5 lg:hidden">
        <Link href="/dashboard" className="min-w-0 rounded-lg">
          <Marca className="text-[15px] text-neutral-900" compacta />
        </Link>
        <button
          ref={botonRef}
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          aria-controls={idPanel}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
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
            {abierto ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
          {abierto ? "Cerrar" : "Menú"}
        </button>
      </header>

      {/* Cajón móvil */}
      {abierto && (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={() => setAbierto(false)}
          className="fixed inset-0 z-40 bg-neutral-900/20 lg:hidden"
        />
      )}
      <div
        id={idPanel}
        hidden={!abierto}
        className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-neutral-200 bg-white shadow-flotante lg:hidden"
      >
        <Contenido {...props} />
      </div>
    </>
  );
}
