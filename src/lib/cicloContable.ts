/**
 * Ciclo de vida contable de una conciliación (migración 0012).
 *
 * Eje distinto al de `estado`, que describe el procesamiento en n8n. Aquí se
 * responde a "¿este documento rige?", no a "¿terminó de correr?".
 *
 * Funciones puras: la base impone la regla dura (una sola aprobada por rango,
 * vía constraint de exclusión) y esto gobierna qué le ofrecemos a la persona.
 */

export const ESTADOS_CONTABLES = [
  "borrador",
  "en_proceso",
  "observada",
  "aprobada",
  "anulada",
  "reemplazada",
] as const;

export type EstadoContable = (typeof ESTADOS_CONTABLES)[number];

export const ACCIONES = ["aprobar", "observar", "anular", "reabrir"] as const;
export type AccionContable = (typeof ACCIONES)[number];

/**
 * Estados cuyo resultado se refleja en el saldo de los comprobantes.
 *
 * Solo la aprobada. Un borrador puede tener decisiones confirmadas y aun así no
 * mover un céntimo: mientras no se apruebe no rige, y dos borradores del mismo
 * período coexisten legítimamente. Antes las aplicaciones se escribían al
 * confirmar decisiones, así que dos corridas del mismo mes descontaban el saldo
 * dos veces — el constraint de la 0012 vuelve imposible que haya dos aprobadas
 * solapadas, y con esta regla el doble descuento deja de poder ocurrir.
 */
export function afectaSaldo(estado: EstadoContable): boolean {
  return estado === "aprobada";
}

/** Estados desde los que ya no se admite ninguna transición: cerrados. */
const TERMINALES: readonly EstadoContable[] = ["anulada", "reemplazada"];

/**
 * Transiciones permitidas. `reemplazada` no aparece como destino a propósito:
 * no es algo que alguien elija, sino la consecuencia de aprobar otra versión
 * del mismo rango. La pone la base al aprobar (función `aprobar_conciliacion`).
 */
const PERMITIDAS: Record<EstadoContable, readonly AccionContable[]> = {
  borrador: ["aprobar", "observar", "anular"],
  en_proceso: ["aprobar", "observar", "anular"],
  observada: ["aprobar", "reabrir", "anular"],
  aprobada: ["observar", "anular"],
  anulada: [],
  reemplazada: [],
};

export function accionesPosibles(
  estado: EstadoContable,
): readonly AccionContable[] {
  return PERMITIDAS[estado] ?? [];
}

export function puede(estado: EstadoContable, accion: AccionContable): boolean {
  return accionesPosibles(estado).includes(accion);
}

export function esTerminal(estado: EstadoContable): boolean {
  return TERMINALES.includes(estado);
}

/** Estado al que lleva una acción. `aprobar` es el único que rige. */
export function destino(accion: AccionContable): EstadoContable {
  switch (accion) {
    case "aprobar":
      return "aprobada";
    case "observar":
      return "observada";
    case "anular":
      return "anulada";
    case "reabrir":
      return "borrador";
  }
}

/**
 * Solo tiene sentido aprobar algo que n8n terminó de procesar: aprobar un job
 * a medias congelaría un resultado incompleto.
 */
export function puedeAprobarse(
  estadoContable: EstadoContable,
  estadoTecnico: string,
): { ok: true } | { ok: false; motivo: string } {
  if (estadoTecnico !== "completado") {
    return {
      ok: false,
      motivo:
        "Esta conciliación todavía no ha terminado de procesarse. Espera a que finalice para aprobarla.",
    };
  }
  if (!puede(estadoContable, "aprobar")) {
    return {
      ok: false,
      motivo:
        estadoContable === "aprobada"
          ? "Esta conciliación ya está aprobada."
          : "Una conciliación anulada o reemplazada ya no puede aprobarse. Vuelve a conciliar el período si necesitas rehacerla.",
    };
  }
  return { ok: true };
}

/** Etiquetas en español para la interfaz. */
export const ETIQUETA: Record<EstadoContable, string> = {
  borrador: "Borrador",
  en_proceso: "En proceso",
  observada: "Observada",
  aprobada: "Aprobada",
  anulada: "Anulada",
  reemplazada: "Reemplazada",
};

/** Qué significa cada estado, en lenguaje de quien no es contador. */
export const EXPLICACION: Record<EstadoContable, string> = {
  borrador:
    "Todavía no rige. Puedes revisarla y cambiarla; el saldo de tus comprobantes no se moverá hasta que la apruebes.",
  en_proceso: "Se está trabajando en ella.",
  observada:
    "Alguien marcó que algo no cuadra. No rige hasta que se resuelva y se apruebe.",
  aprobada:
    "Es la conciliación que vale para este período. Es la que descuenta el saldo de tus comprobantes.",
  anulada: "Se descartó. Se conserva solo como historial.",
  reemplazada:
    "Otra versión de este mismo período se aprobó en su lugar. Se conserva para poder rastrear qué cambió.",
};

/**
 * ── El aviso previo a aprobar ───────────────────────────────────────────────
 *
 * Aprobar nunca falla por solapamiento: la base degrada a `reemplazada` las
 * aprobadas que se crucen y borra sus aplicaciones de cobro. Correcto —dos
 * conciliaciones vigentes sobre el mismo día contarían el saldo dos veces— pero
 * era invisible hasta después, cuando `reemplazada` ya es un estado terminal.
 *
 * Aquí se redacta lo que va a pasar, con las cifras reales. `null` cuando no
 * hay nada que reemplazar: entonces no se pregunta nada, porque un diálogo que
 * siempre sale se aprende a despachar sin leer y deja de proteger justo el día
 * que dice algo importante.
 */
export function avisoDeReemplazo(impacto: {
  reemplaza: { desde: string; hasta: string }[];
  aplicaciones: number;
}): string | null {
  const n = impacto.reemplaza.length;
  if (n === 0) return null;

  const dia = (iso: string) => iso.split("-").reverse().join("/");
  const rango = (r: { desde: string; hasta: string }) =>
    r.desde === r.hasta ? dia(r.desde) : `${dia(r.desde)} a ${dia(r.hasta)}`;

  const cuales =
    n === 1
      ? `la conciliación aprobada de ${rango(impacto.reemplaza[0]!)}`
      : `${n} conciliaciones aprobadas (${impacto.reemplaza.map(rango).join("; ")})`;

  // El número de cobros es el dato que mide el daño: "reemplaza una
  // conciliación" suena a trámite, "se borran 1.234 cobros" no.
  const cobros =
    impacto.aplicaciones === 0
      ? "No tenía cobros aplicados, así que ningún saldo cambiará."
      : impacto.aplicaciones === 1
        ? "Se borrará 1 cobro aplicado y el saldo de ese comprobante volverá a quedar pendiente."
        : `Se borrarán ${impacto.aplicaciones.toLocaleString("es-PE")} cobros aplicados y el saldo de esos comprobantes volverá a quedar pendiente.`;

  return (
    `Al aprobar esta conciliación dejará de regir ${cuales}. ` +
    `${cobros} Ese cambio no se puede deshacer: para recuperarla habría que ` +
    `volver a ejecutarla.\n\n¿Continuar?`
  );
}
