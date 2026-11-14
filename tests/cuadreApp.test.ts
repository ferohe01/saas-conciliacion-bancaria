import { describe, it, expect } from "vitest";
import { calcularCuadre } from "@/lib/conciliacion/cuadre";

/**
 * `calcularCuadre` es la única implementación del cuadre: la usan el motor al
 * ensamblar y el backend cuando cierra un job sin residuo. Antes había una
 * segunda copia en n8n y estos casos vigilaban que no divergieran; se
 * conservan porque el cuadre es el veredicto que el cliente enseña a su
 * contador, y `tests/motor.test.ts` los repite a través del ensamblado.
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

  it("una diferencia DENTRO de un par emparejado también cuenta", () => {
    // Un comprobante de 100 casado con un depósito de 80: los libros dicen 100,
    // el banco 80, y ninguna de las dos partidas está pendiente. Sin contarlo,
    // esos 20 desaparecen del cuadre y el total deja de cuadrar contra la resta
    // de los dos lados — que es exactamente lo que pasó con junio completo.
    const c = calcularCuadre({ saldo_extracto_final: 80, saldo_libros_final: 100 }, [], [], 20);
    expect(c.diferencias_emparejadas).toBe(20);
    expect(c.diferencia).toBe(0);
  });

  it("con la capa exacta es cero y no cambia nada", () => {
    // Casa por importe idéntico, así que su diferencia es 0 por construcción.
    // Por eso el fallo tardó en verse: hicieron falta 452.177 partidas y UN par
    // de la IA para destaparlo.
    const sin = calcularCuadre({ saldo_extracto_final: 900, saldo_libros_final: 1000 }, [{ monto: 100 }], []);
    const con = calcularCuadre({ saldo_extracto_final: 900, saldo_libros_final: 1000 }, [{ monto: 100 }], [], 0);
    expect(sin).toEqual(con);
    expect(con.diferencia).toBe(0);
  });
});
