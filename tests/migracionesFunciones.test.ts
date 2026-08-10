import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `create or replace function` NO PUEDE CAMBIAR EL TIPO DE RETORNO.
 *
 * ⚠️ Se aprendió aplicando la `0041` en producción, a mitad de la migración:
 *
 *     ERROR 42P13: cannot change return type of existing function
 *     DETAIL: Row type defined by OUT parameters is different.
 *     HINT: Use DROP FUNCTION resumen_saldos(...) first.
 *
 * Lo caro no es el error —que al menos es ruidoso— sino **dónde ocurre**: a
 * mitad de una migración larga, con la mitad de las sentencias ya aplicadas y
 * la otra mitad no. Aquí las migraciones son re-ejecutables y no pasó nada,
 * pero eso es una propiedad que hay que sostener a mano.
 *
 * Este test no ejecuta SQL: lee las migraciones en orden y avisa cuando una
 * redefine una función cambiando su forma de salida sin soltarla antes. No
 * cubre todos los casos que Postgres rechaza —cambiar el tipo de un parámetro,
 * por ejemplo— pero sí el que ya mordió.
 */

const DIR = join(process.cwd(), "supabase", "migrations");

type Definicion = {
  archivo: string;
  nombre: string;
  /** Cuántos parámetros declara, para no confundir sobrecargas. */
  params: number;
  /** La cláusula `returns …`, normalizada. */
  retorno: string;
};

/** Recorre las definiciones de función de un archivo, en orden. */
function definiciones(archivo: string, sql: string): Definicion[] {
  const out: Definicion[] = [];
  const re =
    /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\s+language\s/gi;

  for (const m of sql.matchAll(re)) {
    const [, nombre, args, retorno] = m;
    out.push({
      archivo,
      nombre: nombre!,
      // Los parámetros se separan por comas de primer nivel; aquí no hay tipos
      // compuestos con comas, así que basta con contarlas.
      params: args!.trim() === "" ? 0 : args!.split(",").length,
      retorno: retorno!.replace(/\s+/g, " ").trim().toLowerCase(),
    });
  }
  return out;
}

/** ¿El archivo suelta esa función antes de redefinirla? */
function laSuelta(sql: string, nombre: string): boolean {
  return new RegExp(`drop\\s+function\\s+if\\s+exists\\s+public\\.${nombre}\\s*\\(`, "i").test(
    sql,
  );
}

describe("migraciones que redefinen funciones", () => {
  const archivos = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  it("hay migraciones que revisar", () => {
    expect(archivos.length).toBeGreaterThan(0);
  });

  it("⚠️ ninguna cambia el tipo de retorno sin soltar la función antes", () => {
    // Última forma conocida de cada función, por nombre + nº de parámetros.
    const conocidas = new Map<string, Definicion>();
    const problemas: string[] = [];

    for (const archivo of archivos) {
      const sql = readFileSync(join(DIR, archivo), "utf8");
      for (const def of definiciones(archivo, sql)) {
        const clave = `${def.nombre}/${def.params}`;
        const previa = conocidas.get(clave);

        if (previa && previa.retorno !== def.retorno && !laSuelta(sql, def.nombre)) {
          problemas.push(
            `${archivo}: ${def.nombre} cambia su retorno respecto de ` +
              `${previa.archivo} y no lleva "drop function if exists ` +
              `public.${def.nombre}(...)" antes. Postgres lo rechaza con 42P13.`,
          );
        }
        conocidas.set(clave, def);
      }
    }

    expect(problemas, problemas.join("\n")).toEqual([]);
  });
});
