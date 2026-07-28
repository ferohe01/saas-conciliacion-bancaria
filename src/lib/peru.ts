/**
 * Datos y validaciones de Perú para el alta de empresas.
 *
 * Funciones puras y sin dependencias: el mismo criterio vale en el formulario
 * (donde guía) y en el endpoint (donde se hace cumplir).
 */

/**
 * Las 25 regiones del Perú: 24 departamentos más la Provincia Constitucional
 * del Callao. Es la división que usan los formularios oficiales.
 */
export const REGIONES = [
  "Amazonas",
  "Áncash",
  "Apurímac",
  "Arequipa",
  "Ayacucho",
  "Cajamarca",
  "Callao",
  "Cusco",
  "Huancavelica",
  "Huánuco",
  "Ica",
  "Junín",
  "La Libertad",
  "Lambayeque",
  "Lima",
  "Loreto",
  "Madre de Dios",
  "Moquegua",
  "Pasco",
  "Piura",
  "Puno",
  "San Martín",
  "Tacna",
  "Tumbes",
  "Ucayali",
] as const;

export type Region = (typeof REGIONES)[number];

export function esRegionValida(v: string): boolean {
  return (REGIONES as readonly string[]).includes(v);
}

/**
 * RUC peruano: 11 dígitos.
 *
 * Se valida solo la longitud, NO el prefijo (10/15/16/17/20) ni el dígito
 * verificador. Es deliberado: bloquear a un cliente real por una regla de más
 * cuesta mucho más que aceptar un RUC mal tecleado, que se corrige después
 * desde Configuración.
 */
export function esRucValido(v: string): boolean {
  return /^\d{11}$/.test(v.trim());
}

/** Deja solo los dígitos de un teléfono, para poder contarlos. */
export function digitosTelefono(v: string): string {
  return v.replace(/\D/g, "");
}

/**
 * Teléfono peruano: móvil de 9 dígitos, fijo de 7 a 9 según provincia, y con
 * prefijo internacional llega a 11-12. Se admite de 6 a 15 dígitos y cualquier
 * separador (espacios, guiones, paréntesis, +).
 */
export function esTelefonoValido(v: string): boolean {
  const d = digitosTelefono(v);
  return d.length >= 6 && d.length <= 15;
}
