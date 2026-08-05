import Link from "next/link";
import type { ResumenAprendizaje } from "@/lib/aprendizaje";

/**
 * Gancho del panel de control hacia `/aprendizaje`.
 *
 * Sustituye a la tarjeta compacta que vivía aquí. El razonamiento del cambio:
 * el detalle se mudó a su propia sección, pero borrar toda huella del panel
 * habría vuelto el aprendizaje MENOS visible —el panel se mira a diario, el
 * módulo dos veces al mes—, justo lo contrario de lo que se buscaba. Queda una
 * línea que da noticia y lleva allí, sin competir con las cifras del ejercicio.
 *
 * A diferencia de la tarjeta anterior, **no desaparece cuando no hay
 * decisiones**: es durante la prueba gratuita cuando el usuario más necesita
 * entender qué va a ganar quedándose.
 */

const NUM = (n: number) => n.toLocaleString("es-PE");

export function GanchoAprendizaje({ ap }: { ap: ResumenAprendizaje }) {
  const vacio = ap.total === 0;

  return (
    <Link
      href="/aprendizaje"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-violet-200 bg-violet-50/40 px-5 py-4 transition-colors hover:border-violet-400 hover:bg-violet-50"
    >
      <p className="min-w-0 text-sm text-neutral-700">
        {vacio ? (
          <>
            <span className="font-medium text-neutral-900">
              La IA todavía no ha aprendido tu criterio.
            </span>{" "}
            Cada sugerencia que aceptes o rechaces la irá afinando.
          </>
        ) : (
          <>
            <span className="font-medium text-neutral-900">
              La IA está usando{" "}
              <span className="tabular-nums">{NUM(ap.activos)}</span>{" "}
              {ap.activos === 1 ? "criterio tuyo" : "criterios tuyos"}
            </span>{" "}
            para conciliar, de {NUM(ap.total)}{" "}
            {ap.total === 1 ? "decisión acumulada" : "decisiones acumuladas"}.
          </>
        )}
      </p>
      <span className="shrink-0 text-sm font-medium text-blue-700">
        Ver aprendizaje →
      </span>
    </Link>
  );
}
