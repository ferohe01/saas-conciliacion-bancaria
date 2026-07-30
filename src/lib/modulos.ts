/**
 * Módulos que se activan previo pago.
 *
 * El producto base (conciliación) NO vive aquí: se rige por `empresas.plan` y
 * `prueba_hasta` (ver `lib/suscripcion.ts`), que tienen semántica de prueba de
 * 30 días. Un módulo comprado no caduca así, por eso son mecanismos separados.
 *
 * Funciones puras: el mismo criterio vale en el servidor (donde se hace
 * cumplir) y en la interfaz (donde se explica).
 */

export type ModuloId = "cobranzas";

export type Modulo = {
  id: ModuloId;
  nombre: string;
  /** Qué gana el usuario, en su idioma. No una lista de funciones. */
  descripcion: string;
  /**
   * Precio mensual en soles.
   *
   * ⚠️ `null` = todavía sin decidir; la interfaz dice "Consúltanos" en lugar de
   * inventar una cifra. Ponerle número cuando esté definido.
   */
  precioMensual: number | null;
};

export const MODULOS: readonly Modulo[] = [
  {
    id: "cobranzas",
    nombre: "Cuentas por cobrar y pagar",
    descripcion:
      "Mira quién te debe y a quién le debes, con su antigüedad. Cada conciliación descuenta lo cobrado y lo pagado, así que los saldos se mantienen solos.",
    precioMensual: null,
  },
] as const;

export function buscarModulo(id: string): Modulo | undefined {
  return MODULOS.find((m) => m.id === id);
}

export type SuscripcionModulo = {
  modulo: string;
  activo_hasta?: string | null;
};

export type EstadoModulo = {
  id: ModuloId;
  activo: boolean;
  /** Fin de la suscripción; null si no caduca o si no está activo. */
  fin: Date | null;
  /** Días completos que faltan. null si no caduca o no está activo. */
  diasRestantes: number | null;
};

const MS_DIA = 24 * 60 * 60 * 1000;

/**
 * ¿Está activo un módulo para esta empresa?
 *
 * Al revés que el período de prueba, aquí **la ausencia de dato significa NO**:
 * un módulo que no se ha comprado no está activo. En la prueba preferimos no
 * bloquear ante un dato ausente porque el coste de dejar fuera a un cliente que
 * pagó es alto; aquí el coste de regalar un módulo de pago también lo es, y la
 * fila existe precisamente cuando se compró.
 */
export function estadoModulo(
  id: ModuloId,
  suscripciones: SuscripcionModulo[] | null | undefined,
  ahora: Date = new Date(),
): EstadoModulo {
  const s = (suscripciones ?? []).find((x) => x.modulo === id);
  if (!s) return { id, activo: false, fin: null, diasRestantes: null };

  // Sin fecha = sin vencimiento (cortesía o acuerdo especial).
  if (!s.activo_hasta) {
    return { id, activo: true, fin: null, diasRestantes: null };
  }

  const fin = new Date(s.activo_hasta);
  if (Number.isNaN(fin.getTime())) {
    return { id, activo: false, fin: null, diasRestantes: null };
  }

  const restanteMs = fin.getTime() - ahora.getTime();
  if (restanteMs <= 0) return { id, activo: false, fin, diasRestantes: 0 };

  return {
    id,
    activo: true,
    fin,
    diasRestantes: Math.ceil(restanteMs / MS_DIA),
  };
}

/** Atajo para los controles de acceso. */
export function tieneModulo(
  id: ModuloId,
  suscripciones: SuscripcionModulo[] | null | undefined,
  ahora: Date = new Date(),
): boolean {
  return estadoModulo(id, suscripciones, ahora).activo;
}

/** Aviso cuando un módulo está por vencer. */
export function avisoModuloPorVencer(e: EstadoModulo): string | null {
  if (!e.activo || e.diasRestantes === null) return null;
  if (e.diasRestantes > 7) return null;
  if (e.diasRestantes <= 1) return "Vence hoy.";
  return `Vence en ${e.diasRestantes} días.`;
}
