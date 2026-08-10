import { describe, it, expect } from "vitest";
import {
  normalizarMoneda,
  aplicarMapeo,
  MONEDA_DEFECTO,
  ConfigMapeoGuardado,
} from "../src/lib/parsing/mapeoComprobantes";
import { agingPorMoneda } from "../src/lib/agingResumen";
import { detectarColumnasComprobante } from "../src/lib/parsing/deteccionComprobantes";

describe("normalizarMoneda", () => {
  it("entiende cómo la escribe la gente", () => {
    expect(normalizarMoneda("PEN")).toBe("PEN");
    expect(normalizarMoneda("soles")).toBe("PEN");
    expect(normalizarMoneda("S/")).toBe("PEN");
    expect(normalizarMoneda("USD")).toBe("USD");
    expect(normalizarMoneda("Dólares")).toBe("USD");
    expect(normalizarMoneda("us$")).toBe("USD");
  });

  it("acepta un ISO que no esté en la lista", () => {
    // Rechazar "CLP" por no haberlo previsto sería absurdo: la base acepta
    // cualquier trío de letras.
    expect(normalizarMoneda("clp")).toBe("CLP");
  });

  it("⚠️ NO adivina el símbolo $: en Perú se usa para las dos", () => {
    // Elegir por el usuario justo donde el error no se ve es lo que esto evita.
    expect(normalizarMoneda("$")).toBeNull();
  });

  it("lo que no reconoce lo dice, en vez de inventar", () => {
    expect(normalizarMoneda("")).toBeNull();
    expect(normalizarMoneda("xyzw")).toBeNull();
    expect(normalizarMoneda(null)).toBeNull();
  });
});

describe("la moneda al aplicar el mapeo", () => {
  const base = { mapeo: { fecha: "f", monto: "m", tipo: "t" } };
  const fila = { f: "15/06/2026", m: "200", t: "venta", cur: "USD" };

  it("sin columna ni declaración, soles: el caso normal no declara nada", () => {
    expect(aplicarMapeo(fila, base)?.moneda).toBe(MONEDA_DEFECTO);
    expect(MONEDA_DEFECTO).toBe("PEN");
  });

  it("la lee de la columna cuando está mapeada", () => {
    const c = { mapeo: { ...base.mapeo, moneda: "cur" } };
    expect(aplicarMapeo(fila, c)?.moneda).toBe("USD");
  });

  it("⚠️ la declarada MANDA sobre la columna, igual que el tipo", () => {
    const c = { mapeo: { ...base.mapeo, moneda: "cur" }, monedaFija: "PEN" };
    expect(aplicarMapeo(fila, c)?.moneda).toBe("PEN");
  });

  it("una moneda ilegible cae al defecto, no rompe la fila", () => {
    const c = { mapeo: { ...base.mapeo, moneda: "cur" } };
    expect(aplicarMapeo({ ...fila, cur: "???" }, c)?.moneda).toBe("PEN");
  });
});

describe("detección de la columna de moneda", () => {
  const filas = [
    { FECHA: "29/07/2026", MONTO: "200", MONEDA: "USD" },
    { FECHA: "02/07/2026", MONTO: "450", MONEDA: "USD" },
  ];

  it("la encuentra en el archivo real de cobros escolares", () => {
    const m = detectarColumnasComprobante(Object.keys(filas[0]!), filas);
    expect(m.moneda).toBe("MONEDA");
  });

  it("no confunde el importe con la moneda", () => {
    const m = detectarColumnasComprobante(Object.keys(filas[0]!), filas);
    expect(m.monto).toBe("MONTO");
  });
});

describe("⚠️ el aging NO suma monedas distintas", () => {
  const filas = [
    { contraparte: "Cliente A", ruc: null, tramo: "d1_30", moneda: "PEN", total: 1000, documentos: 2 },
    { contraparte: "Cliente B", ruc: null, tramo: "d1_30", moneda: "USD", total: 500, documentos: 1 },
    { contraparte: "Cliente A", ruc: null, tramo: "por_vencer", moneda: "PEN", total: 300, documentos: 1 },
  ];

  it("devuelve un bloque por moneda", () => {
    const b = agingPorMoneda(filas);
    expect(b.map((x) => x.moneda).sort()).toEqual(["PEN", "USD"]);
  });

  it("cada total es de SU moneda: 1.300 y 500, nunca 1.800", () => {
    const b = agingPorMoneda(filas);
    const pen = b.find((x) => x.moneda === "PEN")!;
    const usd = b.find((x) => x.moneda === "USD")!;
    expect(pen.aging.total).toBe(1300);
    expect(usd.aging.total).toBe(500);
    expect(b.reduce((n, x) => n + x.aging.total, 0)).toBe(1800);
  });

  it("el vencido tampoco se mezcla", () => {
    const b = agingPorMoneda(filas);
    expect(b.find((x) => x.moneda === "PEN")!.aging.vencido).toBe(1000);
    expect(b.find((x) => x.moneda === "USD")!.aging.vencido).toBe(500);
  });

  it("primero la moneda con más saldo: por ahí se empieza", () => {
    expect(agingPorMoneda(filas)[0]!.moneda).toBe("PEN");
  });

  it("una sola moneda da un solo bloque, como siempre", () => {
    const b = agingPorMoneda(filas.filter((f) => f.moneda === "PEN"));
    expect(b).toHaveLength(1);
    expect(b[0]!.aging.total).toBe(1300);
  });

  it("filas sin moneda (datos viejos) se cuentan como soles", () => {
    const b = agingPorMoneda([{ ...filas[0]!, moneda: undefined }]);
    expect(b[0]!.moneda).toBe("PEN");
  });

  it("sin filas no hay bloques: no se inventa un cero en soles", () => {
    expect(agingPorMoneda([])).toEqual([]);
  });
});

describe("monedaFija en el mapeo guardado", () => {
  it("acepta un código de tres letras", () => {
    const r = ConfigMapeoGuardado.safeParse({
      mapeo: { fecha: "f" },
      monedaFija: "USD",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza lo que no lo sea: la base tiene el mismo check", () => {
    for (const v of ["dolares", "us$", "U", "USDD", ""]) {
      const r = ConfigMapeoGuardado.safeParse({ mapeo: {}, monedaFija: v });
      expect(r.success, v).toBe(false);
    }
  });
});
