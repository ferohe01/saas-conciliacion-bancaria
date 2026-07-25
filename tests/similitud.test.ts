import { describe, it, expect } from "vitest";
import { palabras, palabrasComunes } from "@/lib/matching/similitud";

describe("palabras", () => {
  it("normaliza acentos, mayúsculas y descarta términos bancarios/cortos", () => {
    expect(palabras("DEPÓSITO X. GUTIÉRREZ")).toEqual(["GUTIERREZ"]);
    expect(palabras("Ferretería Lima Norte EIRL")).toEqual([
      "FERRETERIA",
      "LIMA",
      "NORTE",
    ]);
    expect(palabras("")).toEqual([]);
    expect(palabras(null)).toEqual([]);
  });
});

describe("palabrasComunes", () => {
  it("detecta identidad compartida real", () => {
    expect(
      palabrasComunes("Ferretería Lima Norte EIRL", "TRANSF CCE FERRETERIA LIMA"),
    ).toEqual(expect.arrayContaining(["FERRETERIA", "LIMA"]));
  });

  it("rechaza los falsos positivos del reporte (nombres sin relación)", () => {
    // Sofía Gamarra Mendoza ↔ DEPÓSITO X. GUTIÉRREZ
    expect(
      palabrasComunes("Sofía Gamarra Mendoza", "DEPÓSITO X. GUTIÉRREZ"),
    ).toHaveLength(0);
    // Felipe López García ↔ TRANSFERENCIA GAMARRA, BRUNO / CUOTA JULIO
    expect(
      palabrasComunes(
        "Felipe López García",
        "TRANSFERENCIA GAMARRA, BRUNO / CUOTA JULIO",
      ),
    ).toHaveLength(0);
    // Carolina Morales Ramírez ↔ TRANSFERENCIA RECIBIDA CENTRO DE IDIOMAS NORTE
    expect(
      palabrasComunes(
        "Carolina Morales Ramírez",
        "TRANSFERENCIA RECIBIDA CENTRO DE IDIOMAS NORTE",
      ),
    ).toHaveLength(0);
  });

  it("sí matchea cuando comparten apellido", () => {
    expect(
      palabrasComunes("Nicolás Gutiérrez Cabrera", "ABONO DE GUTIERREZ NICOLAS"),
    ).toEqual(expect.arrayContaining(["GUTIERREZ", "NICOLAS"]));
  });
});
