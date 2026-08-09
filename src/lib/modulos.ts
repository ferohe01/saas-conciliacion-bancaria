/**
 * Módulos del sistema.
 *
 * ⚠️ **NO son compras aparte.** El sistema se vende entero: quien está en
 * prueba y quien paga tienen exactamente las mismas funciones. Un cliente que
 * ya pagó y aun así encuentra una pantalla cerrada no entiende qué compró, y la
 * conversación deja de ser sobre el producto para pasar a ser sobre la factura.
 *
 * Lo que queda de este archivo es el **catálogo**: nombre y descripción para
 * poder decir qué incluye el sistema y para redactar el bloqueo cuando la
 * prueba vence sin activarse. El acceso lo decide `empresas.plan` /
 * `prueba_hasta` (ver `lib/suscripcion.ts`), igual que la conciliación.
 *
 * `suscripciones_modulo` (migración 0009) sobrevive como concesión suelta —
 * cortesía, acuerdo puntual, un cliente antiguo— y sigue abriendo el módulo,
 * pero **ya no es el camino por el que nadie obtiene acceso**.
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
};

export const MODULOS: readonly Modulo[] = [
  {
    id: "cobranzas",
    nombre: "Cuentas por cobrar y pagar",
    descripcion:
      "Mira quién te debe y a quién le debes, con su antigüedad. Cada conciliación descuenta lo cobrado y lo pagado, así que los saldos se mantienen solos.",
  },
] as const;

export function buscarModulo(id: string): Modulo | undefined {
  return MODULOS.find((m) => m.id === id);
}

export type SuscripcionModulo = {
  modulo: string;
  activo_hasta?: string | null;
};

/**
 * Lo que la cuenta incluye, tal como lo ve este archivo.
 *
 * Solo necesita saber si el sistema está abierto y hasta cuándo; quién lo
 * calcula es `lib/suscripcion.ts`. Se pasa como dato en vez de importarlo para
 * que este módulo siga siendo puro y para que la regla —**el sistema se vende
 * entero**— se lea en un único sitio.
 */
export type AccesoCuenta = {
  /** `plan` = cliente de pago; `prueba` = los 30 días gratuitos. */
  motivo: "plan" | "prueba";
  /** Fin del acceso; null si no caduca (plan activo). */
  fin: Date | null;
  /** Días completos que faltan; null si no caduca. */
  diasRestantes: number | null;
};

/** De dónde viene el acceso. `null` cuando no hay acceso. */
export type OrigenModulo = "plan" | "prueba" | "contratado";

export type EstadoModulo = {
  id: ModuloId;
  activo: boolean;
  /** Qué concede el acceso: el plan, la prueba, o una concesión suelta. */
  origen: OrigenModulo | null;
  /** Fin del acceso; null si no caduca o si no está activo. */
  fin: Date | null;
  /** Días completos que faltan. null si no caduca o no está activo. */
  diasRestantes: number | null;
};

const MS_DIA = 24 * 60 * 60 * 1000;

/**
 * ¿Está activo un módulo para esta empresa?
 *
 * **El sistema se vende entero.** Quien paga y quien está en prueba ven
 * exactamente lo mismo: no hay nada que comprar por separado. Dos razones, y
 * cada una bastaría:
 *
 * - **Al que paga**, encontrarse una pantalla cerrada le hace preguntarse qué
 *   compró. Un cliente que ya soltó el dinero es el peor momento para pedirle
 *   más, y convierte la conversación de producto en una de factura.
 * - **Al que prueba**, un candado no le protege ningún ingreso —nadie está
 *   pagando todavía— y le esconde justo el motivo por el que pagaría. Quien no
 *   usó las cuentas por cobrar en 30 días no puede echarlas de menos el día 31.
 *
 * Así que el único estado que cierra un módulo es **la prueba vencida sin
 * activar la cuenta**, que es el mismo que impide conciliar. Un solo límite,
 * fácil de explicar y de recordar.
 *
 * `suscripciones_modulo` se conserva como concesión suelta (cortesía, acuerdo
 * puntual) y sigue abriendo el módulo por su cuenta, pero ya no es el camino
 * por el que nadie obtiene acceso. Ahí sí **la ausencia de dato significa NO**.
 */
export function estadoModulo(
  id: ModuloId,
  suscripciones: SuscripcionModulo[] | null | undefined,
  ahora: Date = new Date(),
  cuenta: AccesoCuenta | null = null,
): EstadoModulo {
  // El plan incluye todo y no caduca por módulo: es lo primero que se mira.
  if (cuenta?.motivo === "plan") {
    return { id, activo: true, origen: "plan", fin: null, diasRestantes: null };
  }

  const porCuenta: EstadoModulo | null = cuenta
    ? {
        id,
        activo: true,
        origen: "prueba",
        fin: cuenta.fin,
        diasRestantes: cuenta.diasRestantes,
      }
    : null;

  const s = (suscripciones ?? []).find((x) => x.modulo === id);
  if (!s) {
    return porCuenta ?? { id, activo: false, origen: null, fin: null, diasRestantes: null };
  }

  // Sin fecha = sin vencimiento (cortesía o acuerdo especial).
  if (!s.activo_hasta) {
    return { id, activo: true, origen: "contratado", fin: null, diasRestantes: null };
  }

  const fin = new Date(s.activo_hasta);
  if (Number.isNaN(fin.getTime())) {
    return porCuenta ?? { id, activo: false, origen: null, fin: null, diasRestantes: null };
  }

  const restanteMs = fin.getTime() - ahora.getTime();
  if (restanteMs <= 0) {
    return porCuenta ?? { id, activo: false, origen: null, fin, diasRestantes: 0 };
  }

  return {
    id,
    activo: true,
    origen: "contratado",
    fin,
    diasRestantes: Math.ceil(restanteMs / MS_DIA),
  };
}

/** Atajo para los controles de acceso. */
export function tieneModulo(
  id: ModuloId,
  suscripciones: SuscripcionModulo[] | null | undefined,
  ahora: Date = new Date(),
  cuenta: AccesoCuenta | null = null,
): boolean {
  return estadoModulo(id, suscripciones, ahora, cuenta).activo;
}

/**
 * Aviso cuando un módulo está por vencer.
 *
 * El texto cambia según el origen porque lo que se acaba es distinto: un módulo
 * contratado vence solo, mientras que en la prueba lo que termina es la prueba
 * entera. Decir "Vence en 3 días" sobre algo incluido en la prueba haría creer
 * que se pierde ese módulo y se conserva el resto.
 */
export function avisoModuloPorVencer(e: EstadoModulo): string | null {
  if (!e.activo || e.diasRestantes === null) return null;
  if (e.diasRestantes > 7) return null;

  if (e.origen === "prueba") {
    return e.diasRestantes <= 1
      ? "Tu prueba termina hoy."
      : `Tu prueba termina en ${e.diasRestantes} días.`;
  }

  if (e.diasRestantes <= 1) return "Vence hoy.";
  return `Vence en ${e.diasRestantes} días.`;
}
