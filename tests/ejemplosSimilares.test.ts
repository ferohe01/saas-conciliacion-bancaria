import { describe, it, expect } from "vitest";
import {
  claveEjemplo,
  seleccionarEjemplos,
  textoConsulta,
  textoEjemplo,
  type Vecino,
} from "@/lib/ejemplosSimilares";

const vecino = (clave: string, decision: string, consulta: number, distancia: number): Vecino => ({
  consulta,
  clave,
  decision,
  interno: `int-${clave}`,
  banco: `bco-${clave}`,
  categoria: null,
  motivo: decision === "rechazado" ? "es otra contraparte" : null,
  distancia,
});

describe("textos que se convierten en vector", () => {
  it("el ejemplo no lleva la decisión: no debe pesar en el parecido", () => {
    const t = textoEjemplo({ decision: "rechazado", interno: "100.00 · ACME · 2026-06-01", banco: "98.00 · ACME · 2026-06-02" });
    expect(t).not.toContain("rechazado");
    expect(t).toContain("ACME");
  });

  it("la consulta usa el mismo formato que el ejemplo", () => {
    const t = textoConsulta({
      id_interno: "R1", fecha: "2026-06-17", monto: 53.79, nombre: "", referencia: "SR11-1",
      candidatos: [{ id_movimiento: "B1", glosa: "EFECTIVO1", fecha: "2026-06-17", monto: 33.79, dif: 20, dias: 0, palabras_comunes: [], comparte_ref: true, score: 0.6, categoria_probable: "pago_parcial" }],
    });
    expect(t).toBe("registro {53.79 ·  · 2026-06-17} ↔ banco {33.79 · EFECTIVO1 · 2026-06-17}");
  });

  it("la clave identifica la decisión, para no recalcular su vector", () => {
    const e = { decision: "aceptado" as const, interno: "a", banco: "b" };
    expect(claveEjemplo(e)).toBe("aceptado|a|b");
  });
});

describe("seleccionarEjemplos", () => {
  it("gana el ejemplo vecino de más casos, y a igualdad el más cercano", () => {
    const r = seleccionarEjemplos([
      vecino("x", "aceptado", 1, 0.3),
      vecino("y", "aceptado", 1, 0.1),
      vecino("x", "aceptado", 2, 0.4),
    ]);
    expect(r.map((e) => e.interno)).toEqual(["int-x", "int-y"]);
  });

  it("conserva el equilibrio por clase y el tope total", () => {
    const vs: Vecino[] = [];
    for (let i = 0; i < 20; i++) vs.push(vecino(`a${i}`, "aceptado", i, 0.1));
    for (let i = 0; i < 3; i++) vs.push(vecino(`r${i}`, "rechazado", i, 0.2));
    const r = seleccionarEjemplos(vs);
    expect(r.filter((e) => e.decision === "aceptado")).toHaveLength(6);
    expect(r.filter((e) => e.decision === "rechazado")).toHaveLength(3);
    expect(r.length).toBeLessThanOrEqual(12);
  });

  it("intercala las clases y conserva el motivo del rechazo", () => {
    const r = seleccionarEjemplos([vecino("a", "aceptado", 1, 0.1), vecino("b", "rechazado", 1, 0.1)]);
    expect(r.map((e) => e.decision)).toEqual(["aceptado", "rechazado"]);
    expect(r[1]!.motivo).toBe("es otra contraparte");
  });

  it("sin vecinos no hay ejemplos (el motor usa entonces los recientes)", () => {
    expect(seleccionarEjemplos([])).toEqual([]);
  });
});
