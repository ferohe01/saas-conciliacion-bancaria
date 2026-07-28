/**
 * Período de prueba por empresa.
 *
 * Regla de producto: 30 días desde el alta. Al vencer, la empresa **conserva
 * todo el acceso de lectura** (historial, resultados, reportes, cuentas,
 * configuración) y pierde una sola capacidad: iniciar una conciliación nueva.
 *
 * Funciones puras y sin dependencias, para poder testearlas y para que el mismo
 * criterio valga en el servidor (donde se hace cumplir) y en la interfaz (donde
 * se explica).
 */

export const DIAS_PRUEBA = 30;

/**
 * Canal de contacto para dudas sobre la activación.
 *
 * ⚠️ PLACEHOLDER: cámbialo por el correo comercial real.
 */
export const CONTACTO_SUSCRIPCION = "mailto:ferohe22@gmail.com";

/**
 * Datos para activar la cuenta. Fuente única: los usa el modal de pago y
 * cualquier texto que los mencione.
 *
 * Hoy solo hay transferencia bancaria; cuando entre una pasarela, esto deja de
 * ser una constante y pasa a ser una opción más.
 */
export const DATOS_PAGO = {
  banco: "Banco de Crédito del Perú",
  bancoCorto: "BCP",
  tipo: "Cuenta de ahorro en soles",
  moneda: "S/",
  numero: "193-30402506-001",
  /** Código de Cuenta Interbancario: necesario para transferir desde otro banco. */
  cci: "00219313040250600118",
  // Literal como lo dio el titular: debe coincidir con el registro del banco.
  titular: "Fernando Rodriguez Henostroza",
  cargo: "CEO",
} as const;

export type PlanEmpresa = "prueba" | "activo";

export type EmpresaSuscripcion = {
  plan?: string | null;
  prueba_hasta?: string | null;
  created_at?: string | null;
};

export type EstadoSuscripcion = {
  plan: PlanEmpresa;
  /** ¿Puede iniciar una conciliación nueva? */
  puedeConciliar: boolean;
  /** La prueba venció (solo aplica al plan 'prueba'). */
  expirada: boolean;
  /** Días completos que faltan. 0 si venció o si el plan no es de prueba. */
  diasRestantes: number;
  /** Fin de la prueba, o null en plan 'activo'. */
  fin: Date | null;
};

const MS_DIA = 24 * 60 * 60 * 1000;

function aFecha(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Calcula el estado de suscripción de una empresa.
 *
 * Si no hay ninguna fecha utilizable (`prueba_hasta` ni `created_at`), se
 * concede el acceso: preferimos no bloquear a un cliente por un dato ausente,
 * porque el coste de un falso bloqueo es mucho mayor que el de una prueba de
 * más. La migración 0005 rellena `prueba_hasta` para todas las filas.
 */
export function estadoSuscripcion(
  empresa: EmpresaSuscripcion,
  ahora: Date = new Date(),
): EstadoSuscripcion {
  const plan: PlanEmpresa = empresa.plan === "activo" ? "activo" : "prueba";

  if (plan === "activo") {
    return { plan, puedeConciliar: true, expirada: false, diasRestantes: 0, fin: null };
  }

  const alta = aFecha(empresa.created_at);
  const fin =
    aFecha(empresa.prueba_hasta) ??
    (alta ? new Date(alta.getTime() + DIAS_PRUEBA * MS_DIA) : null);

  if (!fin) {
    return { plan, puedeConciliar: true, expirada: false, diasRestantes: DIAS_PRUEBA, fin: null };
  }

  const restanteMs = fin.getTime() - ahora.getTime();
  const expirada = restanteMs <= 0;

  return {
    plan,
    puedeConciliar: !expirada,
    expirada,
    diasRestantes: expirada ? 0 : Math.ceil(restanteMs / MS_DIA),
    fin,
  };
}

/** Texto corto para avisar de que la prueba está por terminar. */
export function avisoPorVencer(estado: EstadoSuscripcion): string | null {
  if (estado.plan !== "prueba" || estado.expirada) return null;
  if (estado.diasRestantes > 7) return null;
  if (estado.diasRestantes <= 1) return "Tu prueba termina hoy.";
  return `Tu prueba termina en ${estado.diasRestantes} días.`;
}
