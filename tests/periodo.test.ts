import { describe, it, expect } from "vitest";
import { periodoDeRango, VALOR_RANGO, rangoDeMes } from "@/lib/periodo";

/**
 * El rango libre existe porque el mes calendario no sabe expresar el período de
 * algunos clientes: una recaudadora concilia por día. Lo que se prueba aquí es
 * sobre todo el NO: un rango que no sirve tiene que devolver `null` y bloquear,
 * no caerse a un valor plausible. Conciliar un período que el usuario no pidió
 * es peor que no conciliar — el resultado parece bueno.
 */
describe("periodoDeRango", () => {
  it("acepta un rango normal", () => {
    const p = periodoDeRango("2026-06-01", "2026-06-15");
    expect(p).not.toBeNull();
    expect(p!.desde).toBe("2026-06-01");
    expect(p!.hasta).toBe("2026-06-15");
    expect(p!.valor).toBe(VALOR_RANGO);
    expect(p!.etiqueta).toBe("01/06/2026 a 15/06/2026");
  });

  it("un solo día se dice como un día", () => {
    // "30/06/2026 a 30/06/2026" se lee como un fallo de la aplicación, y el
    // corte diario es justo el caso que motivó todo esto.
    expect(periodoDeRango("2026-06-30", "2026-06-30")!.etiqueta).toBe("30/06/2026");
  });

  it("rechaza el rango al revés", () => {
    expect(periodoDeRango("2026-06-30", "2026-06-01")).toBeNull();
  });

  it("rechaza fechas incompletas o vacías", () => {
    expect(periodoDeRango("", "2026-06-30")).toBeNull();
    expect(periodoDeRango("2026-06-30", "")).toBeNull();
    expect(periodoDeRango("2026-06", "2026-06-30")).toBeNull();
    expect(periodoDeRango("30/06/2026", "30/06/2026")).toBeNull();
  });

  it("puede cruzar meses y años", () => {
    // Nada obliga a que un período viva dentro de un mes: esa suposición es
    // exactamente la que se está levantando.
    const p = periodoDeRango("2025-12-26", "2026-01-05");
    expect(p!.etiqueta).toBe("26/12/2025 a 05/01/2026");
  });

  it("un mes entero por rango da lo mismo que elegir el mes", () => {
    const mes = rangoDeMes(2026, 6);
    const p = periodoDeRango(mes.desde, mes.hasta)!;
    expect({ desde: p.desde, hasta: p.hasta }).toEqual(mes);
  });
});
