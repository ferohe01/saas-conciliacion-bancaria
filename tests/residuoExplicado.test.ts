import { describe, it, expect } from "vitest";
import {
  leerResiduo,
  lineasDeLado,
  seriesDesiguales,
  hayResiduo,
} from "@/lib/residuoExplicado";

/**
 * Los datos son los de la corrida real de junio: 4.384 partidas internas y
 * 2.929 movimientos sin conciliar, y una serie —S001— de la que el banco trae
 * 559 códigos y los libros 276.
 */
const CRUDO = {
  moneda: "PEN",
  internos: [
    { motivo: "sin_rastro", partidas: 4382, importe: 434843.66 },
    { motivo: "codigo_en_el_otro_lado", partidas: 2, importe: 300 },
  ],
  movimientos: [
    { motivo: "sin_rastro", partidas: 2929, importe: 292861.43 },
  ],
  series: [
    { serie: "SR11", banco: 450440, libros: 452178, banco_sin_conciliar: 2645, libros_sin_conciliar: 4382 },
    { serie: "S001", banco: 559, libros: 276, banco_sin_conciliar: 284, libros_sin_conciliar: 1 },
  ],
};

describe("leerResiduo", () => {
  it("lee lo que devuelve Postgres", () => {
    const r = leerResiduo(CRUDO)!;
    expect(r.moneda).toBe("PEN");
    expect(r.internos).toHaveLength(2);
    expect(r.series).toHaveLength(2);
  });

  it("descarta los motivos sin partidas y los desconocidos", () => {
    const r = leerResiduo({
      moneda: "PEN",
      internos: [
        { motivo: "sin_rastro", partidas: 0, importe: 0 },
        { motivo: "vete a saber", partidas: 5, importe: 1 },
      ],
      movimientos: [],
      series: [],
    })!;
    expect(r.internos).toEqual([]);
  });

  it("null cuando no hay diagnóstico (modo payload)", () => {
    expect(leerResiduo(null)).toBeNull();
    expect(hayResiduo(null)).toBe(false);
  });
});

describe("lineasDeLado", () => {
  const r = leerResiduo(CRUDO);

  it("afirma el HECHO comprobable, no la conclusión", () => {
    // ⚠️ El sistema puede comprobar que el código no está en el extracto. Que
    // «se cobró por otro canal» es una lectura probable, no un dato: va aparte.
    const l = lineasDeLado(r, "interno")[0]!;
    expect(l.hecho).toContain("no aparece en ningún movimiento del extracto");
    expect(l.hecho).not.toContain("otro canal");
    expect(l.lectura).toContain("otra vía");
  });

  it("cada lado se explica en su propio idioma", () => {
    expect(lineasDeLado(r, "interno")[0]!.hecho).toContain("extracto");
    expect(lineasDeLado(r, "banco")[0]!.hecho).toContain("comprobantes");
  });

  it("las que SÍ tienen su código en el otro lado se destacan como revisables", () => {
    const l = lineasDeLado(r, "interno").find(
      (x) => x.clave === "codigo_en_el_otro_lado",
    )!;
    expect(l.partidas).toBe(2);
    expect(l.lectura).toContain("merecen una mirada");
  });

  it("ordena por gravedad, no por tamaño", () => {
    // «sin rastro» primero: es el grueso y el que no tiene arreglo técnico.
    expect(lineasDeLado(r, "interno").map((l) => l.clave)).toEqual([
      "sin_rastro",
      "codigo_en_el_otro_lado",
    ]);
  });

  it("sin datos no inventa líneas", () => {
    expect(lineasDeLado(null, "interno")).toEqual([]);
  });
});

describe("seriesDesiguales", () => {
  it("saca la serie a la que le faltan documentos", () => {
    const s = seriesDesiguales(leerResiduo(CRUDO));
    expect(s).toHaveLength(1);
    expect(s[0]!.serie).toBe("S001");
    expect(s[0]!.faltanEn).toBe("libros");
    expect(s[0]!.faltan).toBe(283);
  });

  it("no señala una serie que está compensada", () => {
    // SR11: 450.440 contra 452.178 es un 0,4 % de diferencia. Enseñarla sería
    // ruido, y el ruido enseña a ignorar el recuadro.
    const s = seriesDesiguales(leerResiduo(CRUDO));
    expect(s.map((x) => x.serie)).not.toContain("SR11");
  });

  it("tampoco señala diferencias pequeñas en términos absolutos", () => {
    const r = leerResiduo({
      ...CRUDO,
      series: [{ serie: "F001", banco: 100, libros: 90, banco_sin_conciliar: 10, libros_sin_conciliar: 0 }],
    });
    expect(seriesDesiguales(r)).toEqual([]);
  });

  it("funciona en el sentido contrario", () => {
    const r = leerResiduo({
      ...CRUDO,
      series: [{ serie: "B001", banco: 100, libros: 900, banco_sin_conciliar: 0, libros_sin_conciliar: 800 }],
    });
    expect(seriesDesiguales(r)[0]!.faltanEn).toBe("banco");
  });
});
