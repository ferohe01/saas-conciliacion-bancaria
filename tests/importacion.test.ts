import { describe, it, expect } from "vitest";
import {
  claveComprobante,
  dedupEnArchivo,
  separarExistentes,
  mensajeImportacion,
} from "@/lib/importacion";

const fila = (tipo: "cobranza" | "pago", referencia: string | null) => ({
  tipo,
  referencia,
});

describe("claveComprobante", () => {
  it("normaliza igual que el índice de la base (trim + mayúsculas)", () => {
    expect(claveComprobante(fila("cobranza", " f001-101 "))).toBe(
      claveComprobante(fila("cobranza", "F001-101")),
    );
  });

  it("el tipo forma parte de la identidad", () => {
    // Una cobranza y un pago pueden compartir numeración: son documentos de
    // emisores distintos.
    expect(claveComprobante(fila("cobranza", "F001-1"))).not.toBe(
      claveComprobante(fila("pago", "F001-1")),
    );
  });

  it("sin serie no hay clave", () => {
    expect(claveComprobante(fila("cobranza", null))).toBeNull();
    expect(claveComprobante(fila("cobranza", "   "))).toBeNull();
  });
});

describe("dedupEnArchivo", () => {
  it("quita las repetidas dentro del archivo y conserva la primera", () => {
    const r = dedupEnArchivo([
      { ...fila("cobranza", "F001-1"), n: 1 },
      { ...fila("cobranza", "F001-2"), n: 2 },
      { ...fila("cobranza", "f001-1"), n: 3 },
    ]);
    expect(r.repetidas).toBe(1);
    expect(r.filas.map((f) => f.n)).toEqual([1, 2]);
  });

  it("las filas sin serie nunca se consideran repetidas entre sí", () => {
    // Dos ventas al contado del mismo importe son dos ventas, no un error.
    const r = dedupEnArchivo([fila("cobranza", null), fila("cobranza", null)]);
    expect(r.repetidas).toBe(0);
    expect(r.filas).toHaveLength(2);
  });

  it("no toca nada cuando no hay repetidos", () => {
    const r = dedupEnArchivo([fila("cobranza", "A-1"), fila("pago", "A-1")]);
    expect(r.repetidas).toBe(0);
    expect(r.filas).toHaveLength(2);
  });
});

describe("separarExistentes", () => {
  it("omite lo que ya está en la base", () => {
    const r = separarExistentes(
      [fila("cobranza", "F001-1"), fila("cobranza", "F001-2")],
      ["cobranza|F001-1"],
    );
    expect(r.yaExistian).toBe(1);
    expect(r.nuevas).toHaveLength(1);
    expect(r.nuevas[0]!.referencia).toBe("F001-2");
  });

  it("una serie existente de otro tipo no bloquea la nueva", () => {
    const r = separarExistentes([fila("pago", "F001-1")], ["cobranza|F001-1"]);
    expect(r.yaExistian).toBe(0);
    expect(r.nuevas).toHaveLength(1);
  });

  it("lo que no tiene serie entra siempre", () => {
    const r = separarExistentes([fila("cobranza", null)], ["cobranza|F001-1"]);
    expect(r.yaExistian).toBe(0);
    expect(r.nuevas).toHaveLength(1);
  });

  it("compara normalizado, no literal", () => {
    const r = separarExistentes([fila("cobranza", " f001-1 ")], ["cobranza|F001-1"]);
    expect(r.yaExistian).toBe(1);
  });
});

describe("mensajeImportacion", () => {
  const base = {
    insertados: 0,
    yaExistian: 0,
    repetidasEnArchivo: 0,
    invalidas: 0,
  };

  it("explica el caso que provocó el problema: no se agregó nada porque ya estaba todo", () => {
    // Sin esta frase, "0 importados" parece un fallo y lleva a reintentar —que
    // es exactamente como se acaba con la tabla duplicada.
    const m = mensajeImportacion({ ...base, yaExistian: 50 });
    expect(m).toContain("ya estaban cargados");
    expect(m).not.toContain("undefined");
  });

  it("cuenta lo agregado y lo omitido", () => {
    const m = mensajeImportacion({ ...base, insertados: 30, yaExistian: 20 });
    expect(m).toContain("30 comprobantes");
    expect(m).toContain("20 ya estaban");
  });

  it("usa singular cuando toca", () => {
    const m = mensajeImportacion({ ...base, insertados: 1, yaExistian: 1 });
    expect(m).toContain("agregó 1 comprobante");
    expect(m).toContain("1 ya estaba");
  });

  it("menciona las repetidas del archivo y las inválidas", () => {
    const m = mensajeImportacion({
      ...base,
      insertados: 5,
      repetidasEnArchivo: 2,
      invalidas: 3,
    });
    expect(m).toContain("2 filas venían repetidas");
    expect(m).toContain("3 filas se descartaron");
  });

  it("no inventa frases cuando todo fue limpio", () => {
    const m = mensajeImportacion({ ...base, insertados: 10 });
    expect(m).toBe("Se agregaron 10 comprobantes.");
  });
});

// ── referencia_externa: documento vs. referencia de emparejamiento (0020) ────
describe("referencia_externa no interfiere con la deduplicación", () => {
  it("la clave de duplicado sigue siendo el número de documento", () => {
    // Dos recibos DISTINTOS pagados en la misma operacion bancaria comparten
    // referencia_externa pero son documentos distintos: deben entrar los dos.
    const r = dedupEnArchivo([
      { tipo: "cobranza", referencia: "SR11-001", referencia_externa: "EFECTIVO900" },
      { tipo: "cobranza", referencia: "SR11-002", referencia_externa: "EFECTIVO900" },
    ]);
    expect(r.repetidas).toBe(0);
    expect(r.filas).toHaveLength(2);
  });

  it("el mismo documento sí se sigue omitiendo", () => {
    const r = dedupEnArchivo([
      { tipo: "cobranza", referencia: "SR11-001", referencia_externa: "EFECTIVO900" },
      { tipo: "cobranza", referencia: "SR11-001", referencia_externa: "EFECTIVO901" },
    ]);
    expect(r.repetidas).toBe(1);
  });
});
