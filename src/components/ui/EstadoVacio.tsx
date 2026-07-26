/**
 * Estado vacío. No informa: orienta. El usuario puede no ser contador, así que
 * un vacío siempre dice qué falta, por qué importa y cuál es el siguiente paso.
 */
export function EstadoVacio({
  icono,
  titulo,
  texto,
  accion,
}: {
  icono?: React.ReactNode;
  titulo: string;
  texto: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-neutral-300 bg-white px-6 py-10 text-center">
      {icono && (
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
          {icono}
        </span>
      )}
      <p className="font-semibold text-neutral-900">{titulo}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-neutral-600">
        {texto}
      </p>
      {accion && <div className="mt-5 flex justify-center">{accion}</div>}
    </div>
  );
}
