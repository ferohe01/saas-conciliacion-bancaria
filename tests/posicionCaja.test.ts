import { describe, it, expect } from "vitest";
import {
  frescuraDelCorte,
  consolidarCaja,
  hayPosicion,
  etiquetaMovimientos,
  type CuentaCaja,
} from "@/lib/posicionCaja";

/**
 * Los invariantes del módulo de caja, que son casi todos sobre lo que NO se
 * puede afirmar: no sumar monedas distintas, no tratar un saldo desconocido
 * como cero, y no enseñar un total con una fecha más fresca que la de su parte
 * más vieja.
 */

const HOY = new Date("2026-08-15T10:00:00Z");

function cuenta(p: Partial<CuentaCaja> = {}): CuentaCaja {
  return {
    cuentaId: "c1",
    banco: "BCP",
    numero: "····2456",
    moneda: "PEN",
    jobId: "job-1",
    corteDesde: "2026-07-01",
    corteHasta: "2026-07-31",
    saldoFinal: 1000,
    entradas: 5000,
    salidas: 4000,
    movimientos: 120,
    cortes: 1,
    movDesde: "2026-07-01",
    movHasta: "2026-07-31",
    tieneFormato: true,
    ...p,
  };
}

describe("frescuraDelCorte", () => {
  it("un cierre mensual recién conciliado está al día", () => {
    const f = frescuraDelCorte("2026-07-31", HOY);
    expect(f.dias).toBe(15);
    expect(f.estado).toBe("al_dia");
    expect(f.texto).toContain("31/07/2026");
  });

  it("a los 46 días falta un período: con retraso", () => {
    const f = frescuraDelCorte("2026-06-30", HOY);
    expect(f.dias).toBe(46);
    expect(f.estado).toBe("retraso");
    // Los días transcurridos van en el texto: "hace tiempo" no se puede ponderar.
    expect(f.texto).toContain("46");
  });

  it("por encima de 70 días la cifra ya no describe hoy", () => {
    expect(frescuraDelCorte("2026-05-31", HOY).estado).toBe("desfasado");
  });

  it("⚠️ sin corte no dice 'al día': dice que no hay nada aprobado", () => {
    const f = frescuraDelCorte(null, HOY);
    expect(f.estado).toBe("sin_datos");
    expect(f.dias).toBeNull();
    expect(f.texto).toMatch(/Sin ninguna conciliación aprobada/);
  });

  it("una fecha ilegible no se convierte en NaN días en pantalla", () => {
    expect(frescuraDelCorte("no-es-fecha", HOY).estado).toBe("sin_datos");
  });

  it("un corte en el futuro no da días negativos", () => {
    expect(frescuraDelCorte("2026-09-30", HOY).dias).toBe(0);
  });

  // El límite exacto importa: es lo que separa "confía" de "revisa".
  it("40 días es al día y 41 ya es retraso", () => {
    expect(frescuraDelCorte("2026-07-06", HOY).estado).toBe("al_dia"); // 40
    expect(frescuraDelCorte("2026-07-05", HOY).estado).toBe("retraso"); // 41
  });
});

describe("consolidarCaja", () => {
  it("⚠️ NUNCA suma monedas distintas: un bloque por cada una", () => {
    const bloques = consolidarCaja(
      [
        cuenta({ cuentaId: "a", moneda: "PEN", saldoFinal: 1000 }),
        cuenta({ cuentaId: "b", moneda: "USD", saldoFinal: 300 }),
      ],
      new Map(),
      HOY,
    );
    expect(bloques.map((b) => b.moneda)).toEqual(["PEN", "USD"]);
    expect(bloques[0]!.saldo).toBe(1000);
    expect(bloques[1]!.saldo).toBe(300);
  });

  it("el vencido se resta solo dentro de su moneda", () => {
    const bloques = consolidarCaja(
      [
        cuenta({ cuentaId: "a", moneda: "PEN", saldoFinal: 1000 }),
        cuenta({ cuentaId: "b", moneda: "USD", saldoFinal: 300 }),
      ],
      new Map([
        ["PEN", 250],
        ["USD", 100],
      ]),
      HOY,
    );
    const pen = bloques.find((b) => b.moneda === "PEN")!;
    const usd = bloques.find((b) => b.moneda === "USD")!;
    expect(pen.disponible).toBe(750);
    expect(usd.disponible).toBe(200);
  });

  it("⚠️ un saldo NULO no cuenta como cero: no suma y se nombra aparte", () => {
    const [b] = consolidarCaja(
      [
        cuenta({ cuentaId: "a", saldoFinal: 1000 }),
        cuenta({ cuentaId: "b", saldoFinal: null }),
      ],
      new Map(),
      HOY,
    );
    expect(b!.saldo).toBe(1000);
    expect(b!.sinSaldo.map((c) => c.cuentaId)).toEqual(["b"]);
    expect(b!.cuentas).toHaveLength(2); // sigue apareciendo en la lista
  });

  it("una cuenta sin conciliar aparece, con todo en null, y no suma", () => {
    const [b] = consolidarCaja(
      [
        cuenta({ cuentaId: "a", saldoFinal: 1000 }),
        cuenta({
          cuentaId: "b",
          jobId: null,
          corteDesde: null,
          corteHasta: null,
          saldoFinal: null,
          entradas: 0,
          salidas: 0,
          movimientos: 0,
          cortes: 0,
          movDesde: null,
          movHasta: null,
        }),
      ],
      new Map(),
      HOY,
    );
    expect(b!.saldo).toBe(1000);
    expect(b!.sinConciliar.map((c) => c.cuentaId)).toEqual(["b"]);
    // No está en `sinSaldo`: son dos situaciones distintas y se explican distinto.
    expect(b!.sinSaldo).toEqual([]);
  });

  it("⚠️ el total hereda el corte MÁS ANTIGUO de las cuentas que lo componen", () => {
    const [b] = consolidarCaja(
      [
        cuenta({ cuentaId: "a", corteHasta: "2026-07-31" }),
        cuenta({ cuentaId: "b", corteHasta: "2026-06-30" }),
      ],
      new Map(),
      HOY,
    );
    expect(b!.corteMasAntiguo).toBe("2026-06-30");
    // …y por tanto la frescura del bloque es la PEOR de sus cuentas.
    expect(b!.frescura.estado).toBe("retraso");
  });

  it("una cuenta sin saldo declarado no arrastra su fecha al total", () => {
    const [b] = consolidarCaja(
      [
        cuenta({ cuentaId: "a", corteHasta: "2026-07-31", saldoFinal: 1000 }),
        cuenta({ cuentaId: "b", corteHasta: "2026-04-30", saldoFinal: null }),
      ],
      new Map(),
      HOY,
    );
    // El corte que manda es el de lo que SÍ está dentro del total.
    expect(b!.corteMasAntiguo).toBe("2026-07-31");
  });

  it("entradas y salidas suman todos los cortes, y el rango los describe", () => {
    const [b] = consolidarCaja(
      [
        cuenta({
          cuentaId: "a",
          entradas: 605307.15,
          salidas: 544663,
          cortes: 3,
          movDesde: "2026-07-01",
          movHasta: "2026-07-30",
        }),
      ],
      new Map(),
      HOY,
    );
    expect(b!.entradas).toBe(605307.15);
    expect(b!.salidas).toBe(544663);
    expect(etiquetaMovimientos(b!)).toBe("01/07/2026 al 30/07/2026 · 3 cortes");
  });

  it("con un solo corte no se anuncia un número de cortes", () => {
    const [b] = consolidarCaja([cuenta()], new Map(), HOY);
    expect(etiquetaMovimientos(b!)).toBe("01/07/2026 al 31/07/2026");
  });

  it("sin movimientos conciliados lo dice, en vez de pintar un rango vacío", () => {
    const [b] = consolidarCaja(
      [cuenta({ movDesde: null, movHasta: null, cortes: 0 })],
      new Map(),
      HOY,
    );
    expect(etiquetaMovimientos(b!)).toBe("sin movimientos conciliados");
  });

  it("los bloques salen ordenados por saldo: se mira primero el grande", () => {
    const bloques = consolidarCaja(
      [
        cuenta({ cuentaId: "a", moneda: "USD", saldoFinal: 50 }),
        cuenta({ cuentaId: "b", moneda: "PEN", saldoFinal: 9000 }),
      ],
      new Map(),
      HOY,
    );
    expect(bloques.map((b) => b.moneda)).toEqual(["PEN", "USD"]);
  });

  it("una cuenta sin moneda declarada se cuenta como soles", () => {
    const [b] = consolidarCaja([cuenta({ moneda: "" })], new Map(), HOY);
    expect(b!.moneda).toBe("PEN");
  });

  it("el disponible puede salir negativo, y no se recorta a cero", () => {
    // Deber más de lo que hay en el banco es un hecho, no un error de cálculo:
    // taparlo con un cero sería justo lo que esta pantalla no puede hacer.
    const [b] = consolidarCaja(
      [cuenta({ saldoFinal: 1000 })],
      new Map([["PEN", 2500]]),
      HOY,
    );
    expect(b!.disponible).toBe(-1500);
  });

  it("los céntimos no se van en decimales binarios", () => {
    const [b] = consolidarCaja(
      [
        cuenta({ cuentaId: "a", saldoFinal: 0.1 }),
        cuenta({ cuentaId: "b", saldoFinal: 0.2 }),
      ],
      new Map(),
      HOY,
    );
    expect(b!.saldo).toBe(0.3);
  });
});

describe("hayPosicion", () => {
  it("es falso cuando ninguna cuenta tiene conciliación aprobada", () => {
    const bloques = consolidarCaja(
      [cuenta({ jobId: null, saldoFinal: null, corteHasta: null })],
      new Map(),
      HOY,
    );
    // ⚠️ Aquí la pantalla enseña un estado vacío con su explicación. Pintar
    // ceros diría "no tienes plata", que es una afirmación que nadie hizo.
    expect(hayPosicion(bloques)).toBe(false);
  });

  it("es verdadero en cuanto una cuenta tiene una aprobada", () => {
    expect(hayPosicion(consolidarCaja([cuenta()], new Map(), HOY))).toBe(true);
  });

  it("sin cuentas bancarias tampoco hay posición", () => {
    expect(hayPosicion(consolidarCaja([], new Map(), HOY))).toBe(false);
  });
});
