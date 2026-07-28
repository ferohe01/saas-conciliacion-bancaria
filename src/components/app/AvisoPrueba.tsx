import { Tarjeta, clasesBoton } from "@/components/ui";
import {
  avisoPorVencer,
  CONTACTO_SUSCRIPCION,
  type EstadoSuscripcion,
} from "@/lib/suscripcion";

/**
 * Estado de la prueba, contado al usuario.
 *
 * Tono ÁMBAR a propósito (DESIGN.md § Colors): "requiere tu atención", que no
 * es lo mismo que "algo está mal". El rojo queda reservado al descuadre y a los
 * errores de acción; una prueba que termina no es una falla del usuario.
 */

/** Bloqueo: la prueba terminó. Se puede seguir consultando todo lo anterior. */
export function PruebaVencida({ compacto = false }: { compacto?: boolean }) {
  return (
    <Tarjeta tono="atencion">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold text-neutral-900">
            Tu período de prueba terminó
          </h2>
          <p className="mt-1 text-sm text-neutral-700">
            {compacto
              ? "Para generar conciliaciones nuevas, activa tu cuenta."
              : "Puedes seguir entrando y consultando tus conciliaciones, reportes y cuentas sin límite. Lo único que queda en pausa es generar una conciliación nueva."}
          </p>
        </div>
        <a
          href={CONTACTO_SUSCRIPCION}
          className={`${clasesBoton("primario", "md")} shrink-0`}
        >
          Activar mi cuenta
        </a>
      </div>
    </Tarjeta>
  );
}

/** Recordatorio suave en la última semana. Una línea, sin tarjeta. */
export function PruebaPorVencer({ estado }: { estado: EstadoSuscripcion }) {
  const texto = avisoPorVencer(estado);
  if (!texto) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <span>{texto}</span>
      <a
        href={CONTACTO_SUSCRIPCION}
        className="rounded font-medium underline underline-offset-2 transition-colors hover:text-amber-950"
      >
        Activar mi cuenta
      </a>
    </p>
  );
}
