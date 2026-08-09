import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";
import { estadoSuscripcion, type EstadoSuscripcion } from "@/lib/suscripcion";
import {
  tieneModulo,
  type AccesoCuenta,
  type ModuloId,
  type SuscripcionModulo,
} from "@/lib/modulos";

/**
 * Lectura de módulos contratados (solo servidor).
 *
 * `lib/modulos.ts` queda puro y sin dependencias para poder testearlo y usarlo
 * también en componentes cliente; aquí vive lo que toca la base.
 */

export async function getSuscripcionesModulo(): Promise<SuscripcionModulo[]> {
  const supabase = await createClient(); // RLS: solo la empresa del usuario
  const { data } = await supabase
    .from("suscripciones_modulo")
    .select("modulo, activo_hasta");
  return (data ?? []) as SuscripcionModulo[];
}

/**
 * Qué incluye la cuenta hoy: el plan de pago, la prueba en curso, o nada
 * (prueba vencida sin activar).
 *
 * En los dos primeros casos **el sistema está abierto entero** — ver la nota de
 * `estadoModulo`: no hay nada que comprar por separado.
 */
export async function getAccesoCuenta(): Promise<AccesoCuenta | null> {
  const empresa = await getEmpresaActual();
  return empresa ? accesoDe(estadoSuscripcion(empresa)) : null;
}

/** Traduce el estado de suscripción a lo que `estadoModulo` necesita saber. */
function accesoDe(e: EstadoSuscripcion): AccesoCuenta | null {
  if (e.plan === "activo") return { motivo: "plan", fin: null, diasRestantes: null };
  if (e.expirada) return null;
  return { motivo: "prueba", fin: e.fin, diasRestantes: e.diasRestantes };
}

/**
 * Control de acceso a un módulo, para usar en server actions y route handlers.
 *
 * Es el punto donde el límite se hace cumplir. Ocultar un enlace en la
 * interfaz no es un control: el endpoint sigue estando ahí para quien lo
 * llame directo — la misma lección del período de prueba.
 *
 *     const permitido = await empresaTieneModulo("cobranzas");
 *     if (!permitido) return { ok: false, error: "Módulo no contratado." };
 */
export async function empresaTieneModulo(id: ModuloId): Promise<boolean> {
  return (await accesoModulo(id)).permitido;
}

export type AccesoModulo = {
  permitido: boolean;
  /**
   * El acceso se perdió al vencer la prueba (no es que nunca lo tuviera).
   * Cambia lo que hay que decirle al usuario: durante la prueba SÍ lo usó.
   */
  pruebaVencida: boolean;
};

/**
 * Igual que `empresaTieneModulo`, pero además dice **por qué** no hay acceso.
 * Lo usan las pantallas para redactar el bloqueo; el control en sí es el mismo.
 */
export async function accesoModulo(id: ModuloId): Promise<AccesoModulo> {
  const [suscripciones, empresa] = await Promise.all([
    getSuscripcionesModulo(),
    getEmpresaActual(),
  ]);

  const s = empresa ? estadoSuscripcion(empresa) : null;

  return {
    permitido: tieneModulo(id, suscripciones, new Date(), s ? accesoDe(s) : null),
    pruebaVencida: s?.expirada === true,
  };
}
