import { contarMotivos } from "@/lib/motivosRechazo";

/**
 * ¿En qué se equivoca?
 *
 * Es la mitad accionable del módulo. Saber que la IA acierta el 78% no dice qué
 * hacer; saber que **la mitad de los fallos son "es otro cliente"** sí: el
 * problema está en cómo compara nombres, no en las tolerancias de monto. Para
 * el usuario es una pista de configuración; para quien desarrolla, la lista de
 * trabajo priorizada por frecuencia real.
 *
 * Barras horizontales de un solo tono: una serie, sin leyenda, y la etiqueta
 * lleva el texto al lado —la identidad nunca depende del color—.
 */
export function MotivosRechazo({ motivos }: { motivos: (string | null)[] }) {
  const { filas, sinMotivo } = contarMotivos(motivos);
  if (motivos.length === 0) return null;

  const max = Math.max(1, ...filas.map((f) => f.n));

  return (
    <section
      aria-labelledby="h-motivos"
      className="rounded-2xl border border-neutral-200 bg-white p-5"
    >
      <h2 id="h-motivos" className="font-semibold text-neutral-900">
        ¿En qué se equivoca?
      </h2>
      <p className="mt-0.5 max-w-prose text-sm text-neutral-600">
        Los motivos por los que rechazaste sus sugerencias. La IA los recibe como
        ejemplos, así que esto es también lo que está aprendiendo a evitar.
      </p>

      {filas.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          Todavía no has indicado el motivo de ningún rechazo. La próxima vez que
          rechaces una sugerencia te preguntaremos por qué.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {filas.map((f) => (
            <li key={f.id} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-neutral-800">{f.label}</p>
                <div
                  className="mt-1 h-2 rounded-full bg-neutral-100"
                  role="img"
                  aria-label={`${f.n} ${f.n === 1 ? "vez" : "veces"}`}
                >
                  <div
                    className="h-2 rounded-full bg-violet-600"
                    style={{ width: `${Math.round((f.n / max) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="text-sm font-medium tabular-nums text-neutral-900">
                {f.n}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Los rechazos previos a esta función no tienen motivo. Contarlos aparte
          evita que el total no cuadre y parezca que faltan datos. */}
      {sinMotivo > 0 && (
        <p className="mt-3 text-xs text-neutral-500">
          Otros <span className="tabular-nums">{sinMotivo}</span> rechazos no
          tienen motivo indicado (son anteriores a esta función).
        </p>
      )}
    </section>
  );
}
