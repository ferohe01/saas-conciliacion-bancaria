import { describe, it, expect } from "vitest";
import { BYTES_RESUMEN_INMEDIATO } from "@/lib/parsing/procesar";

/**
 * El umbral de previsualización decide SOLO cuánto alcanza a enseñar el
 * navegador antes de subir. No decide cómo se procesa el archivo: los dos
 * tamaños suben al servidor y concilian por el mismo camino.
 *
 * Esa distinción es el punto entero del diseño. Si el tamaño decidiera también
 * el procesamiento, habría dos motores que mantener y una clase de fallos que
 * solo aparece con archivos grandes — es decir, solo en casa del cliente que
 * más duele.
 */
describe("umbral de resumen inmediato", () => {
  it("cubre de sobra el caso para el que está pensado el producto", () => {
    // 500–2.000 movimientos rondan las decenas de KB: una PyME nunca ve el
    // camino sin resumen.
    expect(BYTES_RESUMEN_INMEDIATO).toBeGreaterThanOrEqual(4 * 1024 * 1024);
  });

  it("deja fuera el extracto de una recaudadora", () => {
    // 450.999 movimientos son ~26 MB. Abrirlo entero en el navegador agota su
    // memoria, así que TIENE que caer del lado de la cabecera.
    expect(26 * 1024 * 1024).toBeGreaterThan(BYTES_RESUMEN_INMEDIATO);
  });
});
