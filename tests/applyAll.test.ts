import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `supabase/apply_all.sql` es LA vía de despliegue del esquema: Supabase es
 * self-hosted y el repo no es un proyecto de CLI, así que `supabase db push` no
 * aplica y el script se pega en el SQL Editor de Studio.
 *
 * ⚠️ Se quedó desactualizado desde la `0020` y nadie se enteró: las migraciones
 * 0021–0036 se aplicaron a mano una a una, así que producción funcionaba
 * mientras el script oficial **no reconstruía la base**. Un despliegue nuevo
 * —o una restauración— habría montado un esquema al que le faltaban
 * `movimientos_extracto`, la capa exacta en SQL y catorce funciones más, y el
 * fallo habría aparecido lejos de su causa.
 *
 * Este test es el mismo remedio que `tests/n8nNodos.test.ts` aplica a los nodos
 * de n8n: no comprueba que el SQL sea correcto —para eso está aplicarlo—, sino
 * que **no falte nada**, que es justo lo que se rompió.
 *
 * Al añadir una migración: `cat supabase/migrations/00NN_*.sql >> supabase/apply_all.sql`
 *
 * ⚠️ Y comprobar que sea RE-EJECUTABLE. `apply_all` no es una concatenación
 * automática: lleva arreglos escritos a mano para poder correrlo sobre una base
 * que ya tiene el esquema (`drop policy if exists` antes de cada `create
 * policy`, guardas alrededor de `alter publication`). Una migración nueva que
 * no sea idempotente hay que adaptarla al copiarla.
 */

const DIR = join(process.cwd(), "supabase", "migrations");
const APPLY_ALL = join(process.cwd(), "supabase", "apply_all.sql");

const migraciones = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("apply_all.sql", () => {
  it("hay migraciones que comprobar", () => {
    expect(migraciones.length).toBeGreaterThan(0);
  });

  it("contiene TODAS las migraciones del repo", () => {
    const sql = readFileSync(APPLY_ALL, "utf8");
    const faltan = migraciones.filter((m) => !sql.includes(m));
    expect(
      faltan,
      `Faltan en supabase/apply_all.sql: ${faltan.join(", ")}. ` +
        "Añádelas en orden y comprueba que sean re-ejecutables.",
    ).toEqual([]);
  });

  it("las numera sin saltos ni repetidos: un hueco es una migración perdida", () => {
    const numeros = migraciones.map((m) => Number(m.slice(0, 4)));
    expect(new Set(numeros).size).toBe(numeros.length);
    for (let i = 0; i < numeros.length; i++) {
      expect(numeros[i]).toBe(i + 1);
    }
  });

  it("las incluye EN ORDEN: una función que se usa antes de crearse falla", () => {
    const sql = readFileSync(APPLY_ALL, "utf8");
    const posiciones = migraciones.map((m) => sql.indexOf(m));
    const ordenadas = [...posiciones].sort((a, b) => a - b);
    expect(posiciones).toEqual(ordenadas);
  });
});
