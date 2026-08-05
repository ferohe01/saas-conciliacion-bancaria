import { describe, it, expect } from "vitest";
import {
  construirEjemplos,
  resumenAprendizaje,
  type JobHistorico,
} from "@/lib/aprendizaje";

type MatchArg = NonNullable<NonNullable<JobHistorico["resultado"]>["matches"]>[number];

function job(matches: MatchArg[]): JobHistorico {
  return {
    payload_entrada: {
      registros_internos: [
        { id_interno: "REG-1", fecha: "2026-03-01", monto: 500, contraparte: "ROSA IBARRA" },
        { id_interno: "REG-2", fecha: "2026-03-02", monto: 300, contraparte: "JUAN PEREZ" },
        { id_interno: "REG-3", fecha: "2026-03-03", monto: 200, contraparte: "LUIS GOMEZ" },
      ],
      movimientos_bancarios: [
        { id_movimiento: "BCO-1", fecha: "2026-03-10", monto: 495, glosa: "DEPOSITO ROSA IBARRA" },
        { id_movimiento: "BCO-2", fecha: "2026-03-11", monto: 300, glosa: "TRANSF JUAN P" },
        { id_movimiento: "BCO-3", fecha: "2026-03-12", monto: 200, glosa: "ABONO X" },
      ],
    },
    resultado: { matches },
  };
}

describe("construirEjemplos", () => {
  it("toma match aceptado como positivo y rechazado como negativo", () => {
    const ej = construirEjemplos([
      job([
        {
          ids_internos: ["REG-1"],
          ids_movimientos: ["BCO-1"],
          metodo: "ia",
          categoria_diferencia: "comision_bancaria",
          estado_revision: "aceptado",
        },
        {
          ids_internos: ["REG-3"],
          ids_movimientos: ["BCO-3"],
          metodo: "ia",
          estado_revision: "rechazado",
        },
      ]),
    ]);
    expect(ej).toHaveLength(2);
    const acept = ej.find((e) => e.decision === "aceptado")!;
    expect(acept.interno).toContain("ROSA IBARRA");
    expect(acept.banco).toContain("DEPOSITO ROSA IBARRA");
    expect(acept.categoria).toBe("comision_bancaria");
    expect(ej.some((e) => e.decision === "rechazado")).toBe(true);
  });

  it("ignora matches automáticos (auto/exacta) y pendientes", () => {
    const ej = construirEjemplos([
      job([
        { ids_internos: ["REG-1"], ids_movimientos: ["BCO-1"], metodo: "exacta", estado_revision: "auto" },
        { ids_internos: ["REG-2"], ids_movimientos: ["BCO-2"], metodo: "ia", estado_revision: "pendiente" },
      ]),
    ]);
    expect(ej).toHaveLength(0);
  });

  it("usa la última decisión del historial", () => {
    const ej = construirEjemplos([
      job([
        {
          ids_internos: ["REG-1"],
          ids_movimientos: ["BCO-1"],
          metodo: "ia",
          estado_revision: "aceptado",
          decisiones: [
            { accion: "aceptado", timestamp: "2026-03-15T10:00:00.000Z" },
            { accion: "rechazado", timestamp: "2026-03-15T11:00:00.000Z" },
          ],
        },
      ]),
    ]);
    expect(ej).toHaveLength(1);
    expect(ej[0]!.decision).toBe("rechazado");
  });

  it("trata un match manual como positivo aunque no tenga decisiones", () => {
    const ej = construirEjemplos([
      job([
        { ids_internos: ["REG-2"], ids_movimientos: ["BCO-2"], metodo: "manual", estado_revision: "auto" },
      ]),
    ]);
    expect(ej).toHaveLength(1);
    expect(ej[0]!.decision).toBe("aceptado");
  });

  it("respeta maxPorClase y deduplica ejemplos idénticos", () => {
    const unMatch = {
      ids_internos: ["REG-1"],
      ids_movimientos: ["BCO-1"],
      metodo: "ia",
      estado_revision: "aceptado",
    };
    // Mismo par repetido en varios jobs → un solo ejemplo.
    const jobs = [job([unMatch]), job([unMatch]), job([unMatch])];
    const ej = construirEjemplos(jobs, { maxPorClase: 5 });
    expect(ej).toHaveLength(1);
  });

  it("resumenAprendizaje cuenta el pool y limita los activos por corrida", () => {
    // 8 aceptados + 2 rechazados en un job.
    const acept = (i: number) => ({
      ids_internos: [`REG-${i}`],
      ids_movimientos: [`BCO-${i}`],
      metodo: "ia",
      estado_revision: "aceptado",
    });
    const rech = (i: number) => ({
      ids_internos: [`REG-${i}`],
      ids_movimientos: [`BCO-${i}`],
      metodo: "ia",
      estado_revision: "rechazado",
    });
    const matches = [
      ...Array.from({ length: 8 }, (_, i) => acept(i)),
      ...Array.from({ length: 2 }, (_, i) => rech(i + 100)),
    ];
    const r = resumenAprendizaje([job(matches)]);
    expect(r.positivos).toBe(8);
    expect(r.negativos).toBe(2);
    expect(r.total).toBe(10);
    // maxPorClase=6 → min(8,6)=6 positivos + min(2,6)=2 negativos = 8 activos.
    expect(r.activos).toBe(8);
  });

  it("resumenAprendizaje ignora automáticos y da cero sin decisiones", () => {
    const r = resumenAprendizaje([
      job([
        { ids_internos: ["REG-1"], ids_movimientos: ["BCO-1"], metodo: "exacta", estado_revision: "auto" },
      ]),
    ]);
    expect(r).toEqual({ positivos: 0, negativos: 0, total: 0, activos: 0 });
  });

  it("agrupa 1:N en un solo ejemplo con ambos internos", () => {
    const j: JobHistorico = {
      payload_entrada: {
        registros_internos: [
          { id_interno: "REG-1", fecha: "2026-03-01", monto: 300, contraparte: "ANA" },
          { id_interno: "REG-2", fecha: "2026-03-01", monto: 200, contraparte: "ANA" },
        ],
        movimientos_bancarios: [
          { id_movimiento: "BCO-1", fecha: "2026-03-05", monto: 500, glosa: "DEPOSITO ANA" },
        ],
      },
      resultado: {
        matches: [
          {
            ids_internos: ["REG-1", "REG-2"],
            ids_movimientos: ["BCO-1"],
            metodo: "ia",
            categoria_diferencia: "agrupacion_1aN",
            estado_revision: "aceptado",
          },
        ],
      },
    };
    const ej = construirEjemplos([j]);
    expect(ej).toHaveLength(1);
    expect(ej[0]!.interno).toContain(" + ");
    expect(ej[0]!.categoria).toBe("agrupacion_1aN");
  });
});

// ── Curación: quitar un ejemplo que enseña mal ──────────────────────────────
import { ejemplosActivos } from "@/lib/aprendizaje";

describe("curación de ejemplos", () => {
  const jobCon = (excluido: boolean) => ({
    id: "job-1",
    payload_entrada: {
      registros_internos: [
        { id_interno: "REG-1", fecha: "2026-03-01", monto: 100, contraparte: "ACME" },
      ],
      movimientos_bancarios: [
        { id_movimiento: "MOV-1", fecha: "2026-03-01", monto: 100, glosa: "ACME" },
      ],
    },
    resultado: {
      matches: [
        {
          ids_internos: ["REG-1"],
          ids_movimientos: ["MOV-1"],
          metodo: "ia",
          estado_revision: "aceptado",
          decisiones: [{ accion: "aceptado", timestamp: "2026-03-02T10:00:00Z" }],
          ...(excluido ? { excluido_aprendizaje: true } : {}),
        },
      ],
    },
  });

  it("un ejemplo excluido deja de enseñar", () => {
    expect(construirEjemplos([jobCon(false)])).toHaveLength(1);
    expect(construirEjemplos([jobCon(true)])).toHaveLength(0);
  });

  it("también sale del recuento del pool", () => {
    // Si siguiera contando, la pantalla diria que la IA usa N ejemplos cuando
    // en realidad usa N-1.
    expect(resumenAprendizaje([jobCon(true)]).total).toBe(0);
  });

  it("ejemplosActivos devuelve lo mismo que construirEjemplos, con su origen", () => {
    // Comparten implementacion a proposito: si la pantalla de curacion listara
    // otra cosa, se curarian ejemplos que la IA no lee.
    const jobs = [jobCon(false)];
    const conOrigen = ejemplosActivos(jobs);
    expect(conOrigen.map((x) => x.ejemplo)).toEqual(construirEjemplos(jobs));
    expect(conOrigen[0]!.jobId).toBe("job-1");
    expect(conOrigen[0]!.matchIndex).toBe(0);
  });
});
