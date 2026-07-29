import { MODULOS, estadoModulo, avisoModuloPorVencer, type SuscripcionModulo } from "@/lib/modulos";
import { CONTACTO_SUSCRIPCION, montoPEN } from "@/lib/suscripcion";
import { formatearFecha } from "@/lib/parsing/resumen";
import { clasesBoton } from "@/components/ui";

/**
 * Módulos contratables.
 *
 * El estado NO se codifica solo con color: cada módulo lleva su palabra
 * ("Activo" / "No contratado"), que es el compromiso de accesibilidad del
 * producto y además evita que alguien tenga que adivinar qué significa un
 * borde de otro tono.
 */
export function PanelModulos({
  suscripciones,
}: {
  suscripciones: SuscripcionModulo[];
}) {
  return (
    <section aria-labelledby="h-modulos" className="space-y-3">
      <div>
        <h2 id="h-modulos" className="font-semibold text-neutral-900">
          Módulos
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Funciones que se activan aparte. La conciliación viene siempre
          incluida.
        </p>
      </div>

      <ul className="space-y-3">
        {MODULOS.map((m) => {
          const e = estadoModulo(m.id, suscripciones);
          const aviso = avisoModuloPorVencer(e);
          return (
            <li
              key={m.id}
              className="rounded-2xl border border-neutral-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-neutral-900">{m.nombre}</h3>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        e.activo
                          ? "bg-neutral-100 text-neutral-700"
                          : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {e.activo ? "Activo" : "No contratado"}
                    </span>
                    {aviso && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        {aviso}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 max-w-prose text-sm text-neutral-600">
                    {m.descripcion}
                  </p>
                  {e.activo && e.fin && (
                    <p className="mt-1.5 text-sm tabular-nums text-neutral-600">
                      Activo hasta {formatearFecha(e.fin.toISOString().slice(0, 10))}
                    </p>
                  )}
                  {e.activo && !e.fin && (
                    <p className="mt-1.5 text-sm text-neutral-600">Sin vencimiento.</p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  {m.precioMensual !== null && (
                    <p className="mb-2 text-sm tabular-nums text-neutral-900">
                      {montoPEN(m.precioMensual)}
                      <span className="text-neutral-600"> /mes</span>
                    </p>
                  )}
                  {!e.activo && (
                    <a
                      href={CONTACTO_SUSCRIPCION}
                      className={clasesBoton("secundario", "sm")}
                    >
                      {m.precioMensual === null ? "Consúltanos" : "Activar"}
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
