import type { Precedente } from "@/lib/precedentes";
import { formatearFecha, formatearPEN } from "@/lib/parsing/resumen";

/**
 * "Esto ya lo resolviste una vez."
 *
 * Un score de 0.82 no ayuda a decidir; un caso concreto que la propia empresa
 * ya resolvió, sí. Convierte un número opaco en un recuerdo reconocible, que es
 * lo que de verdad acelera la revisión.
 *
 * ⚠️ El texto NO dice "la IA lo propuso por esto". El modelo no informa de qué
 * ejemplo pesó en su decisión, así que atribuirle esa causa sería inventarle un
 * razonamiento. Se afirma lo que sí es cierto y comprobable: *decidiste algo
 * parecido antes*, y aquí está.
 */
export function FichaPrecedente({
  p,
  moneda,
}: {
  p: Precedente;
  moneda: string;
}) {
  const acepto = p.caso.decision === "aceptado";
  const dif = Math.abs(p.caso.diferencia);

  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-white/70 px-3 py-2.5">
      <p className="text-xs font-medium text-neutral-500">
        Ya decidiste un caso parecido · {p.motivo}
      </p>
      <p className="mt-1 text-sm text-neutral-800">
        {/* La palabra, no solo el color: es el compromiso de accesibilidad del
            producto y aquí además es el dato principal. */}
        <span
          className={
            acepto ? "font-medium text-emerald-800" : "font-medium text-rose-700"
          }
        >
          {acepto ? "Lo aceptaste" : "Lo rechazaste"}
        </span>
        {p.caso.fecha && <> el {formatearFecha(p.caso.fecha)}</>}
        {p.caso.contraparte && <> · {p.caso.contraparte}</>}
        {dif > 0.005 && (
          <>
            {" "}
            · diferencia de{" "}
            <span className="tabular-nums">{formatearPEN(dif, moneda)}</span>
          </>
        )}
      </p>
    </div>
  );
}
