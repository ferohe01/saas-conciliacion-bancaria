import { describe, it, expect } from "vitest";
import {
  CRITERIOS_INICIALES,
  buscarCriterio,
  normalizarCriterios,
  criteriosParaIa,
  faseAprendizaje,
  DECISIONES_PARA_CALIBRAR,
} from "@/lib/criteriosIniciales";

describe("catálogo", () => {
  it("tiene ids únicos y todo lo necesario para prompt y pantalla", () => {
    const ids = CRITERIOS_INICIALES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CRITERIOS_INICIALES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.ayuda.length).toBeGreaterThan(0);
      expect(c.paraIa.length).toBeGreaterThan(0);
    }
  });

  it("son afirmaciones sobre el negocio, no ajustes numéricos", () => {
    // Preguntarle a una PyME "¿cuantos ejemplos few-shot quieres?" es
    // incontestable; "¿tus clientes pagan varias facturas juntas?" no.
    for (const c of CRITERIOS_INICIALES) {
      expect(c.label).not.toMatch(/\d+(\.\d+)?\s*(%|dias|días|soles)/i);
    }
  });

  it("devuelve undefined para un id inventado", () => {
    expect(buscarCriterio("no_existe")).toBeUndefined();
  });
});

describe("normalizarCriterios", () => {
  it("descarta desconocidos y duplicados", () => {
    const r = normalizarCriterios([
      "tolera_comision",
      "tolera_comision",
      "inventado",
    ]);
    expect(r).toEqual(["tolera_comision"]);
  });

  it("aguanta basura sin reventar", () => {
    expect(normalizarCriterios(null)).toEqual([]);
    expect(normalizarCriterios("texto")).toEqual([]);
    expect(normalizarCriterios([1, {}, null])).toEqual([]);
  });
});

describe("criteriosParaIa", () => {
  it("traduce a las frases del prompt", () => {
    const frases = criteriosParaIa(["pagos_agrupados"]);
    expect(frases).toHaveLength(1);
    expect(frases[0]).toContain("un solo depósito");
  });

  it("respeta el orden del catálogo, no el de entrada", () => {
    const a = criteriosParaIa(["pagos_parciales", "tolera_comision"]);
    const b = criteriosParaIa(["tolera_comision", "pagos_parciales"]);
    expect(a).toEqual(b);
  });

  it("un código retirado no arrastra al resto", () => {
    expect(criteriosParaIa(["retirado", "tolera_comision"])).toHaveLength(1);
  });
});

describe("faseAprendizaje", () => {
  it("sin decisiones está en frío", () => {
    const f = faseAprendizaje(0);
    expect(f.fase).toBe("sin_datos");
    expect(f.progreso).toBe(0);
  });

  it("con algunas está entrenando y dice cuántas faltan", () => {
    const f = faseAprendizaje(4);
    expect(f.fase).toBe("entrenamiento");
    expect(f.faltan).toBe(DECISIONES_PARA_CALIBRAR - 4);
    expect(f.progreso).toBe(40);
  });

  it("al llegar al umbral queda calibrada", () => {
    expect(faseAprendizaje(DECISIONES_PARA_CALIBRAR).fase).toBe("calibrada");
    expect(faseAprendizaje(999).progreso).toBe(100);
  });

  it("un negativo no rompe la barra", () => {
    const f = faseAprendizaje(-5);
    expect(f.progreso).toBe(0);
    expect(f.decisiones).toBe(0);
  });
});
