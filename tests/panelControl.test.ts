import { describe, it, expect } from "vitest";
import {
  cuadra,
  formatoDinero,
  simboloMoneda,
  ultimoPeriodo,
  variacionAutomatizacion,
} from "@/lib/panelControl";
import type { JobReporte, PuntoMensual } from "@/lib/reportes";

const serie = (valores: Record<number, [number, number]>): PuntoMensual[] =>
  Array.from({ length: 12 }, (_, i) => {
    const [registros, pct] = valores[i + 1] ?? [0, 0];
    return {
      mes: i + 1,
      etiqueta: "",
      conciliaciones: registros > 0 ? 1 : 0,
      registros,
      autoConciliados: 0,
      pctAutomatizacion: pct,
    };
  });

describe("variacionAutomatizacion", () => {
  it("con todo el año compara el último mes con datos contra el anterior", () => {
    const v = variacionAutomatizacion(serie({ 5: [100, 96.9], 6: [100, 99] }), "todos");
    expect(v).toEqual({ puntos: 2.1, mesActual: 6, mesAnterior: 5 });
  });

  it("con un mes elegido compara ese mes", () => {
    const v = variacionAutomatizacion(serie({ 4: [10, 80], 5: [10, 90], 6: [10, 70] }), 5);
    expect(v?.puntos).toBe(10);
  });

  // Comparar contra un mes vacío no es una subida: es que no hay dato.
  it("sin mes anterior con conciliaciones no hay variación", () => {
    expect(variacionAutomatizacion(serie({ 6: [100, 99] }), "todos")).toBeNull();
    expect(variacionAutomatizacion(serie({ 1: [100, 99] }), 1)).toBeNull();
    expect(variacionAutomatizacion(serie({}), "todos")).toBeNull();
  });

  it("una bajada se informa igual que una subida", () => {
    expect(variacionAutomatizacion(serie({ 5: [10, 90], 6: [10, 85.5] }), 6)?.puntos).toBe(-4.5);
  });
});

describe("ultimoPeriodo", () => {
  const job = (id: string, hasta: string, creado = "2026-07-01"): JobReporte =>
    ({ id, periodoHasta: hasta, createdAt: creado }) as JobReporte;

  it("elige el de cierre más reciente y, a igualdad, el último creado", () => {
    expect(ultimoPeriodo([job("a", "2026-05-31"), job("b", "2026-06-30")])?.id).toBe("b");
    expect(
      ultimoPeriodo([job("a", "2026-06-30", "2026-07-01"), job("b", "2026-06-30", "2026-07-02")])?.id,
    ).toBe("b");
    expect(ultimoPeriodo([])).toBeNull();
  });
});

describe("dinero", () => {
  it("usa el símbolo de la cuenta y dos decimales, sin signo", () => {
    expect(simboloMoneda("PEN")).toBe("S/");
    expect(simboloMoneda("USD")).toBe("US$");
    expect(simboloMoneda("EUR")).toBe("EUR");
    expect(formatoDinero(-20, "PEN")).toMatch(/^S\/ 20[.,]00$/);
  });

  it("medio céntimo cuenta como cuadrado", () => {
    expect(cuadra(0.004)).toBe(true);
    expect(cuadra(-0.01)).toBe(false);
  });
});
