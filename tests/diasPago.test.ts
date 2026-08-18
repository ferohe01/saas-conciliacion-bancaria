import { describe, it, expect } from "vitest";
import {
  calibrar,
  frase,
  puntualidad,
  ordenarPorRetraso,
  rangoTexto,
  medianaEmpresa,
  noCalculado,
  MIN_OBSERVACIONES,
  type ObservacionPago,
} from "@/lib/diasPago";

/**
 * Lo que fijan estos tests no es la aritmética de la mediana —la calcula
 * Postgres— sino el criterio: cuándo hay historial suficiente, qué se usa
 * cuando no lo hay, y sobre todo que «paga puntual» nunca se confunda con «no
 * lo sabemos», que dan el mismo número y significan lo contrario.
 */

function obs(p: Partial<ObservacionPago> = {}): ObservacionPago {
  return {
    nivel: "contraparte",
    contraparte: "COMERCIAL ÑUÑEZ",
    ruc: "20512345678",
    tipo: "cobranza",
    moneda: "PEN",
    observaciones: 8,
    diasMediana: 12,
    diasMin: 4,
    diasMax: 31,
    ultimoPago: "2026-07-28",
    montoTotal: 94500,
    ...p,
  };
}

const global = (p: Partial<ObservacionPago> = {}): ObservacionPago =>
  obs({
    nivel: "empresa",
    contraparte: null,
    ruc: null,
    observaciones: 140,
    diasMediana: 9,
    ...p,
  });

describe("calibrar · la cadena de respaldo", () => {
  it("con historial propio suficiente usa la mediana de la contraparte", () => {
    const [c] = calibrar([obs(), global()]);
    expect(c!.dias).toBe(12);
    expect(c!.fuente).toBe("contraparte");
    expect(c!.observaciones).toBe(8);
  });

  it(`por debajo de ${MIN_OBSERVACIONES} documentos cae a la media de la empresa`, () => {
    const [c] = calibrar([obs({ observaciones: 2, diasMediana: 40 }), global()]);
    // ⚠️ El 40 de dos facturas no se usa: dos observaciones no son una costumbre.
    expect(c!.dias).toBe(9);
    expect(c!.fuente).toBe("empresa");
    expect(c!.observacionesPropias).toBe(2);
  });

  it("sin media de empresa tampoco, se usa el vencimiento tal cual", () => {
    const [c] = calibrar([obs({ observaciones: 1, diasMediana: 40 })]);
    expect(c!.dias).toBe(0);
    expect(c!.fuente).toBe("vencimiento");
  });

  it("una media de empresa flaca no sirve de respaldo", () => {
    const [c] = calibrar([
      obs({ observaciones: 1 }),
      global({ observaciones: 2, diasMediana: 9 }),
    ]);
    expect(c!.fuente).toBe("vencimiento");
  });

  it("⚠️ el rango NO se hereda: sin historial propio no se le atribuye ninguno", () => {
    // Pegarle el mínimo y el máximo de toda la empresa a un cliente del que no
    // sabemos nada sería atribuirle un comportamiento ajeno.
    const [c] = calibrar([obs({ observaciones: 1 }), global()]);
    expect(c!.diasMin).toBeNull();
    expect(c!.diasMax).toBeNull();
  });

  it("clientes y proveedores se calibran por separado", () => {
    // Lo que tarda un cliente en pagarte no dice nada de lo que tardas tú en
    // pagar a un proveedor, aunque se llamen igual.
    const filas = [
      obs({ contraparte: "TEXTILES GAMARRA", tipo: "cobranza", diasMediana: 22 }),
      obs({ contraparte: "TEXTILES GAMARRA", tipo: "pago", diasMediana: 2 }),
      global({ tipo: "cobranza", diasMediana: 9 }),
      global({ tipo: "pago", diasMediana: 1 }),
    ];
    const cs = calibrar(filas);
    expect(cs.find((c) => c.tipo === "cobranza")!.dias).toBe(22);
    expect(cs.find((c) => c.tipo === "pago")!.dias).toBe(2);
  });

  it("el respaldo de empresa respeta la moneda", () => {
    const [c] = calibrar([
      obs({ moneda: "USD", observaciones: 1 }),
      global({ moneda: "PEN", diasMediana: 9 }),
    ]);
    // No hay media de empresa en dólares: no se toma la de soles.
    expect(c!.fuente).toBe("vencimiento");
  });

  it("las filas de nivel empresa no salen como contrapartes", () => {
    expect(calibrar([global()])).toHaveLength(0);
  });

  it("una mediana con decimales se redondea a un decimal, no a un entero", () => {
    // 12,5 días es una respuesta legítima y redondear a 13 movería la
    // proyección de todas sus facturas medio día sin motivo.
    const [c] = calibrar([obs({ diasMediana: 12.5 })]);
    expect(c!.dias).toBe(12.5);
  });
});

describe("frase · «puntual» y «no lo sabemos» no son lo mismo", () => {
  /**
   * ⚠️⚠️ Los dos casos dan 0 días. Uno es un hecho medido y el otro la ausencia
   * de datos, y llevan a decisiones opuestas: al primero le das crédito, al
   * segundo lo vigilas.
   */
  it("un cliente medido que paga el día del vencimiento", () => {
    const [c] = calibrar([obs({ diasMediana: 0, diasMin: 0, diasMax: 0, observaciones: 6 })]);
    expect(c!.dias).toBe(0);
    expect(frase(c!)).toContain("paga el día de su vencimiento");
    expect(frase(c!)).toContain("6 documentos");
  });

  it("uno del que no se sabe nada, con el mismo 0", () => {
    const [c] = calibrar([obs({ observaciones: 0, diasMediana: null })]);
    expect(c!.dias).toBe(0);
    expect(frase(c!)).toBe("sin historial: se usará el vencimiento tal cual");
  });

  it("dice el rango cuando lo hay, porque una mediana sola esconde la varianza", () => {
    const [c] = calibrar([obs()]);
    expect(frase(c!)).toContain("a 12 días");
    expect(frase(c!)).toContain("entre 4 y 31 días después");
  });

  it("⚠️ el rango habla el mismo idioma que la frase, sin signos crudos", () => {
    // Decía «paga 30 días antes de vencer (entre -30 y 0)»: la oración convierte
    // el signo a palabras y el paréntesis lo dejaba en bruto. Dos convenciones
    // en la misma frase, y el signo es justo lo que aquí no se puede leer mal.
    const [c] = calibrar([obs({ diasMediana: -30, diasMin: -30, diasMax: 0 })]);
    expect(frase(c!)).toContain("entre 30 días antes y el mismo día");
    expect(frase(c!)).not.toContain("-30");
  });

  it("no inventa un rango cuando todos los pagos fueron iguales", () => {
    const [c] = calibrar([obs({ diasMin: 5, diasMax: 5, diasMediana: 5 })]);
    expect(frase(c!)).not.toContain("entre");
  });

  it("quien paga antes de vencer se dice en positivo, no con un menos", () => {
    const [c] = calibrar([obs({ diasMediana: -4, diasMin: -9, diasMax: -1 })]);
    expect(frase(c!)).toContain("4 días antes de vencer");
  });

  it("cuando se hereda la media, se dice que se heredó y por qué", () => {
    const [c] = calibrar([obs({ observaciones: 2 }), global()]);
    expect(frase(c!)).toContain("no bastan");
    expect(frase(c!)).toContain("9 días");
  });

  it("y si no tiene ni uno, lo dice distinto", () => {
    const [c] = calibrar([obs({ observaciones: 0, diasMediana: null }), global()]);
    expect(frase(c!)).toContain("sin historial propio");
  });
});

describe("rangoTexto", () => {
  it("todo antes de vencer", () => {
    expect(rangoTexto(-30, -5)).toBe("entre 30 y 5 días antes");
  });
  it("todo después", () => {
    expect(rangoTexto(4, 31)).toBe("entre 4 y 31 días después");
  });
  it("de un lado a otro del vencimiento", () => {
    expect(rangoTexto(-12, 23)).toBe("entre 12 días antes y 23 después");
  });
  it("el cero se nombra, no se escribe «0 días antes»", () => {
    expect(rangoTexto(-30, 0)).toBe("entre 30 días antes y el mismo día");
    expect(rangoTexto(0, 15)).toBe("entre el mismo día y 15 días después");
  });
});

describe("puntualidad", () => {
  it("los cortes son de gestión, no de estadística", () => {
    expect(puntualidad(-5)).toBe("antes");
    expect(puntualidad(0)).toBe("puntual");
    expect(puntualidad(3)).toBe("puntual"); // fin de semana + acreditación
    expect(puntualidad(4)).toBe("algo_tarde");
    expect(puntualidad(15)).toBe("algo_tarde");
    expect(puntualidad(16)).toBe("tarde");
    expect(puntualidad(45)).toBe("tarde");
    expect(puntualidad(46)).toBe("muy_tarde"); // se financia contigo
  });
});

describe("ordenarPorRetraso", () => {
  it("primero los medidos, y dentro de ellos el que más tarda", () => {
    const cs = calibrar([
      obs({ contraparte: "A", diasMediana: 5 }),
      obs({ contraparte: "B", diasMediana: 40 }),
      obs({ contraparte: "C", observaciones: 1, diasMediana: 90 }),
      global(),
    ]);
    expect(ordenarPorRetraso(cs).map((c) => c.contraparte)).toEqual(["B", "A", "C"]);
  });

  it("a igualdad de días manda el importe: es donde hay más en juego", () => {
    const cs = calibrar([
      obs({ contraparte: "A", diasMediana: 20, montoTotal: 1000 }),
      obs({ contraparte: "B", diasMediana: 20, montoTotal: 90000 }),
    ]);
    expect(ordenarPorRetraso(cs)[0]!.contraparte).toBe("B");
  });
});

describe("medianaEmpresa y noCalculado", () => {
  it("devuelve la global cuando tiene suficientes observaciones", () => {
    expect(medianaEmpresa([global()], "cobranza", "PEN")).toEqual({
      dias: 9,
      observaciones: 140,
    });
  });

  it("null cuando no la hay: no se inventa una media", () => {
    expect(medianaEmpresa([obs()], "cobranza", "PEN")).toBeNull();
    expect(medianaEmpresa([global()], "pago", "PEN")).toBeNull();
  });

  it("⚠️ «no calculado» NO es «no hay historial»: es «hay demasiado»", () => {
    // Confundirlos diría que una empresa con medio millón de pares conciliados
    // no tiene datos.
    const filas: ObservacionPago[] = [
      { ...global(), nivel: "no_calculado", observaciones: 447795, diasMediana: null },
    ];
    expect(noCalculado(filas)).toBe(447795);
    expect(calibrar(filas)).toHaveLength(0);
  });

  it("sin esa fila, no hay nada que avisar", () => {
    expect(noCalculado([obs(), global()])).toBeNull();
  });
});
