import type { MetodoMatch, EstadoJob } from "@/lib/contract/enums";
import { ETIQUETA, type EstadoContable } from "@/lib/cicloContable";
import { saludDelJob } from "@/lib/jobsAtascados";
import { ETIQUETA_METODO } from "@/lib/reportes";

/**
 * Badges del sistema — ver DESIGN.md § Components › Badges de método.
 *
 * La Regla del Método Visible: el estado SIEMPRE lleva su palabra. El color
 * acompaña, nunca sustituye. Es el compromiso de accesibilidad del producto.
 */

// ⚠️ El TEXTO sale de `ETIQUETA_METODO`, que es el mismo que usan el panel y los
// reportes. Aquí vivía su propia copia y decía «IA» donde el panel decía
// «Sugerido IA»: dos nombres para el mismo par en dos pantallas.
const CLASE: Record<MetodoMatch, string> = {
  exacta: "bg-emerald-100 text-emerald-800",
  difusa: "bg-blue-100 text-blue-800",
  ia: "bg-violet-100 text-violet-800",
  manual: "bg-neutral-200 text-neutral-700",
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
  const clase = CLASE[metodo];
  const pct =
    metodo === "ia" && confianza != null
      ? ` ${Math.round(confianza * 100)}%`
      : "";
  return (
    <span
      className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${clase} ${className}`}
    >
      {ETIQUETA_METODO[metodo]}
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

/**
 * `createdAt` es opcional pero conviene pasarlo: sin él, una conciliación que
 * n8n aceptó y luego abandonó figura como "Conciliando" en el historial
 * indefinidamente, y el historial es justo donde se va a mirar qué pasó con
 * ella. Ver `lib/jobsAtascados.ts`.
 */
export function BadgeEstadoJob({
  estado,
  createdAt,
}: {
  estado: string;
  createdAt?: string;
}) {
  const detenido =
    createdAt != null &&
    saludDelJob(estado as EstadoJob, createdAt) === "detenido";
  const e = detenido
    ? {
        // Ámbar y no rojo: nadie ha comprobado que fallara, solo que dejó de
        // avanzar. El color no debe afirmar más que el texto.
        texto: "Interrumpida",
        clase: "bg-amber-50 text-amber-800 ring-amber-200",
        punto: "bg-amber-500",
      }
    : (ESTADO_JOB[estado] ?? {
        texto: estado,
        clase: "bg-neutral-100 text-neutral-700 ring-neutral-200",
        punto: "bg-neutral-400",
      });
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
