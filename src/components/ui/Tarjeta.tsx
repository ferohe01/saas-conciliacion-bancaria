/**
 * Tarjeta de contenido — ver DESIGN.md § Components › Cards / Containers.
 * Plana y definida por borde; el `tono` la tiñe solo cuando representa un
 * estado (La Regla del Color Ganado).
 */

export type TonoTarjeta = "neutro" | "cuadre" | "maquina" | "atencion" | "falla";

const TONO: Record<TonoTarjeta, string> = {
  neutro: "border-neutral-200 bg-white",
  cuadre: "border-emerald-200 bg-emerald-50",
  maquina: "border-violet-200 bg-violet-50/50",
  atencion: "border-amber-200 bg-amber-50",
  falla: "border-red-200 bg-red-50",
};

export function Tarjeta({
  tono = "neutro",
  className = "",
  children,
  ...props
}: {
  tono?: TonoTarjeta;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`rounded-2xl border p-5 ${TONO[tono]} ${className}`}
    >
      {children}
    </div>
  );
}

/** Encabezado de tarjeta: título en Title y descripción opcional debajo. */
export function TarjetaTitulo({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-semibold text-neutral-900">{titulo}</h2>
        {descripcion && (
          <p className="mt-0.5 text-xs text-neutral-500">{descripcion}</p>
        )}
      </div>
      {accion}
    </div>
  );
}
