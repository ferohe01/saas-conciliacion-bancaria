import { describe, it, expect } from "vitest";
import {
  evaluarDiagnostico,
  debeRevisar,
  resumenDiagnostico,
  COBERTURA_MINIMA,
  type ContadoresPrevios,
} from "../src/lib/diagnosticoPrevio";

const MAX = 20_000;

/** Una conciliación sana: todo mapeado y casando. */
const SANO: ContadoresPrevios = {
  internos: 1000,
  internos_con_ref: 1000,
  internos_ref_repetida: 0,
  movimientos: 1000,
  movimientos_con_ref: 1000,
  movimientos_ref_repetida: 0,
  movimientos_abono: 700,
  movimientos_cargo: 300,
  movimientos_fuera: 0,
  movimientos_dia_bajo: 400,
  refs_compartidas: 980,
  pares_estimados: 980,
};

const con = (p: Partial<ContadoresPrevios>): ContadoresPrevios => ({ ...SANO, ...p });
const codigos = (c: ContadoresPrevios) =>
  evaluarDiagnostico(c, MAX).map((h) => h.codigo);

describe("caso sano", () => {
  it("no reporta ningún problema ni aviso", () => {
    const h = evaluarDiagnostico(SANO, MAX);
    expect(h.every((x) => x.severidad === "info")).toBe(true);
    expect(debeRevisar(h)).toBe(false);
  });

  it("confirma la cobertura en positivo: callarlo parecería que no se comprobó", () => {
    expect(codigos(SANO)).toContain("cobertura_alta");
    const alta = evaluarDiagnostico(SANO, MAX).find(
      (x) => x.codigo === "cobertura_alta",
    );
    expect(alta?.titulo).toContain("98 %");
  });
});

describe("el caso que motivó todo: 0 % por una columna sin mapear", () => {
  const CIEGO = con({
    internos: 452_177,
    internos_con_ref: 452_177,
    movimientos: 450_999,
    movimientos_con_ref: 0, // la columna "Recibos" no se mapeó
    refs_compartidas: 0,
    pares_estimados: 0,
    movimientos_cargo: 1000,
    movimientos_dia_bajo: 100_000,
  });

  it("lo marca como crítico ANTES de correr nada", () => {
    expect(codigos(CIEGO)).toContain("sin_referencia_extracto");
    expect(debeRevisar(evaluarDiagnostico(CIEGO, MAX))).toBe(true);
  });

  it("el hallazgo dice qué hacer, no solo qué pasa", () => {
    const h = evaluarDiagnostico(CIEGO, MAX).find(
      (x) => x.codigo === "sin_referencia_extracto",
    );
    expect(h?.accion).toContain("Paso 2");
  });

  it("no acusa además a los comprobantes: el problema es del extracto", () => {
    expect(codigos(CIEGO)).not.toContain("sin_referencia_internos");
  });
});

describe("referencias que existen en los dos lados pero no son el mismo código", () => {
  // Recibos "SR11-02748951" contra operaciones "00000001300486": las dos
  // columnas están mapeadas y aun así no casa ni una.
  const INCOMPATIBLES = con({ refs_compartidas: 0, pares_estimados: 0 });

  it("se detecta y es crítico", () => {
    expect(codigos(INCOMPATIBLES)).toContain("referencias_incompatibles");
    expect(debeRevisar(evaluarDiagnostico(INCOMPATIBLES, MAX))).toBe(true);
  });

  it("no se confunde con 'falta mapear': ese aviso mandaría al sitio equivocado", () => {
    expect(codigos(INCOMPATIBLES)).not.toContain("sin_referencia_extracto");
  });
});

describe("cobertura estimada", () => {
  it("por debajo del mínimo es crítico y dice las dos cifras", () => {
    const h = evaluarDiagnostico(
      con({ pares_estimados: 12, movimientos: 450_999 }),
      MAX,
    ).find((x) => x.codigo === "cobertura_baja");
    expect(h?.severidad).toBe("critico");
    expect(h?.titulo).toContain("12");
    expect(h?.titulo).toContain("450,999");
  });

  it("justo en el umbral ya NO es crítico", () => {
    const enElLimite = con({
      movimientos: 1000,
      pares_estimados: Math.ceil(1000 * COBERTURA_MINIMA),
    });
    expect(codigos(enElLimite)).toContain("cobertura_alta");
  });

  it("null NO se cuenta como cero: es 'no se estimó', y se dice", () => {
    const h = evaluarDiagnostico(con({ pares_estimados: null }), MAX);
    expect(h.map((x) => x.codigo)).toContain("cobertura_no_estimada");
    expect(h.map((x) => x.codigo)).not.toContain("cobertura_baja");
    expect(debeRevisar(h)).toBe(false);
  });
});

describe("forma de los datos", () => {
  it("un solo signo en el extracto sugiere una columna de importe sin mapear", () => {
    expect(codigos(con({ movimientos_cargo: 0 }))).toContain("un_solo_signo");
    expect(codigos(con({ movimientos_abono: 0 }))).toContain("un_solo_signo");
  });

  it("con pocos movimientos no se afirma nada: no hay señal", () => {
    const pocos = con({ movimientos: 5, movimientos_abono: 5, movimientos_cargo: 0 });
    expect(codigos(pocos)).not.toContain("un_solo_signo");
  });

  it("ninguna fecha pasa del día 12 = fecha leída al revés", () => {
    const c = con({ movimientos: 500, movimientos_dia_bajo: 500 });
    expect(codigos(c)).toContain("fechas_ambiguas");
  });

  it("pero un solo día 13 basta para descartarlo", () => {
    const c = con({ movimientos: 500, movimientos_dia_bajo: 499 });
    expect(codigos(c)).not.toContain("fechas_ambiguas");
  });

  it("avisa del archivo de otro mes a partir del 30 %", () => {
    expect(codigos(con({ movimientos: 100, movimientos_fuera: 30 }))).toContain(
      "fuera_de_periodo",
    );
    expect(
      codigos(con({ movimientos: 100, movimientos_fuera: 29 })),
    ).not.toContain("fuera_de_periodo");
  });

  it("las referencias repetidas son informativas, no un problema", () => {
    const h = evaluarDiagnostico(con({ movimientos_ref_repetida: 490 }), MAX);
    const rep = h.find((x) => x.codigo === "referencias_repetidas");
    expect(rep?.severidad).toBe("info");
    expect(debeRevisar(h)).toBe(false);
  });
});

describe("lo que impide conciliar del todo", () => {
  it("sin comprobantes en el período", () => {
    const h = evaluarDiagnostico(con({ internos: 0, internos_con_ref: 0 }), MAX);
    expect(h.map((x) => x.codigo)).toContain("sin_internos");
    expect(debeRevisar(h)).toBe(true);
  });

  it("por encima del tope avisa AQUÍ, no al fallar el inicio", () => {
    const h = evaluarDiagnostico(con({ movimientos: MAX + 1 }), MAX);
    const v = h.find((x) => x.codigo === "volumen");
    expect(v?.severidad).toBe("critico");
    expect(v?.accion).toContain("rango");
  });
});

describe("orden y resumen", () => {
  it("lo crítico va primero: es lo que hay que leer", () => {
    const h = evaluarDiagnostico(
      con({ movimientos_con_ref: 0, movimientos_cargo: 0, movimientos_ref_repetida: 5 }),
      MAX,
    );
    const sev = h.map((x) => x.severidad);
    expect(sev).toEqual([...sev].sort((a, b) =>
      ({ critico: 0, aviso: 1, info: 2 })[a] - ({ critico: 0, aviso: 1, info: 2 })[b],
    ));
    expect(sev[0]).toBe("critico");
  });

  it("el resumen cuenta problemas y avisos, y calla cuando no hay nada", () => {
    expect(resumenDiagnostico(evaluarDiagnostico(SANO, MAX))).toBeNull();
    expect(
      resumenDiagnostico(evaluarDiagnostico(con({ movimientos_con_ref: 0 }), MAX)),
    ).toContain("1 problema");
    expect(
      resumenDiagnostico(evaluarDiagnostico(con({ movimientos_cargo: 0 }), MAX)),
    ).toBe("1 aviso");
  });
});
