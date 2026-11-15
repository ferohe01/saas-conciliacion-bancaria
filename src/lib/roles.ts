/**
 * Roles y permisos de los usuarios de una empresa (migración 0057).
 *
 * Cuatro roles, de más a menos:
 *
 *   administrador — todo, incluida la gestión de usuarios y la configuración.
 *   aprobador     — carga, concilia, decide y APRUEBA/anula conciliaciones.
 *   conciliador   — carga, concilia y decide sugerencias; no aprueba.
 *   consulta      — solo lectura.
 *
 * Puro y con tests (`tests/roles.test.ts`). El control se hace cumplir en el
 * SERVIDOR (`roles-servidor.ts`), en cada server action y ruta que escribe:
 * ocultar un botón orienta, no protege.
 */

export const ROLES = ["administrador", "aprobador", "conciliador", "consulta"] as const;
export type Rol = (typeof ROLES)[number];

export const PERMISOS = [
  "cargar",
  "conciliar",
  "decidir",
  "aprobar",
  "configurar",
  "gestionar_usuarios",
] as const;
export type Permiso = (typeof PERMISOS)[number];

const MATRIZ: Record<Rol, readonly Permiso[]> = {
  administrador: PERMISOS,
  aprobador: ["cargar", "conciliar", "decidir", "aprobar"],
  conciliador: ["cargar", "conciliar", "decidir"],
  consulta: [],
};

export const NOMBRE_ROL: Record<Rol, string> = {
  administrador: "Administrador",
  aprobador: "Aprobador",
  conciliador: "Conciliador",
  consulta: "Consulta",
};

export const DESCRIPCION_ROL: Record<Rol, string> = {
  administrador: "Todo, incluida la gestión de usuarios y la configuración.",
  aprobador: "Carga, concilia, revisa sugerencias y aprueba conciliaciones.",
  conciliador: "Carga, concilia y revisa sugerencias. No aprueba.",
  consulta: "Solo consulta: ve todo, no cambia nada.",
};

/**
 * El rol guardado, normalizado.
 *
 * `'admin'` es el valor que escribía el registro antes de la 0057: era el único
 * usuario de su empresa, así que es su administrador. Cualquier otro valor
 * desconocido degrada a `consulta`, nunca al revés: un rol mal escrito no puede
 * dar más permisos de los que nadie concedió (mismo criterio que `plan` en
 * `suscripcion.ts` y `modoCarga`).
 */
export function rolDe(valor: unknown): Rol {
  if (valor === "admin") return "administrador";
  return (ROLES as readonly unknown[]).includes(valor) ? (valor as Rol) : "consulta";
}

export function puede(rol: Rol, permiso: Permiso): boolean {
  return MATRIZ[rol].includes(permiso);
}

/** Qué decirle a alguien a quien su rol no le deja hacer algo. */
export function motivoSinPermiso(rol: Rol, permiso: Permiso): string {
  const que: Record<Permiso, string> = {
    cargar: "cargar archivos",
    conciliar: "iniciar conciliaciones",
    decidir: "aceptar o rechazar sugerencias",
    aprobar: "aprobar o anular conciliaciones",
    configurar: "cambiar la configuración",
    gestionar_usuarios: "gestionar usuarios",
  };
  return `Tu rol (${NOMBRE_ROL[rol]}) no permite ${que[permiso]}. Pídeselo a un administrador de tu empresa.`;
}

/**
 * Separación de funciones al aprobar («cuatro ojos»).
 *
 * Quien inició una conciliación no la aprueba él mismo — salvo que en la
 * empresa NO haya otra persona que pueda aprobar. Una regla absoluta dejaría a
 * toda empresa de un solo usuario (la mayoría de las PyMEs) sin poder aprobar
 * nunca; y en cuanto existe un segundo aprobador, el control se aplica sin
 * excepción, que es lo que un auditor comprueba.
 *
 * `otrosAprobadores` = miembros, distintos del iniciador, cuyo rol permite
 * aprobar.
 */
export function separacionAlAprobar(args: {
  aprobadorId: string;
  iniciadorId: string | null;
  otrosAprobadores: number;
}): { ok: true } | { ok: false; motivo: string } {
  if (!args.iniciadorId || args.aprobadorId !== args.iniciadorId) return { ok: true };
  if (args.otrosAprobadores === 0) return { ok: true };
  return {
    ok: false,
    motivo:
      "Iniciaste tú esta conciliación, así que debe aprobarla otra persona con rol Aprobador o Administrador. Es el control de cuatro ojos: quien prepara no aprueba.",
  };
}

/**
 * Cuántos administradores quedarían. Una empresa nunca se queda sin ninguno:
 * nadie podría volver a gestionar usuarios ni configuración.
 */
export function dejaSinAdministrador(
  roles: { usuarioId: string; rol: Rol }[],
  cambio: { usuarioId: string; nuevoRol: Rol | null },
): boolean {
  const tras = roles
    .filter((r) => r.usuarioId !== cambio.usuarioId)
    .map((r) => r.rol)
    .concat(cambio.nuevoRol ? [cambio.nuevoRol] : []);
  return !tras.includes("administrador");
}
