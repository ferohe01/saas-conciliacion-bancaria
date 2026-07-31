import Link from "next/link";

/**
 * Aviso de conciliaciones terminadas que NO están contando.
 *
 * Desde la Fase C el panel y los reportes solo suman conciliaciones aprobadas.
 * Sin este aviso, alguien que concilia un período y no lo aprueba ve el panel
 * igual que antes de conciliar y concluye que el sistema perdió su trabajo. El
 * silencio es la peor respuesta posible a "¿dónde están mis números?".
 */
export function AvisoSinAprobar({ cuantas }: { cuantas: number }) {
  if (cuantas <= 0) return null;

  const una = cuantas === 1;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4"
    >
      <p className="text-sm text-amber-900">
        <span className="font-semibold">
          {una
            ? "Tienes una conciliación terminada sin aprobar."
            : `Tienes ${cuantas} conciliaciones terminadas sin aprobar.`}
        </span>{" "}
        {una ? "No está" : "No están"} contando en estas cifras: solo suma lo
        aprobado.
      </p>
      <Link
        href="/conciliacion"
        className="shrink-0 rounded text-sm font-medium text-amber-900 underline underline-offset-2 transition-colors hover:text-amber-950"
      >
        {una ? "Revisarla" : "Revisarlas"}
      </Link>
    </div>
  );
}
