import {
  MODULOS,
  estadoModulo,
  avisoModuloPorVencer,
  type AccesoCuenta,
  type SuscripcionModulo,
} from "@/lib/modulos";
import { ModalPago } from "@/components/app/ModalPago";
import { formatearFecha } from "@/lib/parsing/resumen";

/**
 * Qué incluye la cuenta.
 *
 * ⚠️ Esto **ya no es un catálogo de compras**. El sistema se vende entero (ver
 * `estadoModulo`): esta sección existe para que el cliente sepa qué tiene, no
 * para venderle piezas sueltas. Por eso no hay precios por módulo ni botones de
 * "Activar" al lado de cada uno — cobrar dos veces al que ya pagó es la forma
 * más rápida de que deje de entender qué compró.
 *
 * El estado NO se codifica solo con color: cada módulo lleva su palabra
 * ("Incluido" / "No disponible"), que es el compromiso de accesibilidad del
 * producto y además evita que alguien tenga que adivinar qué significa un
 * borde de otro tono.
 */
export function PanelModulos({
  suscripciones,
  cuenta = null,
}: {
  suscripciones: SuscripcionModulo[];
  /** Lo que la cuenta incluye hoy: plan de pago, prueba en curso, o nada. */
  cuenta?: AccesoCuenta | null;
}) {
  const ahora = new Date();
  return (
    <section aria-labelledby="h-modulos" className="space-y-3">
      <div>
        <h2 id="h-modulos" className="font-semibold text-neutral-900">
          Qué incluye tu cuenta
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          {cuenta?.motivo === "plan"
            ? "Tu cuenta está activa: tienes el sistema completo, sin módulos que contratar aparte."
            : cuenta
              ? "Durante tu prueba gratuita tienes el sistema completo, sin contratar nada. Al activar tu cuenta lo conservas igual."
              : "Tu prueba terminó. Activa tu cuenta para recuperar estas funciones; lo que ya conciliaste lo sigues viendo."}
        </p>
      </div>

      <ul className="space-y-3">
        {MODULOS.map((m) => {
          const e = estadoModulo(m.id, suscripciones, ahora, cuenta);
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
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {e.activo ? "Incluido" : "No disponible"}
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
                  {/* La fecha solo aparece cuando hay algo que caduque. Con el
                      plan activo no la hay, y anunciar un vencimiento
                      inexistente sería sembrar una duda gratis. */}
                  {e.origen === "prueba" && e.fin && (
                    <p className="mt-1.5 text-sm text-neutral-600">
                      Lo tienes hasta el{" "}
                      {formatearFecha(e.fin.toISOString().slice(0, 10))}, cuando
                      termina tu prueba.
                    </p>
                  )}
                  {e.origen === "contratado" && e.fin && (
                    <p className="mt-1.5 text-sm tabular-nums text-neutral-600">
                      Activo hasta {formatearFecha(e.fin.toISOString().slice(0, 10))}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!cuenta && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span>Al activar tu cuenta recuperas todo esto.</span>
          <ModalPago variante="enlace" />
        </div>
      )}
    </section>
  );
}
