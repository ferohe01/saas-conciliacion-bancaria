import { describe, it, expect } from "vitest";
import { calcularCuadre } from "@/lib/conciliacion/cuadre";

/**
 * El cuadre de la aplicación tiene que dar EXACTAMENTE lo mismo que
 * `n8n/04_ensamblar.js`. Son dos implementaciones del mismo cálculo en dos
 * lenguajes, y conviven porque en el modo tabla puede no llegar a ejecutarse
 * n8n: si la capa exacta en SQL casa todo, el backend cierra el job solo.
 *
 * Los casos son los mismos que los de `tests/n8nNodos.test.ts` a propósito: si
 * alguna vez divergen, el mismo período daría dos diferencias distintas según
 * qué camino tomó, y no habría forma de saber cuál es la buena.
 */
describe("calcularCuadre (aplicación)", () => {
  it("cuadra cuando no hay nada suelto", () => {
    expect(
      calcularCuadre({ saldo_extracto_final: 1000, saldo_libros_final: 1000 }, [], []).diferencia,
    ).toBe(0);
  });

  it("cierra con un depósito en tránsito", () => {
    const c = calcularCuadre(
      { saldo_extracto_final: 900, saldo_libros_final: 1000 },
      [{ monto: 100 }],
      [],
    );
    expect(c.depositos_en_transito).toBe(100);
    expect(c.diferencia).toBe(0);
  });

  it("cierra con un cheque girado y no cobrado", () => {
    const c = calcularCuadre(
      { saldo_extracto_final: 1100, saldo_libros_final: 1000 },
      [{ monto: -100 }],
      [],
    );
    expect(c.cheques_no_cobrados).toBe(-100);
    expect(c.diferencia).toBe(0);
  });

  it("cierra con una comisión que el banco cobró y los libros no tienen", () => {
    const c = calcularCuadre(
      { saldo_extracto_final: 950, saldo_libros_final: 1000 },
      [],
      [{ monto: -50 }],
    );
    expect(c.cargos_no_registrados).toBe(-50);
    expect(c.diferencia).toBe(0);
  });

  it("cierra con un abono que el banco registró y los libros no", () => {
    const c = calcularCuadre(
      { saldo_extracto_final: 1050, saldo_libros_final: 1000 },
      [],
      [{ monto: 50 }],
    );
    expect(c.abonos_no_registrados).toBe(50);
    expect(c.diferencia).toBe(0);
  });

  it("cierra con las cuatro partidas a la vez", () => {
    const c = calcularCuadre(
      { saldo_extracto_final: 940, saldo_libros_final: 1000 },
      [{ monto: 100 }, { monto: -30 }],
      [{ monto: 20 }, { monto: -10 }],
    );
    expect(c.saldo_banco_ajustado).toBe(1000);
    expect(c.diferencia).toBe(0);
  });

  it("los pares conciliados NO entran, sean 400.000 o ninguno", () => {
    // Es lo que hace viable calcular el cuadre de medio millón de partidas sin
    // mirarlas: por definición están en los dos lados y se cancelan.
    const c = calcularCuadre(
      { saldo_extracto_final: 660, saldo_libros_final: 0 },
      [{ monto: 414_616.52 }],
      [{ monto: 2_067.49 }],
    );
    expect(c.diferencia).toBe(413_209.03);
  });

  it("sin saldos, la diferencia es el hueco puro de partidas", () => {
    const c = calcularCuadre({}, [{ monto: 414_616.52 }], [{ monto: 2_067.49 }]);
    expect(c.diferencia).toBe(412_549.03);
  });
});
