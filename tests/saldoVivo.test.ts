import { describe, it, expect } from "vitest";
import {
  saldoVivo,
  esSaldoVivo,
  frasePorLaQueNoHay,
  rotulos,
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

/** Atajo para los casos en que SÍ tiene que haber saldo vivo. */
function vivo_(e: ExtractoVigente, aprobado: number | null): SaldoVivo {
  const r = saldoVivo(e, aprobado, HOY);
  if (!esSaldoVivo(r)) throw new Error(`esperaba saldo vivo, salió: ${r.motivo}`);
  return r;
}

/** Y para los que NO. */
function sin_(e: ExtractoVigente, aprobado: number | null) {
  const r = saldoVivo(e, aprobado, HOY);
  if (esSaldoVivo(r)) throw new Error("esperaba que NO hubiera saldo vivo");
  return r;
}

describe("saldoVivo · de dónde sale el número", () => {
  it("gana el saldo que DECLARA el banco, aunque se pudiera calcular", () => {
    const v = vivo_(ext(), 138268.1);
    expect(v.fuente).toBe("banco");
    expect(v.saldo).toBe(152940);
  });

  it("sin columna de saldo, se deriva del último aprobado + lo posterior", () => {
    const v = vivo_(ext({ saldoDeclarado: null }), 138268.1);
    expect(v.fuente).toBe("calculado");
    expect(v.saldo).toBe(152940); // 138268,10 + 14671,90
  });

  it("⚠️ sin saldo declarado y sin aprobado del que partir, NO se inventa nada", () => {
    // Sumar movimientos sin saber de qué saldo se parte da un flujo, no un
    // saldo. Enseñarlo como «lo que tienes» sería el número plausible y falso.
    const r = sin_(ext({ saldoDeclarado: null, corteAprobado: null }), null);
    expect(r.motivo).toBe("sin_base");
    expect(frasePorLaQueNoHay(r)).toContain("Concilia un período");
  });

  it("un extracto sin fechas no produce saldo vivo", () => {
    expect(sin_(ext({ fechaMax: null }), 1000).motivo).toBe("sin_fechas");
  });

  it("la diferencia con lo probado es lo que queda por conciliar", () => {
    const v = vivo_(ext(), 138268.1);
    expect(v.diferencia).toBe(14671.9);
    expect(v.porConciliar).toBe(218);
  });

  it("sin conciliación aprobada no hay diferencia que enseñar", () => {
    const v = vivo_(ext({ corteAprobado: null }), null);
    expect(v.diferencia).toBeNull();
  });
});

describe("saldoVivo · un extracto que no pasa del corte no dice nada de hoy", () => {
  /**
   * ⚠️⚠️ El caso que se vio en pantalla, y el peor que puede dar el módulo.
   *
   * Se resubió el extracto de julio sobre julio ya conciliado: cero movimientos
   * posteriores, así que el saldo "vivo" salía del aprobado tal cual y la
   * pantalla enseñaba «Saldo declarado 1.271.478,87 · Diferencia 0,00». Se lee
   * como *«el banco confirma tu conciliación»* cuando la cifra se había copiado
   * de la propia conciliación: una comprobación circular disfrazada de
   * corroboración independiente.
   */
  const julioOtraVez = ext({
    fechaMin: "2026-07-01",
    fechaMax: "2026-07-31",
    corteAprobado: "2026-07-31",
    saldoDeclarado: null,
    sumaPosterior: 0,
    movsPosteriores: 0,
  });

  it("no produce saldo vivo aunque la aritmética cuadre", () => {
    expect(sin_(julioOtraVez, 1271478.87).motivo).toBe("no_supera_el_corte");
  });

  it("y lo explica diciendo qué subir", () => {
    const f = frasePorLaQueNoHay(sin_(julioOtraVez, 1271478.87));
    expect(f).toContain("31/07/2026");
    expect(f).toContain("período siguiente");
  });

  it("tampoco con columna de saldo: sería verificar un corte pasado, otra pregunta", () => {
    expect(
      sin_({ ...julioOtraVez, saldoDeclarado: 1271478.87 }, 1271478.87).motivo,
    ).toBe("no_supera_el_corte");
  });

  it("un solo día más allá del corte ya sí cuenta", () => {
    const v = vivo_({ ...julioOtraVez, fechaMax: "2026-08-01", sumaPosterior: 500, movsPosteriores: 3 }, 1000);
    expect(v.saldo).toBe(1500);
  });

  it("sin ninguna conciliación aprobada, cualquier fecha vale", () => {
    // No hay corte contra el que compararse: el extracto es todo lo que hay.
    const v = vivo_({ ...julioOtraVez, corteAprobado: null, saldoDeclarado: 900 }, null);
    expect(v.saldo).toBe(900);
  });
});

describe("rotulos", () => {
  const v = (fuente: "banco" | "calculado"): SaldoVivo => ({
    cuentaId: "a",
    saldo: 1,
    fecha: "2026-08-14",
    fuente,
    dias: 1,
    vigente: true,
    porConciliar: 0,
    diferencia: null,
    solapa: false,
    loteId: "l",
  });

  it("dice «según el banco» solo cuando TODO sale del banco", () => {
    expect(rotulos([v("banco")]).titulo).toContain("Según el banco");
    expect(rotulos([v("banco")]).cifra).toContain("declarado por el banco");
  });

  it("⚠️ si algo es calculado, el titular NO puede atribuírselo al banco", () => {
    // El titular decía «Según el banco · Saldo declarado» mientras el detalle
    // decía «calculado sobre tu última conciliación». Quien lee el titular se
    // queda con que lo dijo el banco, y no lo dijo.
    expect(rotulos([v("banco"), v("calculado")]).titulo).toContain("Estimado");
    expect(rotulos([v("calculado")]).cifra).toBe("Saldo estimado");
  });
});

describe("saldoVivo · la guarda de solape", () => {
  it("marca cuando el extracto empieza antes del último corte aprobado", () => {
    // «Los últimos 30 días» descargados el 14/08 empiezan el 15/07, y julio ya
    // está conciliado. La suma que llega de SQL ya excluye esos días; lo que
    // hace falta aquí es poder decirlo en pantalla.
    const v = vivo_(ext({ fechaMin: "2026-07-15" }), 138268.1);
    expect(v.solapa).toBe(true);
  });

  it("un extracto que arranca después del corte no solapa", () => {
    expect(vivo_(ext({ fechaMin: "2026-08-01" }), 138268.1).solapa).toBe(false);
  });

  it("sin corte aprobado no puede haber solape", () => {
    const v = vivo_(ext({ corteAprobado: null, fechaMin: "2026-01-01" }), 5000);
    expect(v.solapa).toBe(false);
  });
});

describe("saldoVivo · caducidad", () => {
  it("un extracto reciente es vigente", () => {
    const v = vivo_(ext({ fechaMax: "2026-08-14" }), 1000);
    expect(v.dias).toBe(1);
    expect(v.vigente).toBe(true);
  });

  it(`el límite está en ${DIAS_VIGENCIA} días, y el siguiente ya no es "hoy"`, () => {
    expect(vivo_(ext({ fechaMax: "2026-08-05" }), 1000).vigente).toBe(true); // 10
    expect(vivo_(ext({ fechaMax: "2026-08-04" }), 1000).vigente).toBe(false); // 11
  });

  it("⚠️ caducado NO se esconde: sigue siendo cierto sobre su fecha, y lo dice", () => {
    // El corte va antes del extracto: si no, no habría saldo vivo por otra
    // razón (no_supera_el_corte) y no se estaría probando la caducidad.
    const v = vivo_(ext({ fechaMax: "2026-07-20", corteAprobado: "2026-06-30" }), 1000);
    expect(v.vigente).toBe(false);
    expect(etiquetaVivo(v)).toContain("ya no es el saldo de hoy");
    expect(etiquetaVivo(v)).toContain("20/07/2026");
  });

  it("la etiqueta nunca dice solo «hoy»: siempre lleva la fecha", () => {
    const v = vivo_(ext(), 1000);
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
