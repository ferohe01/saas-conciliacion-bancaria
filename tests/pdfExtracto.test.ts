import { describe, it, expect } from "vitest";
import { LecturaPdf, aCsv, contarPaginas, normalizar, verificar } from "@/lib/pdfExtracto";
import { detectarColumnasConDudas } from "@/lib/parsing/deteccion";

const lectura = LecturaPdf.parse({
  saldo_inicial: "7.217.897,68",
  saldo_final: 7217947.68,
  movimientos: [
    { fecha: "2026-06-01", descripcion: "DEPOSITO EFECTIVO", referencia: "SR11-001", abono: "100,00", saldo: 7217997.68 },
    { fecha: "2026-06-02", descripcion: "COMISION, MANTENIMIENTO", referencia: null, cargo: 50, saldo: 7217947.68 },
    { fecha: "2026-06-02", descripcion: "SALDO ARRASTRADO", cargo: null, abono: null, saldo: 7217947.68 },
  ],
});

describe("LecturaPdf", () => {
  it("interpreta importes con formato peruano y anglosajón", () => {
    expect(lectura.saldo_inicial).toBe(7217897.68);
    expect(lectura.movimientos[0]!.abono).toBe(100);
    expect(LecturaPdf.parse({ movimientos: [{ fecha: "2026-06-01", cargo: "1,234.56" }] }).movimientos[0]!.cargo).toBe(1234.56);
  });

  it("rechaza una fecha que no está en ISO", () => {
    expect(LecturaPdf.safeParse({ movimientos: [{ fecha: "01/06/2026", abono: 1 }] }).success).toBe(false);
  });
});

describe("normalizar", () => {
  it("abono positivo, cargo negativo, y descarta las filas sin importe", () => {
    const f = normalizar(lectura);
    expect(f.map((x) => x.monto)).toEqual([100, -50]);
  });

  it("el signo lo pone el código aunque el modelo mande un cargo negativo", () => {
    const f = normalizar(LecturaPdf.parse({ movimientos: [{ fecha: "2026-06-01", cargo: -30 }] }));
    expect(f[0]!.monto).toBe(-30);
  });
});

describe("verificar", () => {
  it("cuadra cuando saldo inicial + movimientos = saldo final", () => {
    const v = verificar(normalizar(lectura), lectura.saldo_inicial, lectura.saldo_final);
    expect(v.cuadra).toBe(true);
    expect(v.diferencia).toBe(0);
    expect(v.saltosDeSaldo).toBe(0);
  });

  it("detecta un movimiento que el modelo se saltó", () => {
    const filas = normalizar(lectura).slice(0, 1); // falta la comisión
    const v = verificar(filas, lectura.saldo_inicial, lectura.saldo_final);
    expect(v.cuadra).toBe(false);
    expect(v.diferencia).toBe(50);
  });

  it("detecta un saldo de fila que no sigue a la anterior", () => {
    const filas = normalizar(lectura);
    filas[1] = { ...filas[1]!, monto: -40 };
    expect(verificar(filas, null, null).saltosDeSaldo).toBe(1);
  });

  it("sin saldos del período no afirma nada", () => {
    expect(verificar(normalizar(lectura), null, 100).cuadra).toBeNull();
  });
});

describe("aCsv", () => {
  it("escapa comas y deja columnas que el wizard reconoce solo", () => {
    const csv = aCsv(normalizar(lectura));
    expect(csv.split("\n")[0]).toBe("Fecha,Descripcion,Referencia,Monto,Saldo");
    expect(csv).toContain('"COMISION, MANTENIMIENTO"');
    const headers = csv.split("\n")[0]!.split(",");
    const { mapeo } = detectarColumnasConDudas(headers, [
      { Fecha: "2026-06-01", Descripcion: "DEPOSITO", Referencia: "SR11-001", Monto: "100.00", Saldo: "1.00" },
    ]);
    expect(mapeo.fecha).toBe("Fecha");
    expect(mapeo.monto).toBe("Monto");
    expect(mapeo.referencia).toBe("Referencia");
  });
});

describe("contarPaginas", () => {
  it("cuenta los objetos de página y no el árbol de páginas", () => {
    const pdf = new TextEncoder().encode("1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] >> 2 0 obj << /Type /Page >> 3 0 obj << /Type/Page >>");
    expect(contarPaginas(pdf)).toBe(2);
  });
});
