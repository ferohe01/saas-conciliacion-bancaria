import { z } from "zod";

/**
 * Validación de la ficha de "Conectar sistema".
 *
 * Separado de `conexiones.ts` a propósito: aquel lo importa el formulario, que
 * es un componente cliente, y zod no tiene nada que hacer en el navegador para
 * una validación que solo ocurre en el servidor.
 *
 * Los vacíos se normalizan a `null` en vez de a cadena vacía: en la BD son
 * campos opcionales, y `''` obligaría a preguntar por las dos cosas en cada
 * lectura.
 */

const textoOpcional = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((v) => (v === "" ? null : (v ?? null)));

/**
 * La URL se guarda por comodidad del equipo que preparará la conexión, así que
 * se valida con la vara justa: que sea una URL y que sea `https`. Un endpoint
 * de facturación por `http` no lo vamos a consumir nunca, y aceptarlo ahora
 * sería prometer que sí.
 */
const urlOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? null : (v ?? null)))
  .refine(
    (v) => {
      if (v === null) return true;
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    },
    {
      message:
        "La dirección debe empezar por https:// (por ejemplo https://api.tusistema.com).",
    },
  );

export const ConexionErpInput = z
  .object({
    sistema: z
      .string()
      .trim()
      .min(1, "Elige el sistema donde emites tus comprobantes."),
    nombre_sistema: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => (v === "" ? null : (v ?? null))),
    url_base: urlOpcional,
    identificador: textoOpcional,
    // Mismos valores que el check de `conexiones_erp.frecuencia` en la 0017.
    frecuencia: z.enum(["manual", "diaria", "semanal"]),
    contacto: textoOpcional,
    notas: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => (v === "" ? null : (v ?? null))),
  })
  // Espejo de `conexiones_erp_nombre_chk`: 'otro' sin nombre deja una ficha
  // inservible. La base lo rechazaría igual, pero con un error de Postgres en
  // vez de una frase que señale el campo.
  .refine((c) => c.sistema !== "otro" || (c.nombre_sistema ?? "") !== "", {
    message: "Escribe el nombre de tu sistema.",
    path: ["nombre_sistema"],
  });
