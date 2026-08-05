"use client";

import { MOTIVOS_RECHAZO, type MotivoRechazo } from "@/lib/motivosRechazo";

/**
 * Por qué rechazas.
 *
 * Un rechazo sin motivo le dice a la IA que se equivocó; con motivo le dice EN
 * QUÉ, que es lo único que permite no repetirlo. Por eso vale un clic más.
 *
 * DECISIONES DE FRICCIÓN:
 *
 * - **Un solo clic por motivo**: elegir ya ejecuta el rechazo. Pedir "elige y
 *   luego confirma" duplicaría los clics de la tarea más repetitiva de la
 *   pantalla —a 500 partidas eso se nota— y la gente acabaría rechazando en
 *   lote solo para evitarlo.
 * - **"Otro motivo" existe y es legítimo.** Sin escapatoria, quien no sabe qué
 *   poner elige cualquiera con tal de seguir, y eso envenena el aprendizaje con
 *   datos inventados. Un "otro" honesto vale más que una categoría falsa.
 * - **Se puede cancelar.** Abrir el selector no debe atrapar a nadie.
 */
export function SelectorMotivo({
  titulo = "¿Por qué lo rechazas?",
  onElegir,
  onCancelar,
  disabled,
}: {
  titulo?: string;
  onElegir: (motivo: MotivoRechazo) => void;
  onCancelar: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 rounded-xl border border-neutral-300 bg-white p-3">
      <p className="text-sm font-medium text-neutral-800">{titulo}</p>
      <p className="mt-0.5 text-xs text-neutral-500">
        Con esto la IA aprende en qué se equivocó, no solo que se equivocó.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {MOTIVOS_RECHAZO.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            onClick={() => onElegir(m.id)}
            className="min-h-9 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50"
          >
            {m.label}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={onCancelar}
          className="min-h-9 rounded-lg px-3 py-1.5 text-sm text-neutral-500 underline underline-offset-2 transition-colors hover:text-neutral-700 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
