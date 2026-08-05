import { describe, it, expect } from "vitest";
import {
  metricasAprendizaje,
  pct,
  type JobMetrica,
  type MatchMetrica,
} from "@/lib/aprendizajeMetricas";

const m = (
  metodo: string,
  estado_revision: string,
  accion?: string,
): MatchMetrica => ({
  metodo,
  estado_revision,
  ...(accion ? { decisiones: [{ accion, timestamp: "2026-08-01T10:00:00Z" }] } : {}),
});

const job = (id: string, matches: MatchMetrica[], fecha = "2026-08-01"): JobMetrica => ({
  id,
  created_at: `${fecha}T10:00:00Z`,
  resultado: { matches },
});

describe("qué entra en la tasa", () => {
  it("solo cuenta los matches de la IA", () => {
    // La conciliación exacta no mejora con el aprendizaje: incluirla diluiría
    // la señal hasta volverla inútil.
    const r = metricasAprendizaje([
      job("j1", [
        m("exacta", "auto"),
        m("difusa", "aceptado", "aceptado"),
        m("ia", "aceptado", "aceptado"),
      ]),
    ]);
    expect(r.revisadas).toBe(1);
    expect(r.aceptadas).toBe(1);
    expect(r.tasa).toBe(1);
  });

  it("los auto de la IA NO entran en la tasa, pero se cuentan aparte", () => {
    // Nadie los reviso: no son evidencia de acierto. Incluirlos disparararia la
    // cifra sin que signifique nada.
    const r = metricasAprendizaje([
      job("j1", [m("ia", "auto"), m("ia", "auto"), m("ia", "rechazado", "rechazado")]),
    ]);
    expect(r.automaticas).toBe(2);
    expect(r.revisadas).toBe(1);
    expect(r.tasa).toBe(0); // 0 aceptadas de 1 revisada
  });

  it("'modificado' cuenta como fallo, no como acierto", () => {
    // Hubo que corregir la propuesta: para el usuario fue trabajo, no ahorro.
    const r = metricasAprendizaje([
      job("j1", [m("ia", "aceptado", "aceptado"), m("ia", "modificado", "modificado")]),
    ]);
    expect(r.modificadas).toBe(1);
    expect(r.revisadas).toBe(2);
    expect(r.tasa).toBe(0.5);
  });

  it("las pendientes sin decidir no cuentan todavía", () => {
    const r = metricasAprendizaje([
      job("j1", [m("ia", "pendiente"), m("ia", "aceptado", "aceptado")]),
    ]);
    expect(r.revisadas).toBe(1);
  });

  it("manda la última decisión, no el estado inicial", () => {
    const cambiado: MatchMetrica = {
      metodo: "ia",
      estado_revision: "pendiente",
      decisiones: [
        { accion: "aceptado", timestamp: "2026-08-01T10:00:00Z" },
        { accion: "rechazado", timestamp: "2026-08-02T10:00:00Z" },
      ],
    };
    const r = metricasAprendizaje([job("j1", [cambiado])]);
    expect(r.rechazadas).toBe(1);
    expect(r.aceptadas).toBe(0);
  });

  it("sin nada revisado la tasa es null, no cero", () => {
    // Cero significaria "la IA fallo siempre"; null significa "aun no sabemos".
    const r = metricasAprendizaje([job("j1", [m("ia", "auto")])]);
    expect(r.tasa).toBeNull();
  });
});

describe("puntos de la curva", () => {
  it("deja fuera las corridas donde la IA no propuso nada", () => {
    const r = metricasAprendizaje([
      job("j1", [m("exacta", "auto")]),
      job("j2", [m("ia", "aceptado", "aceptado")]),
    ]);
    expect(r.puntos.map((p) => p.jobId)).toEqual(["j2"]);
  });

  it("conserva el orden recibido, sin reordenar por fecha", () => {
    const r = metricasAprendizaje([
      job("a", [m("ia", "aceptado", "aceptado")], "2026-08-01"),
      job("b", [m("ia", "aceptado", "aceptado")], "2026-07-01"),
    ]);
    expect(r.puntos.map((p) => p.jobId)).toEqual(["a", "b"]);
  });

  it("cada punto lleva su propia tasa y fecha", () => {
    const r = metricasAprendizaje([
      job("j1", [m("ia", "aceptado", "aceptado"), m("ia", "rechazado", "rechazado")]),
    ]);
    expect(r.puntos[0]!.tasa).toBe(0.5);
    expect(r.puntos[0]!.fecha).toBe("2026-08-01");
  });
});

describe("tendencia: no afirmar mejoras que no se sostienen", () => {
  const jobConN = (id: string, aceptadas: number, rechazadas: number) =>
    job(id, [
      ...Array.from({ length: aceptadas }, () => m("ia", "aceptado", "aceptado")),
      ...Array.from({ length: rechazadas }, () => m("ia", "rechazado", "rechazado")),
    ]);

  it("con menos de cuatro corridas revisadas no hay tendencia", () => {
    const r = metricasAprendizaje([jobConN("j1", 8, 2), jobConN("j2", 9, 1)]);
    expect(r.tendencia).toBeNull();
    expect(r.motivoSinTendencia).toContain("cuatro conciliaciones");
  });

  it("con pocas decisiones tampoco, aunque haya corridas de sobra", () => {
    // 4 corridas de 2 decisiones = 8 en total: un cambio de una sola decision
    // moveria la cifra 25 puntos. Eso no es una tendencia.
    const r = metricasAprendizaje([
      jobConN("j1", 1, 1),
      jobConN("j2", 1, 1),
      jobConN("j3", 2, 0),
      jobConN("j4", 2, 0),
    ]);
    expect(r.tendencia).toBeNull();
    expect(r.motivoSinTendencia).toContain("pocas decisiones");
  });

  it("con volumen suficiente sí la calcula, y detecta la mejora", () => {
    const r = metricasAprendizaje([
      jobConN("j1", 5, 5), // 50%
      jobConN("j2", 5, 5), // 50%
      jobConN("j3", 9, 1), // 90%
      jobConN("j4", 9, 1), // 90%
    ]);
    expect(r.tendencia).not.toBeNull();
    expect(r.tendencia!.tasaAntes).toBeCloseTo(0.5);
    expect(r.tendencia!.tasaDespues).toBeCloseTo(0.9);
    expect(r.tendencia!.delta).toBe(40);
  });

  it("un empeoramiento se reporta igual de claro que una mejora", () => {
    // Si la cifra solo pudiera subir seria propaganda, no una medicion.
    const r = metricasAprendizaje([
      jobConN("j1", 9, 1),
      jobConN("j2", 9, 1),
      jobConN("j3", 5, 5),
      jobConN("j4", 5, 5),
    ]);
    expect(r.tendencia!.delta).toBe(-40);
  });

  it("la tasa del tramo se pondera por volumen, no promedia corridas", () => {
    // Una corrida de 1 decision no debe pesar lo mismo que una de 20.
    const r = metricasAprendizaje([
      jobConN("j1", 10, 10),
      jobConN("j2", 10, 10),
      jobConN("j3", 20, 0),
      jobConN("j4", 0, 20),
    ]);
    expect(r.tendencia!.tasaAntes).toBeCloseTo(0.5);
    expect(r.tendencia!.tasaDespues).toBeCloseTo(0.5);
    expect(r.tendencia!.delta).toBe(0);
  });
});

describe("casos vacíos", () => {
  it("sin jobs no revienta", () => {
    const r = metricasAprendizaje([]);
    expect(r.tasa).toBeNull();
    expect(r.puntos).toEqual([]);
    expect(r.tendencia).toBeNull();
  });

  it("un resultado nulo se ignora", () => {
    const r = metricasAprendizaje([{ id: "j1", resultado: null }]);
    expect(r.revisadas).toBe(0);
  });
});

describe("pct", () => {
  it("null se muestra como raya, no como 0%", () => {
    expect(pct(null)).toBe("—");
    expect(pct(0)).toBe("0%");
    expect(pct(0.856)).toBe("86%");
  });
});
