import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Escrituras a Supabase cuyo error se descarta.
 *
 * ── El fallo que motivó este escáner ───────────────────────────────────────
 *
 * `supabase-js` **devuelve** el error en `{ error }`; no lo lanza. Así que un
 * `await supabase.from(...).insert(...)` sin desestructurar no falla, no entra
 * en ningún `try/catch` y no deja rastro: sigue como si hubiera escrito.
 *
 * Pasó de verdad, en el peor sitio posible. Al aprobar el corte de 36.377
 * partidas, el INSERT de las 32.170 aplicaciones de cobro se pasó del
 * `statement_timeout=8s` de Postgres y volvió con un 500. Nadie lo miró, y la
 * pantalla anunció "ya descuenta el saldo de tus comprobantes" con cero filas
 * escritas: una conciliación **aprobada** que decía haber cobrado y no cobró.
 *
 * Un fallo silencioso en una lectura devuelve datos de menos. En una escritura
 * miente sobre lo que pasó con el dinero, y solo se descubre semanas después
 * cuando alguien mira Por cobrar.
 */

const SRC = join(__dirname, "..", "src");

/** `await …insert(/upsert(/update(/delete(` como sentencia suelta. */
const ESCRITURA_SUELTA = /^\s*await\s+[^;]*\.(insert|upsert|update|delete)\s*\(/;

function fuentes(dir: string): { archivo: string; texto: string }[] {
  const salida: { archivo: string; texto: string }[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = join(dir, entrada);
    if (statSync(completo).isDirectory()) salida.push(...fuentes(completo));
    else if (/\.tsx?$/.test(entrada)) {
      salida.push({
        archivo: completo.slice(SRC.length + 1).replace(/\\/g, "/"),
        texto: readFileSync(completo, "utf8"),
      });
    }
  }
  return salida;
}

describe("escrituras a Supabase", () => {
  it("ninguna descarta su error", () => {
    const infractoras: string[] = [];
    for (const { archivo, texto } of fuentes(SRC)) {
      texto.split("\n").forEach((linea, i) => {
        if (ESCRITURA_SUELTA.test(linea)) {
          infractoras.push(`${archivo}:${i + 1} → ${linea.trim()}`);
        }
      });
    }
    expect(
      infractoras,
      `Estas escrituras no comprueban su error. supabase-js lo DEVUELVE, no lo lanza, así que fallarían en silencio y el código seguiría como si hubiera escrito. Usa \`const { error } = await …\` y decide qué hacer:\n${infractoras.join("\n")}`,
    ).toEqual([]);
  });

  it("el escáner detecta el patrón que busca", () => {
    // Una red que no atrapa nada no es una red. Se comprueba con las dos
    // formas: la mala se detecta, la buena no.
    expect(ESCRITURA_SUELTA.test('      await admin.from("t").insert(filas);')).toBe(true);
    expect(ESCRITURA_SUELTA.test('  await supabase.from("t").delete().eq("id", x);')).toBe(true);
    expect(ESCRITURA_SUELTA.test('  const { error } = await admin.from("t").insert(filas);')).toBe(false);
  });
});
