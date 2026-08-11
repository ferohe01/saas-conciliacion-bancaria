import { describe, it, expect } from "vitest";
import { ERPS_PORTADA, SISTEMAS_ERP } from "../src/lib/conexiones";

/**
 * La portada nombra sistemas de facturación para que una empresa reconozca el
 * suyo antes de registrarse.
 *
 * ⚠️ Ese nombre es una promesa que se cobra en la pantalla siguiente: quien lee
 * «Oracle» en la portada, se registra y no lo encuentra en «Conectar sistema»
 * concluye que el producto no es para él — y lo descubre justo después de darte
 * sus datos, que es cuando más caro sale.
 *
 * Este test ata las dos listas. No comprueba el diseño ni el texto: comprueba
 * que la portada no promete nada que la app no tenga.
 */
describe("los ERPs de la portada existen en el catálogo de la app", () => {
  it("hay sistemas nombrados en la portada", () => {
    expect(ERPS_PORTADA.length).toBeGreaterThan(0);
  });

  it("cada nombre corresponde a un sistema del catálogo", () => {
    const catalogo = SISTEMAS_ERP.map((s) => s.nombre.toLowerCase());
    const huerfanos = ERPS_PORTADA.filter(
      (corto) => !catalogo.some((n) => n.includes(corto.toLowerCase())),
    );
    expect(
      huerfanos,
      `La portada nombra ${huerfanos.join(", ")}, que no está en SISTEMAS_ERP. ` +
        "O se añade al catálogo, o se quita de la portada.",
    ).toEqual([]);
  });

  it("⚠️ no promete integración: hoy no hay ninguna construida", () => {
    // `/conexiones` solo recoge QUÉ sistema usa el cliente; no sincroniza nada.
    // Prometerlo en la portada sería vender algo que no existe.
    const fs = require("node:fs") as typeof import("node:fs");
    const portada = fs.readFileSync("src/app/page.tsx", "utf8");

    // ⚠️ Los comentarios se quitan de verdad, no línea a línea. La primera
    // versión filtraba las que empiezan por `*` o `//` y se saltaba los
    // `{/* … */}` de JSX: el propio comentario que explica por qué NO se promete
    // integración hacía fallar el test que lo comprueba.
    const visible = portada
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .toLowerCase();

    for (const prohibido of ["nos conectamos", "sincroniza", "integración con"]) {
      expect(visible, `la portada no debe decir «${prohibido}»`).not.toContain(
        prohibido,
      );
    }
  });
});
