import { describe, it, expect } from "vitest";
import {
  diagnosticarPartida,
  normRef,
  type PartidaSuelta,
  type CandidatoPartida,
  type ConfigDiagnostico,
} from "../src/lib/diagnosticoPartida";

const CONFIG: ConfigDiagnostico = {
  tolerancia_dias: 3,
  ventana_ia_dias: 30,
  max_combinacion: 3,
};

const PARTIDA: PartidaSuelta = {
  id: "REG-0007",
  fecha: "2026-07-03",
  monto: 99,
  texto: "Comercial Ñuñez SAC",
  referencia: "SR11-02748951",
};

const cand = (p: Partial<CandidatoPartida> = {}): CandidatoPartida => ({
  id: "BCO-0001",
  fecha: "2026-07-03",
  monto: 99,
  texto: "DEPOSITO COMERCIAL NUNEZ",
  referencia: "SR11-02748951",
  ocupadoPor: null,
  ...p,
});

const dx = (
  candidatos: CandidatoPartida[],
  hermanas: PartidaSuelta[] = [],
  partida = PARTIDA,
) => diagnosticarPartida(partida, candidatos, CONFIG, hermanas);

describe("normRef", () => {
  it("es la misma normalización que ref_norm y normRef de n8n", () => {
    expect(normRef("SR11-02748951")).toBe("SR1102748951");
    expect(normRef("sr11 027/489.51")).toBe("SR1102748951");
    expect(normRef("")).toBe("");
  });
});

describe("se lo llevó otra partida", () => {
  it("es el primer diagnóstico: correcto, invisible y lo primero que se pregunta", () => {
    const d = dx([cand({ ocupadoPor: "REG-0002" })]);
    expect(d.codigo).toBe("ya_emparejado");
    expect(d.detalle).toContain("REG-0002");
  });

  it("manda sobre cualquier otro indicio", () => {
    const d = dx([
      cand({ id: "BCO-0009", monto: 87, referencia: "SR11-02748951" }),
      cand({ ocupadoPor: "REG-0002" }),
    ]);
    expect(d.codigo).toBe("ya_emparejado");
  });

  it("un ocupado que NO casaba no cuenta: no explicaría nada", () => {
    const d = dx([cand({ monto: 5000, referencia: "OTRA", ocupadoPor: "REG-0003" })]);
    expect(d.codigo).not.toBe("ya_emparejado");
  });

  it("aporta la evidencia: sin ella el usuario no puede comprobarlo", () => {
    const d = dx([cand({ ocupadoPor: "REG-0002" })]);
    expect(d.evidencia).toHaveLength(1);
    expect(d.evidencia[0]?.id).toBe("BCO-0001");
  });
});

describe("las referencias se contradicen", () => {
  // El motor descarta este par a propósito: es la guarda que evitó 541 pares
  // falsos marcados `auto`. Desde la pantalla parecía un olvido.
  const contradictorio = cand({ referencia: "00000009999999" });

  it("se explica como decisión, no como fallo", () => {
    const d = dx([contradictorio]);
    expect(d.codigo).toBe("referencia_contradice");
    expect(d.detalle).toContain("a propósito");
  });

  it("enseña las DOS referencias: es lo que hace verificable la afirmación", () => {
    const d = dx([contradictorio]);
    expect(d.detalle).toContain("00000009999999");
    expect(d.detalle).toContain("SR11-02748951");
  });

  it("no aplica si a una de las dos le falta la referencia", () => {
    const d = dx([cand({ referencia: "" })]);
    expect(d.codigo).not.toBe("referencia_contradice");
  });
});

describe("el importe no cuadra", () => {
  it("con la misma referencia, informa de la diferencia exacta", () => {
    const d = dx([cand({ monto: 94.5 })]);
    expect(d.codigo).toBe("monto_diferente");
    expect(d.titulo).toContain("4.50");
  });

  it("también por nombre + fecha cercana, sin referencia", () => {
    const d = dx([
      cand({ monto: 94.5, referencia: "", fecha: "2026-07-05" }),
    ]);
    expect(d.codigo).toBe("monto_diferente");
  });

  it("con el nombre igual pero la fecha lejos, ya no lo afirma", () => {
    const d = dx([
      cand({ monto: 94.5, referencia: "", fecha: "2026-09-05" }),
    ]);
    expect(d.codigo).not.toBe("monto_diferente");
  });

  it("elige el más cercano en importe, no el primero de la lista", () => {
    const d = dx([
      cand({ id: "BCO-A", monto: 60 }),
      cand({ id: "BCO-B", monto: 98 }),
    ]);
    expect(d.evidencia[0]?.id).toBe("BCO-B");
  });
});

describe("está pero demasiado lejos en el tiempo", () => {
  it("cuenta los días y nombra la ventana", () => {
    const d = dx([cand({ referencia: "", fecha: "2026-09-15" })]);
    expect(d.codigo).toBe("fuera_de_ventana");
    expect(d.titulo).toContain("74 días");
    expect(d.detalle).toContain("30");
  });

  it("dentro de la ventana no se reporta: ahí el motor ya lo mira", () => {
    const d = dx([cand({ referencia: "", fecha: "2026-07-20" })]);
    expect(d.codigo).not.toBe("fuera_de_ventana");
  });
});

describe("el mismo importe pero al revés", () => {
  it("señala el signo, que suele ser un tipo de comprobante mal puesto", () => {
    const d = dx([cand({ monto: -99, referencia: "", texto: "OTRA COSA" })]);
    expect(d.codigo).toBe("signo_contrario");
    expect(d.accion).toContain("cobranza");
  });
});

describe("agrupación 1:N", () => {
  const hermana = (id: string, monto: number, ref = "SR11-02748951") => ({
    id,
    fecha: "2026-07-03",
    monto,
    texto: "Comercial Ñuñez SAC",
    referencia: ref,
  });

  it("detecta que dos partidas suman un depósito", () => {
    const d = dx(
      [cand({ id: "BCO-DEP", monto: 250, referencia: "", texto: "DEPOSITO" })],
      [hermana("REG-0008", 151)],
    );
    expect(d.codigo).toBe("agrupacion_posible");
    expect(d.evidencia[0]?.id).toBe("BCO-DEP");
  });

  it("respeta max_combinacion: un grupo mayor no se propone", () => {
    const d = diagnosticarPartida(
      PARTIDA,
      [cand({ id: "BCO-DEP", monto: 400, referencia: "", texto: "DEPOSITO" })],
      { ...CONFIG, max_combinacion: 2 },
      [hermana("REG-0008", 151), hermana("REG-0009", 150)],
    );
    expect(d.codigo).not.toBe("agrupacion_posible");
  });

  it("⚠️ NO agrupa partidas sin identidad compartida, aunque la suma cuadre", () => {
    // Sin este prefiltro, un subset-sum empareja partidas sin relación cuya
    // suma coincide por azar y el resultado parece correcto.
    const d = dx(
      [cand({ id: "BCO-DEP", monto: 250, referencia: "", texto: "DEPOSITO" })],
      [
        {
          id: "REG-9999",
          fecha: "2026-07-03",
          monto: 151,
          texto: "Ferretería Los Andes",
          referencia: "F001-12",
        },
      ],
    );
    expect(d.codigo).not.toBe("agrupacion_posible");
  });

  it("no propone agrupar contra un movimiento ya ocupado", () => {
    const d = dx(
      [cand({ id: "BCO-DEP", monto: 250, referencia: "", ocupadoPor: "REG-1" })],
      [hermana("REG-0008", 151)],
    );
    expect(d.codigo).not.toBe("agrupacion_posible");
  });
});

describe("no hay nada parecido", () => {
  it("es el resultado más común y NO se presenta como un fallo", () => {
    const d = dx([]);
    expect(d.codigo).toBe("sin_candidato");
    expect(d.detalle).toContain("otra cuenta");
  });

  it("enseña lo más cercano: un 'no encontré nada' parece que no se miró", () => {
    const d = dx([
      cand({ id: "BCO-X", monto: 4000, referencia: "", texto: "OTRA COSA" }),
      cand({ id: "BCO-Y", monto: 120, referencia: "", texto: "OTRA COSA" }),
    ]);
    expect(d.codigo).toBe("sin_candidato");
    expect(d.evidencia[0]?.id).toBe("BCO-Y");
  });

  it("sin candidatos no inventa evidencia", () => {
    expect(dx([]).evidencia).toEqual([]);
  });
});

describe("forma del diagnóstico", () => {
  it("siempre devuelve algo: no hay partida sin explicación", () => {
    const casos: CandidatoPartida[][] = [
      [],
      [cand({ ocupadoPor: "X" })],
      [cand({ monto: 1 })],
      [cand({ referencia: "OTRA" })],
    ];
    for (const c of casos) {
      const d = dx(c);
      expect(d.titulo.length).toBeGreaterThan(0);
      expect(d.detalle.length).toBeGreaterThan(0);
    }
  });

  it("toda evidencia citada viene de los candidatos recibidos", () => {
    const candidatos = [cand({ id: "BCO-1", monto: 94.5 })];
    const d = dx(candidatos);
    for (const e of d.evidencia) {
      expect(candidatos.map((c) => c.id)).toContain(e.id);
    }
  });
});
