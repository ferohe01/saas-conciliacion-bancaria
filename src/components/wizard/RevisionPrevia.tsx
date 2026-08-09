import type { Hallazgo, Severidad } from "@/lib/diagnosticoPrevio";
import { Asistente, type Preguntar } from "@/components/ia/Asistente";

/**
 * Lo que se ha comprobado antes de conciliar.
 *
 * ⚠️ Se muestra SIEMPRE que haya algo que decir, incluso cuando todo está bien:
 * *«Casarían 980 de 1.000 movimientos»* es la confirmación de que la
 * comprobación se hizo. Un panel que solo aparece cuando hay problemas deja al
 * usuario sin saber si el silencio significa "correcto" o "no se miró".
 *
 * El estado no se codifica solo con color: cada hallazgo lleva su palabra
 * ("Revisar" / "Atención" / "Comprobado"), que es el compromiso de
 * accesibilidad del producto.
 */

const ESTILO: Record<
  Severidad,
  { borde: string; fondo: string; texto: string; etiqueta: string; chip: string }
> = {
  critico: {
    borde: "border-amber-300",
    fondo: "bg-amber-50",
    texto: "text-amber-900",
    etiqueta: "Revisar",
    chip: "bg-amber-200 text-amber-900",
  },
  aviso: {
    borde: "border-amber-200",
    fondo: "bg-amber-50/60",
    texto: "text-amber-900",
    etiqueta: "Atención",
    chip: "bg-amber-100 text-amber-800",
  },
  info: {
    borde: "border-neutral-200",
    fondo: "bg-white",
    texto: "text-neutral-700",
    etiqueta: "Comprobado",
    chip: "bg-neutral-100 text-neutral-600",
  },
};

export function RevisionPrevia({
  hallazgos,
  cargando,
  preguntar,
}: {
  hallazgos: Hallazgo[] | null;
  cargando: boolean;
  /** Sin esto no se ofrece asistente (despliegue sin modelo configurado). */
  preguntar?: Preguntar;
}) {
  if (cargando) {
    return (
      <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-600">
        Revisando tus datos antes de conciliar…
      </p>
    );
  }

  // `null` = no se pudo comprobar. No se dice nada: inventar un "todo bien"
  // sería peor que el silencio, y el Paso 3 funciona igual que antes.
  if (!hallazgos || hallazgos.length === 0) return null;

  return (
    <section aria-labelledby="h-revision" className="space-y-2">
      <h3 id="h-revision" className="text-sm font-semibold text-neutral-900">
        Antes de conciliar
      </h3>
      <ul className="space-y-2">
        {hallazgos.map((h) => {
          const e = ESTILO[h.severidad];
          return (
            <li
              key={h.codigo}
              className={`rounded-2xl border ${e.borde} ${e.fondo} px-5 py-4`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${e.chip}`}
                >
                  {e.etiqueta}
                </span>
                <p className={`font-medium ${e.texto}`}>{h.titulo}</p>
              </div>
              <p className={`mt-1.5 max-w-prose text-sm ${e.texto}`}>
                {h.detalle}
              </p>
              {h.accion && (
                <p className={`mt-1.5 max-w-prose text-sm font-medium ${e.texto}`}>
                  {h.accion}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {/* Debajo de la lista, nunca en su lugar: el panel de arriba es el que
          manda y sigue estando aunque el modelo falle. */}
      {preguntar && <Asistente preguntar={preguntar} />}
    </section>
  );
}
