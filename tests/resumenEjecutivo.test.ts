import { describe, it, expect } from "vitest";
import { porcentajeAutomatizado, posicionNeta } from "@/lib/resumenEjecutivo";

/**
 * El resumen ejecutivo lo lee quien decide, y por eso sus cifras tienen que
 * poder distinguir "cero" de "no lo sé". Un 0% que en realidad significa "no
 * hubo nada que conciliar" empuja a una conversación equivocada.
 */
describe("porcentajeAutomatizado", () => {
  it("mide lo que el sistema emparejó solo", () => {
    expect(
      porcentajeAutomatizado({
        conciliaciones: 1, sinAprobar: 0, partidas: 903176,
        partidasConciliadas: 895590, cobrado: 0, pagado: 0, diferenciaCuadre: 0,
      }),
    ).toBe(99);
  });

  it("sin partidas devuelve null, NO cero", () => {
    // 0% diría "no automatizó nada"; null dice "no había nada que automatizar".
    // Son dos conversaciones distintas con el dueño de la empresa.
    expect(
      porcentajeAutomatizado({
        conciliaciones: 0, sinAprobar: 0, partidas: 0,
        partidasConciliadas: 0, cobrado: 0, pagado: 0, diferenciaCuadre: 0,
      }),
    ).toBeNull();
  });
});

describe("posicionNeta", () => {
  const hoy = (porCobrar: number, porPagar: number) => ({
    porCobrar, porPagar,
    porCobrarVencido: 0, porCobrarDocs: 0, porPagarVencido: 0, porPagarDocs: 0,
  });

  it("es la resta, y puede salir en contra", () => {
    expect(posicionNeta(hoy(451197.42, 0))).toBe(451197.42);
    expect(posicionNeta(hoy(1000, 2500))).toBe(-1500);
  });

  it("no dice nada del calendario, y por eso nunca va sola", () => {
    // Cobrar a 90 días y pagar a 30 da neto positivo y aun así te deja sin
    // caja. La pantalla lo advierte junto a la cifra; el test fija que la
    // función NO pretende responder esa pregunta.
    expect(posicionNeta(hoy(100, 100))).toBe(0);
  });
});
