import { describe, it, expect } from "vitest";
import {
  filtrarAnual,
  filtrarMes,
  calcularKpis,
  porMes,
  porBanco,
  deduplicarUltimoPorPeriodo,
  type JobReporte,
  type ResumenJob,
} from "@/lib/reportes";

function resumen(p: Partial<ResumenJob>): ResumenJob {
  return {
    total_internos: 0,
    total_bancarios: 0,
    conciliados_exactos: 0,
    conciliados_difusos: 0,
    sugeridos_ia: 0,
    sin_conciliar_internos: 0,
    sin_conciliar_bancarios: 0,
    ...p,
  };
}

const jobs: JobReporte[] = [
  {
    id: "j1",
    anio: 2026,
    mes: 6,
    banco: "BCP",
    cuentaId: "c1",
    numero: "****1",
    resumen: resumen({ total_internos: 100, conciliados_exactos: 80, conciliados_difusos: 10, sin_conciliar_internos: 10 }),
    diferenciaCuadre: 0,
    createdAt: "2026-06-30T10:00:00.000Z",
  },
  {
    id: "j2",
    anio: 2026,
    mes: 7,
    banco: "BBVA",
    cuentaId: "c2",
    numero: "****2",
    resumen: resumen({ total_internos: 50, conciliados_exactos: 40, sugeridos_ia: 5, sin_conciliar_internos: 5 }),
    diferenciaCuadre: 12.5,
    createdAt: "2026-07-31T10:00:00.000Z",
  },
  {
    id: "j3",
    anio: 2025,
    mes: 6,
    banco: "BCP",
    cuentaId: "c1",
    numero: "****1",
    resumen: resumen({ total_internos: 200, conciliados_exactos: 200 }),
    diferenciaCuadre: 0,
    createdAt: "2025-06-30T10:00:00.000Z",
  },
];

describe("deduplicarUltimoPorPeriodo", () => {
  it("conserva solo la conciliación más reciente por período+cuenta", () => {
    const corridas: JobReporte[] = [
      { ...jobs[0]!, id: "run1", createdAt: "2026-06-30T10:00:00.000Z" },
      { ...jobs[0]!, id: "run2", createdAt: "2026-07-01T09:00:00.000Z" }, // más nueva
      { ...jobs[0]!, id: "run3", createdAt: "2026-06-15T08:00:00.000Z" },
    ];
    const dedup = deduplicarUltimoPorPeriodo(corridas);
    expect(dedup).toHaveLength(1);
    expect(dedup[0]!.id).toBe("run2");
    // KPIs no se inflan: 100 registros, no 300.
    expect(calcularKpis(dedup).registros).toBe(100);
  });

  it("no colapsa períodos o cuentas distintas", () => {
    expect(deduplicarUltimoPorPeriodo(jobs)).toHaveLength(3);
  });
});

describe("filtros", () => {
  it("filtrarAnual respeta año, banco y cuenta", () => {
    expect(filtrarAnual(jobs, { anio: 2026, banco: "todos", cuentaId: "todos" })).toHaveLength(2);
    expect(filtrarAnual(jobs, { anio: 2026, banco: "BCP", cuentaId: "todos" })).toHaveLength(1);
    expect(filtrarAnual(jobs, { anio: 2025, banco: "todos", cuentaId: "todos" })).toHaveLength(1);
  });
  it("filtrarMes filtra por mes", () => {
    const anual = filtrarAnual(jobs, { anio: 2026, banco: "todos", cuentaId: "todos" });
    expect(filtrarMes(anual, 7)).toHaveLength(1);
    expect(filtrarMes(anual, "todos")).toHaveLength(2);
  });
});

describe("calcularKpis", () => {
  it("suma registros y calcula automatización y cuadre", () => {
    const anual = filtrarAnual(jobs, { anio: 2026, banco: "todos", cuentaId: "todos" });
    const k = calcularKpis(anual);
    expect(k.conciliaciones).toBe(2);
    expect(k.registros).toBe(150);
    expect(k.autoConciliados).toBe(130); // 80+10 + 40
    expect(k.pctAutomatizacion).toBeCloseTo(86.7, 1);
    expect(k.jobsCuadrados).toBe(1); // solo j1 cuadra
    expect(k.pctCuadre).toBe(50);
    expect(k.sugeridosIa).toBe(5);
  });
});

describe("porMes y porBanco", () => {
  it("porMes devuelve 12 meses con los datos ubicados", () => {
    const anual = filtrarAnual(jobs, { anio: 2026, banco: "todos", cuentaId: "todos" });
    const meses = porMes(anual);
    expect(meses).toHaveLength(12);
    expect(meses[5]!.registros).toBe(100); // junio
    expect(meses[6]!.registros).toBe(50); // julio
    expect(meses[0]!.registros).toBe(0); // enero
  });
  it("porBanco agrupa y ordena por registros", () => {
    const anual = filtrarAnual(jobs, { anio: 2026, banco: "todos", cuentaId: "todos" });
    const filas = porBanco(anual);
    expect(filas).toHaveLength(2);
    expect(filas[0]!.banco).toBe("BCP"); // 100 > 50
    expect(filas[0]!.registros).toBe(100);
  });
});
