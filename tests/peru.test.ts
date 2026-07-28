import { describe, it, expect } from "vitest";
import {
  REGIONES,
  esRegionValida,
  esRucValido,
  esTelefonoValido,
  digitosTelefono,
} from "../src/lib/peru";

describe("REGIONES", () => {
  it("son las 25 del Perú y no hay repetidas", () => {
    expect(REGIONES).toHaveLength(25);
    expect(new Set(REGIONES).size).toBe(25);
  });

  it("incluye el Callao, que no es departamento pero sí región", () => {
    expect(REGIONES).toContain("Callao");
  });

  it("van en orden alfabético, para que se puedan encontrar", () => {
    const ordenadas = [...REGIONES].sort((a, b) =>
      a.localeCompare(b, "es", { sensitivity: "base" }),
    );
    expect([...REGIONES]).toEqual(ordenadas);
  });

  it("esRegionValida rechaza lo que no está en la lista", () => {
    expect(esRegionValida("Lima")).toBe(true);
    expect(esRegionValida("Bogotá")).toBe(false);
    expect(esRegionValida("")).toBe(false);
    expect(esRegionValida("lima")).toBe(false); // el valor viene del <select>
  });
});

describe("esRucValido", () => {
  it("acepta 11 dígitos", () => {
    expect(esRucValido("20123456789")).toBe(true);
    expect(esRucValido("10456789012")).toBe(true);
    expect(esRucValido("  20123456789  ")).toBe(true);
  });

  it("rechaza longitudes distintas y no dígitos", () => {
    expect(esRucValido("2012345678")).toBe(false);
    expect(esRucValido("201234567890")).toBe(false);
    expect(esRucValido("2012345678A")).toBe(false);
    expect(esRucValido("")).toBe(false);
  });

  it("no juzga el prefijo: un RUC raro entra y se corrige después", () => {
    expect(esRucValido("99999999999")).toBe(true);
  });
});

describe("esTelefonoValido", () => {
  it("acepta el móvil peruano y sus formatos habituales", () => {
    expect(esTelefonoValido("987654321")).toBe(true);
    expect(esTelefonoValido("987 654 321")).toBe(true);
    expect(esTelefonoValido("+51 987 654 321")).toBe(true);
    expect(esTelefonoValido("(01) 234-5678")).toBe(true);
  });

  it("acepta fijos cortos de provincia", () => {
    expect(esTelefonoValido("044-123456")).toBe(true);
  });

  it("rechaza lo demasiado corto o demasiado largo", () => {
    expect(esTelefonoValido("12345")).toBe(false);
    expect(esTelefonoValido("1234567890123456")).toBe(false);
    expect(esTelefonoValido("")).toBe(false);
    expect(esTelefonoValido("sin numeros")).toBe(false);
  });

  it("digitosTelefono se queda solo con las cifras", () => {
    expect(digitosTelefono("+51 (987) 654-321")).toBe("51987654321");
  });
});
