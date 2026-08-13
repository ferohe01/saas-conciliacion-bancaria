import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normRef } from "@/lib/normalizacion/referencia";

/**
 * La referencia canónica es lo que decide si dos partidas son la misma
 * operación, y está escrita CUATRO veces: aquí, en `ref_norm` (SQL, 0029/0042)
 * y en dos nodos de n8n. Los tests fijan la regla; la última prueba comprueba
 * que las copias de n8n no se hayan quedado atrás, que es la forma en que esto
 * se rompe de verdad.
 */

describe("normRef", () => {
  it("mayúsculas y sin separadores (lo de siempre)", () => {
    expect(normRef("SR11-02748951")).toBe("SR1102748951");
    expect(normRef("sr11 027/489.51")).toBe("SR1102748951");
    expect(normRef("")).toBe("");
    expect(normRef(null)).toBe("");
    expect(normRef(undefined)).toBe("");
  });

  it("descarta el prefijo de entidad: el mismo recibo con y sin él", () => {
    // El caso real: el ERP escribe WIN-, el banco no.
    expect(normRef("WIN-S001-11618954")).toBe("S00111618954");
    expect(normRef("S001-11618954")).toBe("S00111618954");
    expect(normRef("WIN-S001-11618954")).toBe(normRef("S001-11618954"));
  });

  it("NO toca una serie cuyo primer segmento lleva dígitos", () => {
    // `SR11` no es un nombre de entidad; son 452.317 filas del cliente grande y
    // moverlas habría cambiado una conciliación que ya funcionaba.
    expect(normRef("SR11-02748951")).toBe("SR1102748951");
    expect(normRef("S001-11618954")).toBe("S00111618954");
  });

  it("NO deja una referencia en un número pelado", () => {
    // Sin esta guarda, `A-123` y `B-123` serían la misma operación.
    expect(normRef("F001-123")).toBe("F001123");
    expect(normRef("A-123456")).toBe("A123456");
    expect(normRef("FACTURA / 000123")).toBe("FACTURA000123");
  });

  it("exige que quede algo suficientemente largo", () => {
    // El resto tiene letras y dígitos pero solo 5 caracteres útiles.
    expect(normRef("WIN-A1B2C")).toBe("WINA1B2C");
    // Con 6 sí se recorta.
    expect(normRef("WIN-A1B2C3")).toBe("A1B2C3");
  });

  it("un prefijo sin nada detrás no rompe nada", () => {
    expect(normRef("ABC-")).toBe("ABC");
    expect(normRef("-")).toBe("");
  });

  it("es idempotente: aplicarla dos veces da lo mismo", () => {
    // Importa porque el residuo viaja a n8n con la referencia CRUDA y allí se
    // vuelve a normalizar. Si no lo fuera, la segunda pasada movería la clave.
    for (const r of [
      "WIN-S001-11618954",
      "S001-11618954",
      "SR11-02748951",
      "F001-123",
      "EFECTIVO00000000233816",
    ]) {
      expect(normRef(normRef(r))).toBe(normRef(r));
    }
  });

  it("no puede romper un par que ya casaba: dos iguales siguen iguales", () => {
    const pares = [
      ["SR11-02748951", "sr11 02748951"],
      ["000030516142", "000030516142"],
      ["WIN-S001-1", "win s001 1"],
    ];
    for (const [a, b] of pares) expect(normRef(a!)).toBe(normRef(b!));
  });
});

describe("las copias del motor no se quedan atrás", () => {
  const nodos = ["01_exacta.js", "03a_agrupacion.js", "ia_llm_01_candidatos.js", "03_ia.js"];

  it.each(nodos)("%s lleva la misma regla de prefijo", (nodo) => {
    const js = readFileSync(join(process.cwd(), "n8n", nodo), "utf8");
    // La regex del prefijo, escrita igual en los cuatro.
    expect(js).toContain("/^[A-Za-z]+[-_/ ]+/");
    expect(js).toContain("limpiarRef(resto).length >= 6");
  });

  it("la migración 0042 usa la misma expresión en las dos tablas", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0042_referencia_prefijo_entidad.sql"),
      "utf8",
    );
    // Dos tablas × (comparación + dos `~` + length + then) = la regex repetida.
    const veces = sql.split("'^[A-Za-z]+[-_/ ]+'").length - 1;
    expect(veces).toBe(10);
    expect(sql).toContain("analyze public.comprobantes;");
  });
});
