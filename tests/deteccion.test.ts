import { describe, it, expect } from "vitest";
import { detectarColumnas } from "@/lib/parsing/deteccion";
import { calcularResumen } from "@/lib/parsing/resumen";
import { validarCoherencia } from "@/lib/parsing/coherencia";
import { rangoDeMes } from "@/lib/periodo";

const filasBanco = [
  {
    "Fecha Mov.": "15/06/2026",
    Glosa: "TRANSF CCE FERRETERIA LIMA",
    Cargo: "",
    Abono: "4,945.00",
    "Nro Operación": "OP-778812",
  },
  {
    "Fecha Mov.": "16/06/2026",
    Glosa: "PAGO SERVICIOS",
    Cargo: "120.00",
    Abono: "",
    "Nro Operación": "OP-778999",
  },
];

describe("detectarColumnas", () => {
  it("detecta fecha, monto y referencia por nombre y contenido", () => {
    const headers = Object.keys(filasBanco[0]!);
    const mapeo = detectarColumnas(headers, filasBanco);
    expect(mapeo.fecha).toBe("Fecha Mov.");
    expect(mapeo.referencia).toBe("Nro Operación");
    // El monto debe caer en una columna numérica (Cargo o Abono), no en fecha.
    expect(["Cargo", "Abono"]).toContain(mapeo.monto);
  });

  it("no asigna el mismo header a dos campos", () => {
    const headers = Object.keys(filasBanco[0]!);
    const mapeo = detectarColumnas(headers, filasBanco);
    const usados = Object.values(mapeo);
    expect(new Set(usados).size).toBe(usados.length);
  });
});

describe("calcularResumen", () => {
  it("cuenta registros, suma montos y detecta rango de fechas", () => {
    const mapeo = { fecha: "Fecha Mov.", monto: "Abono" };
    const r = calcularResumen(filasBanco, mapeo);
    expect(r.registros).toBe(2);
    expect(r.sumaTotal).toBeCloseTo(4945);
    expect(r.fechaMin).toBe("2026-06-15");
    expect(r.fechaMax).toBe("2026-06-16");
  });
});

describe("validarCoherencia", () => {
  it("no advierte cuando las fechas caen en el período", () => {
    const junio = rangoDeMes(2026, 6);
    const res = validarCoherencia(["2026-06-15", "2026-06-20"], junio);
    expect(res.advertir).toBe(false);
    expect(res.mensaje).toBeNull();
  });

  it("advierte cuando la mayoría cae fuera del período", () => {
    const junio = rangoDeMes(2026, 6);
    const fechas = ["2026-05-02", "2026-05-10", "2026-05-15", "2026-06-01"];
    const res = validarCoherencia(fechas, junio);
    expect(res.advertir).toBe(true);
    expect(res.mensaje).toMatch(/Mayo 2026/);
  });
});
