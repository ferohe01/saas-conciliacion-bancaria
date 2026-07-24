import { describe, it, expect } from "vitest";
import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";

describe("normalizarFecha", () => {
  it("acepta ISO", () => {
    expect(normalizarFecha("2026-06-15")).toBe("2026-06-15");
  });
  it("convierte dd/mm/yyyy (convención peruana)", () => {
    expect(normalizarFecha("15/06/2026")).toBe("2026-06-15");
    expect(normalizarFecha("15-06-2026")).toBe("2026-06-15");
  });
  it("interpreta día > 12 como dd/mm", () => {
    expect(normalizarFecha("25/12/2026")).toBe("2026-12-25");
  });
  it("expande años de 2 dígitos", () => {
    expect(normalizarFecha("15/06/26")).toBe("2026-06-15");
  });
  it("convierte objetos Date", () => {
    expect(normalizarFecha(new Date(Date.UTC(2026, 5, 15)))).toBe("2026-06-15");
  });
  it("convierte seriales de Excel", () => {
    // 46188 = 2026-06-15
    expect(normalizarFecha(46188)).toBe("2026-06-15");
  });
  it("rechaza fechas imposibles y basura", () => {
    expect(normalizarFecha("31/02/2026")).toBeNull();
    expect(normalizarFecha("no es fecha")).toBeNull();
    expect(normalizarFecha("")).toBeNull();
  });
});

describe("normalizarMonto", () => {
  it("coma miles + punto decimal (peruano)", () => {
    expect(normalizarMonto("1,234.56")).toBeCloseTo(1234.56);
    expect(normalizarMonto("312,450.00")).toBeCloseTo(312450);
  });
  it("formato europeo (punto miles, coma decimal)", () => {
    expect(normalizarMonto("1.234,56")).toBeCloseTo(1234.56);
  });
  it("quita símbolos de moneda", () => {
    expect(normalizarMonto("S/ 4,950.00")).toBeCloseTo(4950);
    expect(normalizarMonto("US$ 1234.5")).toBeCloseTo(1234.5);
  });
  it("negativos con signo o paréntesis", () => {
    expect(normalizarMonto("-1234.56")).toBeCloseTo(-1234.56);
    expect(normalizarMonto("(1,234.56)")).toBeCloseTo(-1234.56);
  });
  it("coma sola de miles (3 dígitos) → entero", () => {
    expect(normalizarMonto("1,234")).toBeCloseTo(1234);
  });
  it("coma sola decimal (2 dígitos)", () => {
    expect(normalizarMonto("1234,5")).toBeCloseTo(1234.5);
  });
  it("acepta números tal cual", () => {
    expect(normalizarMonto(4950)).toBe(4950);
  });
  it("rechaza basura", () => {
    expect(normalizarMonto("abc")).toBeNull();
    expect(normalizarMonto("")).toBeNull();
  });
});
