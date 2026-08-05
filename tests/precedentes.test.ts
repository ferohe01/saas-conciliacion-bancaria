import { describe, it, expect } from "vitest";
import {
  buscarPrecedente,
  extraerCasos,
  palabras,
  type CasoResuelto,
  type CasoNuevo,
} from "@/lib/precedentes";

const caso = (p: Partial<CasoResuelto> = {}): CasoResuelto => ({
  decision: "aceptado",
  fecha: "2026-03-10",
  contraparte: "Comercial Ñuñez SAC",
  glosa: "TRANSF COMERCIAL NUNEZ",
  montoInterno: 1000,
  montoBanco: 988,
  diferencia: 12,
  categoria: "comision_bancaria",
  ...p,
});

const nuevo = (p: Partial<CasoNuevo> = {}): CasoNuevo => ({
  contraparte: "Comercial Ñuñez SAC",
  glosa: "TRANSF",
  montoInterno: 2000,
  montoBanco: 1988,
  diferencia: 12,
  categoria: "comision_bancaria",
  ...p,
});

describe("palabras significativas", () => {
  it("ignora tildes y sufijos societarios", () => {
    expect(palabras("Comercial Ñuñez S.A.C.")).toEqual(["comercial", "nunez"]);
  });

  it("descarta el ruido de las glosas bancarias", () => {
    expect(palabras("TRANSFERENCIA DEPOSITO ABONO")).toEqual([]);
  });
});

describe("buscarPrecedente", () => {
  it("encuentra el caso del mismo cliente con la misma diferencia", () => {
    const p = buscarPrecedente(nuevo(), [caso()]);
    expect(p).not.toBeNull();
    expect(p!.motivo).toBe("mismo cliente y misma diferencia");
  });

  it("reconoce al cliente aunque venga escrito distinto", () => {
    const p = buscarPrecedente(nuevo({ contraparte: "COMERCIAL NUNEZ E.I.R.L." }), [caso()]);
    expect(p).not.toBeNull();
    expect(p!.motivo).toContain("mismo cliente");
  });

  it("reconoce al cliente por la glosa del banco de aquel caso", () => {
    // En un extracto el nombre suele venir dentro de la glosa, no en un campo.
    const p = buscarPrecedente(nuevo(), [
      caso({ contraparte: "", glosa: "ABONO COMERCIAL NUNEZ" }),
    ]);
    expect(p).not.toBeNull();
  });

  it("devuelve null cuando no hay nada parecido de verdad", () => {
    // Preferible a rellenar con parecidos forzados, que ensenan a ignorar el
    // recuadro.
    const p = buscarPrecedente(
      nuevo({ contraparte: "Distribuidora Andina", diferencia: 0, categoria: null }),
      [caso()],
    );
    expect(p).toBeNull();
  });

  it("la categoría por sí sola no basta para citar un precedente", () => {
    const p = buscarPrecedente(
      nuevo({ contraparte: "Otra Empresa", diferencia: 0 }),
      [caso({ contraparte: "Nada Que Ver", glosa: "" })],
    );
    expect(p).toBeNull();
  });

  it("misma diferencia + misma categoría sí alcanzan, sin ser el mismo cliente", () => {
    const p = buscarPrecedente(nuevo({ contraparte: "Otra Empresa" }), [
      caso({ contraparte: "Nada Que Ver", glosa: "" }),
    ]);
    expect(p).not.toBeNull();
    expect(p!.motivo).toBe("misma diferencia");
  });

  it("una diferencia de cero no cuenta como coincidencia", () => {
    // Si contara, media conciliación seria "precedente" de la otra media.
    const p = buscarPrecedente(
      nuevo({ contraparte: "Otra Empresa", diferencia: 0 }),
      [caso({ contraparte: "Nada Que Ver", glosa: "", diferencia: 0 })],
    );
    expect(p).toBeNull();
  });

  it("gana el mejor parecido, no el primero de la lista", () => {
    const flojo = caso({ contraparte: "Nada Que Ver", glosa: "" });
    const fuerte = caso({ fecha: "2026-05-01" });
    expect(buscarPrecedente(nuevo(), [flojo, fuerte])!.caso.fecha).toBe("2026-05-01");
  });

  it("en empate gana el más reciente (el primero de la lista)", () => {
    const reciente = caso({ fecha: "2026-06-01" });
    const antiguo = caso({ fecha: "2025-01-01" });
    expect(
      buscarPrecedente(nuevo(), [reciente, antiguo])!.caso.fecha,
    ).toBe("2026-06-01");
  });

  it("un rechazo también es precedente", () => {
    // Saber que aquella vez lo rechazaste es tan util como saber que lo
    // aceptaste — a veces mas.
    const p = buscarPrecedente(nuevo(), [caso({ decision: "rechazado" })]);
    expect(p!.caso.decision).toBe("rechazado");
  });

  it("sin historial no revienta", () => {
    expect(buscarPrecedente(nuevo(), [])).toBeNull();
  });
});

describe("extraerCasos", () => {
  const job = (estado: string, accion?: string) => ({
    payload_entrada: {
      registros_internos: [
        { id_interno: "REG-1", fecha: "2026-03-01", monto: 1000, contraparte: "Ñuñez SAC" },
      ],
      movimientos_bancarios: [
        { id_movimiento: "MOV-1", fecha: "2026-03-02", monto: 988, glosa: "ABONO" },
      ],
    },
    resultado: {
      matches: [
        {
          ids_internos: ["REG-1"],
          ids_movimientos: ["MOV-1"],
          metodo: "ia",
          categoria_diferencia: "comision_bancaria",
          estado_revision: estado,
          ...(accion ? { decisiones: [{ accion, timestamp: "2026-03-05T12:00:00Z" }] } : {}),
        },
      ],
    },
  });

  it("solo toma lo que una persona decidió", () => {
    // Lo auto-conciliado no sirve como precedente: nadie lo miro, asi que
    // citarlo como "tu lo resolviste asi" seria falso.
    expect(extraerCasos([job("auto")])).toHaveLength(0);
    expect(extraerCasos([job("pendiente")])).toHaveLength(0);
    expect(extraerCasos([job("aceptado", "aceptado")])).toHaveLength(1);
  });

  it("'modificado' entra como aceptado", () => {
    const casos = extraerCasos([job("modificado", "modificado")]);
    expect(casos[0]!.decision).toBe("aceptado");
  });

  it("calcula la diferencia y toma la fecha de la decisión", () => {
    const casos = extraerCasos([job("aceptado", "aceptado")]);
    expect(casos[0]!.diferencia).toBe(12);
    expect(casos[0]!.fecha).toBe("2026-03-05");
    expect(casos[0]!.contraparte).toBe("Ñuñez SAC");
  });

  it("ignora matches cuyos ids no están en el payload", () => {
    const roto = {
      payload_entrada: { registros_internos: [], movimientos_bancarios: [] },
      resultado: {
        matches: [
          {
            ids_internos: ["REG-9"],
            ids_movimientos: ["MOV-9"],
            estado_revision: "aceptado",
          },
        ],
      },
    };
    expect(extraerCasos([roto])).toHaveLength(0);
  });

  it("sin jobs devuelve lista vacía", () => {
    expect(extraerCasos([])).toEqual([]);
  });
});
