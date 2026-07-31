import type { MetodoMatch } from "@/lib/contract/enums";
import { ETIQUETA, type EstadoContable } from "@/lib/cicloContable";

/**
 * Badges del sistema — ver DESIGN.md § Components › Badges de método.
 *
 * La Regla del Método Visible: el estado SIEMPRE lleva su palabra. El color
 * acompaña, nunca sustituye. Es el compromiso de accesibilidad del producto.
 */

const METODO: Record<MetodoMatch, { texto: string; clase: string }> = {
  exacta: { texto: "Exacta", clase: "bg-emerald-100 text-emerald-800" },
  difusa: { texto: "Difusa", clase: "bg-blue-100 text-blue-800" },
  ia: { texto: "IA", clase: "bg-violet-100 text-violet-800" },
  manual: { texto: "Manual", clase: "bg-neutral-200 text-neutral-700" },
};

export function BadgeMetodo({
  metodo,
  confianza,
  className = "",
}: {
  metodo: MetodoMatch;
  confianza?: number | null;
  className?: string;
}) {
  const m = METODO[metodo];
  const pct =
    metodo === "ia" && confianza != null
      ? ` ${Math.round(confianza * 100)}%`
      : "";
  return (
    <span
      className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${m.clase} ${className}`}
    >
      {m.texto}
      {pct}
    </span>
  );
}

/**
 * Estado de un job. La BD guarda el enum en inglés técnico
 * (`pendiente|procesando|completado|error`); la interfaz nunca lo muestra
 * crudo. Cada estado lleva punto + palabra, no solo color.
 */
const ESTADO_JOB: Record<
  string,
  { texto: string; clase: string; punto: string }
> = {
  pendiente: {
    texto: "En cola",
    clase: "bg-neutral-100 text-neutral-700 ring-neutral-200",
    punto: "bg-neutral-400",
  },
  procesando: {
    texto: "Conciliando",
    clase: "bg-blue-50 text-blue-800 ring-blue-200",
    punto: "bg-blue-500",
  },
  completado: {
    texto: "Completada",
    clase: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    punto: "bg-emerald-500",
  },
  error: {
    texto: "Con error",
    clase: "bg-red-50 text-red-800 ring-red-200",
    punto: "bg-red-500",
  },
};

export function BadgeEstadoJob({ estado }: { estado: string }) {
  const e = ESTADO_JOB[estado] ?? {
    texto: estado,
    clase: "bg-neutral-100 text-neutral-700 ring-neutral-200",
    punto: "bg-neutral-400",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${e.clase}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${e.punto}`} />
      {e.texto}
    </span>
  );
}

/**
 * Estado CONTABLE de una conciliación: si el documento rige o no. Eje distinto
 * al de `BadgeEstadoJob`, que dice si terminó de procesarse — un job puede
 * estar "Completada" y contablemente ser un borrador. Por eso conviven.
 */
const ESTADO_CONTABLE: Record<
  EstadoContable,
  { clase: string; punto: string }
> = {
  borrador: {
    clase: "bg-neutral-100 text-neutral-700 ring-neutral-200",
    punto: "bg-neutral-400",
  },
  en_proceso: {
    clase: "bg-neutral-100 text-neutral-700 ring-neutral-200",
    punto: "bg-neutral-400",
  },
  observada: {
    clase: "bg-amber-50 text-amber-900 ring-amber-200",
    punto: "bg-amber-500",
  },
  aprobada: {
    clase: "bg-emerald-50 text-emerald-900 ring-emerald-300",
    punto: "bg-emerald-600",
  },
  anulada: {
    clase: "bg-neutral-100 text-neutral-500 ring-neutral-200",
    punto: "bg-neutral-300",
  },
  reemplazada: {
    clase: "bg-neutral-100 text-neutral-500 ring-neutral-200",
    punto: "bg-neutral-300",
  },
};

export function BadgeEstadoContable({
  estado,
  version,
}: {
  estado: EstadoContable;
  version?: number | null;
}) {
  const e = ESTADO_CONTABLE[estado];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${e.clase}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${e.punto}`} />
      {ETIQUETA[estado]}
      {version != null && version > 1 && (
        <span className="tabular-nums opacity-70">· v{version}</span>
      )}
    </span>
  );
}

/** Pastilla ámbar de agrupación 1:N / N:1. */
export function BadgeAgrupacion({
  internos,
  movimientos,
}: {
  internos: number;
  movimientos: number;
}) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium tabular-nums text-amber-800">
      Agrupación {internos}:{movimientos}
    </span>
  );
}
