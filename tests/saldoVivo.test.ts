import { describe, it, expect } from "vitest";
import {
  saldoVivo,
  consolidarVivo,
  etiquetaVivo,
  DIAS_VIGENCIA,
  type ExtractoVigente,
  type SaldoVivo,
} from "@/lib/saldoVivo";

/**
 * Lo que estos tests fijan no es la aritmética —es trivial— sino las cuatro
 * cosas que el módulo NO puede hacer: inventar un saldo cuando no hay de dónde
 * partir, contar dos veces los días que solapan con lo ya conciliado,
 * presentarse como «hoy» cuando ha caducado, y dar un total al que le falta una
 * cuenta.
 */

const HOY = new Date("2026-08-15T09:00:00Z");

function ext(p: Partial<ExtractoVigente> = {}): ExtractoVigente {
  return {
    cuentaId: "c1",
    loteId: "l1",
    fechaMin: "2026-08-01",
    fechaMax: "2026-08-14",
    filas: 218,
    saldoDeclarado: 152940,
    subidoEn: "2026-08-15T08:00:00Z",
    corteAprobado: "2026-07-31",
    sumaPosterior: 14671.9,
    movsPosteriores: 218,
    ...p,
  };
}

describe("saldoVivo · de dónde sale el número", () => {
  it("gana el saldo que DECLARA el banco, aunque se pudiera calcular", () => {
    const v = saldoVivo(ext(), 138268.1, HOY)!;
    expect(v.fuente).toBe("banco");
    expect(v.saldo).toBe(152940);
  });

  it("sin columna de saldo, se deriva del último aprobado + lo posterior", () => {
    const v = saldoVivo(ext({ saldoDeclarado: null }), 138268.1, HOY)!;
    expect(v.fuente).toBe("calculado");
    expect(v.saldo).toBe(152940); // 138268,10 + 14671,90
  });

  it("⚠️ sin saldo declarado y sin aprobado del que partir, NO se inventa nada", () => {
    // Sumar movimientos sin saber de qué saldo se parte da un flujo, no un
    // saldo. Enseñarlo como «lo que tienes» sería el número plausible y falso.
    expect(saldoVivo(ext({ saldoDeclarado: null }), null, HOY)).toBeNull();
  });

  it("un extracto sin fechas no produce saldo vivo", () => {
    expect(saldoVivo(ext({ fechaMax: null }), 1000, HOY)).toBeNull();
  });

  it("la diferencia con lo probado es lo que queda por conciliar", () => {
    const v = saldoVivo(ext(), 138268.1, HOY)!;
    expect(v.diferencia).toBe(14671.9);
    expect(v.porConciliar).toBe(218);
  });

  it("sin conciliación aprobada no hay diferencia que enseñar", () => {
    const v = saldoVivo(ext({ corteAprobado: null }), null, HOY)!;
    expect(v.diferencia).toBeNull();
  });
});

describe("saldoVivo · la guarda de solape", () => {
  it("marca cuando el extracto empieza antes del último corte aprobado", () => {
    // «Los últimos 30 días» descargados el 14/08 empiezan el 15/07, y julio ya
    // está conciliado. La suma que llega de SQL ya excluye esos días; lo que
    // hace falta aquí es poder decirlo en pantalla.
    const v = saldoVivo(ext({ fechaMin: "2026-07-15" }), 138268.1, HOY)!;
    expect(v.solapa).toBe(true);
  });

  it("un extracto que arranca después del corte no solapa", () => {
    expect(saldoVivo(ext({ fechaMin: "2026-08-01" }), 138268.1, HOY)!.solapa).toBe(false);
  });

  it("sin corte aprobado no puede haber solape", () => {
    const v = saldoVivo(ext({ corteAprobado: null, fechaMin: "2026-01-01" }), 5000, HOY)!;
    expect(v.solapa).toBe(false);
  });
});

describe("saldoVivo · caducidad", () => {
  it("un extracto reciente es vigente", () => {
    const v = saldoVivo(ext({ fechaMax: "2026-08-14" }), 1000, HOY)!;
    expect(v.dias).toBe(1);
    expect(v.vigente).toBe(true);
  });

  it(`el límite está en ${DIAS_VIGENCIA} días, y el siguiente ya no es "hoy"`, () => {
    expect(saldoVivo(ext({ fechaMax: "2026-08-05" }), 1000, HOY)!.vigente).toBe(true); // 10
    expect(saldoVivo(ext({ fechaMax: "2026-08-04" }), 1000, HOY)!.vigente).toBe(false); // 11
  });

  it("⚠️ caducado NO se esconde: sigue siendo cierto sobre su fecha, y lo dice", () => {
    const v = saldoVivo(ext({ fechaMax: "2026-07-20" }), 1000, HOY)!;
    expect(v.vigente).toBe(false);
    expect(etiquetaVivo(v)).toContain("ya no es el saldo de hoy");
    expect(etiquetaVivo(v)).toContain("20/07/2026");
  });

  it("la etiqueta nunca dice solo «hoy»: siempre lleva la fecha", () => {
    const v = saldoVivo(ext(), 1000, HOY)!;
    expect(etiquetaVivo(v)).toContain("14/08/2026");
    expect(etiquetaVivo(v)).toContain("sin conciliar");
  });
});

describe("consolidarVivo", () => {
  const vivo = (cuentaId: string, saldo: number, p: Partial<SaldoVivo> = {}): SaldoVivo => ({
    cuentaId,
    saldo,
    fecha: "2026-08-14",
    fuente: "banco",
    dias: 1,
    vigente: true,
    porConciliar: 10,
    diferencia: 100,
    solapa: false,
    loteId: `l-${cuentaId}`,
    ...p,
  });

  it("suma cuando TODAS las cuentas del bloque tienen extracto", () => {
    const b = consolidarVivo(["a", "b"], [vivo("a", 1000), vivo("b", 500)]);
    expect(b.saldo).toBe(1500);
    expect(b.cubiertas).toBe(2);
  });

  it("⚠️ NO da total si falta una cuenta: parecería que el dinero desapareció", () => {
    const b = consolidarVivo(["a", "b"], [vivo("a", 1000)]);
    expect(b.saldo).toBeNull();
    expect(b.diferencia).toBeNull();
    // …pero el detalle de la que sí lo tiene se enseña igual.
    expect(b.detalle).toHaveLength(1);
    expect(b.cubiertas).toBe(1);
    expect(b.cuentas).toBe(2);
  });

  it("el total hereda la fecha más ANTIGUA de sus partes", () => {
    const b = consolidarVivo(
      ["a", "b"],
      [vivo("a", 1000, { fecha: "2026-08-14" }), vivo("b", 500, { fecha: "2026-08-09" })],
    );
    expect(b.fecha).toBe("2026-08-09");
  });

  it("basta con que uno haya caducado para que el conjunto no sea vigente", () => {
    const b = consolidarVivo(
      ["a", "b"],
      [vivo("a", 1000), vivo("b", 500, { vigente: false, dias: 40 })],
    );
    expect(b.vigente).toBe(false);
  });

  it("ignora saldos vivos de cuentas de otra moneda", () => {
    const b = consolidarVivo(["a"], [vivo("a", 1000), vivo("usd", 300)]);
    expect(b.saldo).toBe(1000);
    expect(b.detalle).toHaveLength(1);
  });

  it("un bloque sin ningún extracto no es vigente ni tiene total", () => {
    const b = consolidarVivo(["a"], []);
    expect(b.saldo).toBeNull();
    expect(b.vigente).toBe(false);
    expect(b.porConciliar).toBe(0);
  });

  it("sin diferencia en alguna cuenta, tampoco hay diferencia agregada", () => {
    const b = consolidarVivo(
      ["a", "b"],
      [vivo("a", 1000), vivo("b", 500, { diferencia: null })],
    );
    expect(b.saldo).toBe(1500);
    expect(b.diferencia).toBeNull();
  });
});
