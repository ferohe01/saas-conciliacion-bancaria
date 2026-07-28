import { Tarjeta } from "@/components/ui";
import { ModalPago } from "@/components/app/ModalPago";
import { avisoPorVencer, type EstadoSuscripcion } from "@/lib/suscripcion";

/**
 * Cuántos días de prueba quedan. Se calla en dos casos: cuando el plan ya está
 * activo (quien paga no tiene por qué ver un contador) y cuando la prueba
 * venció (para eso está el bloqueo, que dice bastante más).
 *
 * Neutro mientras hay margen; ámbar en la última semana, que es cuando pasa de
 * ser un dato a requerir atención.
 */
export function ChipPrueba({ estado }: { estado: EstadoSuscripcion }) {
  if (estado.plan !== "prueba" || estado.expirada) return null;

  const urgente = estado.diasRestantes <= 7;
  const dias = estado.diasRestantes;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
        urgente
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-neutral-200 bg-white text-neutral-700"
      }`}
    >
      <span className="font-medium">Prueba gratuita</span>
      <span aria-hidden className="text-neutral-400">
        ·
      </span>
      <span className="tabular-nums">
        {dias === 1 ? "queda 1 día" : `quedan ${dias} días`}
      </span>
    </span>
  );
}

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
        <ModalPago />
      </div>
    </Tarjeta>
  );
}

/** Recordatorio suave en la última semana. Una línea, sin tarjeta. */
export function PruebaPorVencer({ estado }: { estado: EstadoSuscripcion }) {
  const texto = avisoPorVencer(estado);
  if (!texto) return null;
  // <div>, no <p>: el modal renderiza un <dialog>, que es contenido de flujo y
  // dentro de un párrafo haría que el navegador cerrase el <p> por su cuenta
  // → discrepancia de hidratación en React.
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <span>{texto}</span>
      <ModalPago variante="enlace" />
    </div>
  );
}
