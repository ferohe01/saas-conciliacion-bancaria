import { describe, it, expect } from "vitest";
import {
  filtrarAnual,
  filtrarMes,
  calcularKpis,
  porMes,
  porBanco,
  deduplicarUltimoPorPeriodo,
  enFocoDelFiltro,
  contarCategorias,
  porTipoDiferencia,
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
    periodoDesde: "2026-06-01",
    periodoHasta: "2026-06-30",
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
    periodoDesde: "2026-07-01",
    periodoHasta: "2026-07-31",
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
    periodoDesde: "2025-06-01",
    periodoHasta: "2025-06-30",
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

  // Regresión: la clave era `cuenta|año|mes`, así que tres cortes del mismo
  // julio colapsaban en uno solo y los totales del mes salían falsos.
  it("conserva los cortes parciales de un mismo mes", () => {
    const base = jobs[1]!;
    const cortes: JobReporte[] = [
      {
        ...base,
        id: "corte-1",
        periodoDesde: "2026-07-01",
        periodoHasta: "2026-07-10",
        resumen: resumen({ total_internos: 20, conciliados_exactos: 20 }),
        createdAt: "2026-07-11T10:00:00.000Z",
      },
      {
        ...base,
        id: "corte-2",
        periodoDesde: "2026-07-11",
        periodoHasta: "2026-07-20",
        resumen: resumen({ total_internos: 30, conciliados_exactos: 30 }),
        createdAt: "2026-07-21T10:00:00.000Z",
      },
      {
        ...base,
        id: "corte-3",
        periodoDesde: "2026-07-21",
        periodoHasta: "2026-07-31",
        resumen: resumen({ total_internos: 50, conciliados_exactos: 50 }),
        createdAt: "2026-08-01T10:00:00.000Z",
      },
    ];
    const dedup = deduplicarUltimoPorPeriodo(cortes);
    expect(dedup).toHaveLength(3);
    // Los tres cortes suman el mes entero: 100, no solo los 50 del último.
    expect(calcularKpis(dedup).registros).toBe(100);
  });

  it("sigue colapsando reprocesos del mismo corte", () => {
    const base = jobs[1]!;
    const corte = { ...base, periodoDesde: "2026-07-01", periodoHasta: "2026-07-10" };
    const dedup = deduplicarUltimoPorPeriodo([
      { ...corte, id: "v1", createdAt: "2026-07-11T10:00:00.000Z" },
      { ...corte, id: "v2", createdAt: "2026-07-12T10:00:00.000Z" }, // reproceso
    ]);
    expect(dedup).toHaveLength(1);
    expect(dedup[0]!.id).toBe("v2");
  });

  it("no confunde el mismo rango en cuentas distintas", () => {
    const base = jobs[1]!;
    const dedup = deduplicarUltimoPorPeriodo([
      { ...base, id: "a", cuentaId: "c1" },
      { ...base, id: "b", cuentaId: "c2" },
    ]);
    expect(dedup).toHaveLength(2);
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

describe("tipos de diferencia", () => {
  it("contarCategorias cuenta por categoria; null→sin_diferencia/otros; ignora rechazados", () => {
    const matches = [
      { categoria_diferencia: "comision_bancaria", diferencia_monto: -5 },
      { categoria_diferencia: "comision_bancaria", diferencia_monto: -3 },
      { categoria_diferencia: null, diferencia_monto: 0 }, // sin_diferencia
      { categoria_diferencia: null, diferencia_monto: 40 }, // otros
      {
        categoria_diferencia: "diferencia_moneda",
        diferencia_monto: 200,
        estado_revision: "rechazado", // ignorado
      },
    ];
    const c = contarCategorias(matches);
    expect(c.comision_bancaria).toBe(2);
    expect(c.sin_diferencia).toBe(1);
    expect(c.otros).toBe(1);
    expect(c.diferencia_moneda).toBeUndefined();
  });

  it("porTipoDiferencia suma sobre jobs, etiqueta y ordena desc", () => {
    const j1 = { ...jobs[0]!, categorias: { comision_bancaria: 2, sin_diferencia: 1 } };
    const j2 = { ...jobs[1]!, categorias: { comision_bancaria: 3 } };
    const t = porTipoDiferencia([j1, j2]);
    expect(t[0]!.tipo).toBe("comision_bancaria");
    expect(t[0]!.valor).toBe(5);
    expect(t[0]!.label).toBe("Comisión bancaria");
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

describe("enFocoDelFiltro", () => {
  const bancos = new Map([
    ["c1", "BCP"],
    ["c2", "BBVA"],
  ]);
  const filas = [
    { id: "a", periodo_desde: "2026-07-01", cuenta_id: "c1" },
    { id: "b", periodo_desde: "2026-07-15", cuenta_id: "c2" },
    { id: "c", periodo_desde: "2026-08-01", cuenta_id: "c1" },
    { id: "d", periodo_desde: "2025-07-01", cuenta_id: "c1" },
  ];
  const todo = { anio: 2026, mes: "todos", banco: "todos", cuentaId: "todos" } as const;

  it("acota por año", () => {
    expect(enFocoDelFiltro(filas, todo, bancos).map((f) => f.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("acota por mes", () => {
    const r = enFocoDelFiltro(filas, { ...todo, mes: 7 }, bancos);
    expect(r.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("acota por cuenta y por banco", () => {
    expect(
      enFocoDelFiltro(filas, { ...todo, cuentaId: "c2" }, bancos).map((f) => f.id),
    ).toEqual(["b"]);
    expect(
      enFocoDelFiltro(filas, { ...todo, banco: "BBVA" }, bancos).map((f) => f.id),
    ).toEqual(["b"]);
  });

  // El bug reportado: al elegir una cuenta sin conciliaciones, el panel seguía
  // anunciando las sugerencias pendientes de otra cuenta.
  it("una cuenta sin conciliaciones en el período no arrastra nada", () => {
    const r = enFocoDelFiltro(
      filas,
      { anio: 2026, mes: 8, banco: "todos", cuentaId: "c2" },
      bancos,
    );
    expect(r).toHaveLength(0);
  });
});
