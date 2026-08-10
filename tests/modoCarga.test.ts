import { describe, it, expect } from "vitest";
import { modoCarga, permiteArchivoPropio } from "../src/lib/modoCarga";
import { columnasFaltantes, esPlantilla } from "../src/lib/parsing/mapeoComprobantes";

describe("modoCarga", () => {
  it("por defecto exige la plantilla: es el caso normal de una PyME", () => {
    expect(modoCarga(null)).toBe("plantilla");
    expect(modoCarga(undefined)).toBe("plantilla");
    expect(modoCarga("plantilla")).toBe("plantilla");
  });

  it("⚠️ un valor desconocido NO abre el modo libre", () => {
    // Mismo criterio que `plan`: ante un dato que no se entiende, el camino
    // guiado. Degradar hacia lo abierto sería conceder por accidente.
    for (const v of ["", "otro", 42, {}, true, "ARCHIVO_PROPIO"]) {
      expect(modoCarga(v), String(v)).toBe("plantilla");
      expect(permiteArchivoPropio(v)).toBe(false);
    }
  });

  it("solo el valor exacto habilita subir el archivo propio", () => {
    expect(permiteArchivoPropio("archivo_propio")).toBe(true);
  });
});

describe("columnasFaltantes — el rechazo dice QUÉ falta", () => {
  // "Este archivo no sirve" deja al usuario comparando dos ficheros columna por
  // columna. Nombrar lo que falta se arregla en diez segundos.
  it("nombra las columnas ausentes", () => {
    expect(columnasFaltantes(["fecha", "referencia"])).toEqual([
      "monto",
      "tipo",
    ]);
  });

  it("la plantilla completa no tiene faltantes", () => {
    expect(columnasFaltantes(["fecha", "monto", "tipo", "referencia"])).toEqual(
      [],
    );
    expect(esPlantilla(["fecha", "monto", "tipo"])).toBe(true);
  });

  it("tolera mayúsculas y espacios: el usuario no debe pelear con eso", () => {
    expect(columnasFaltantes([" FECHA ", "Monto", "TIPO"])).toEqual([]);
  });

  it("las columnas de más no estorban", () => {
    // Un archivo con una columna extra sigue siendo la plantilla; rechazarlo
    // sería rigor sin motivo.
    expect(columnasFaltantes(["fecha", "monto", "tipo", "sucursal"])).toEqual([]);
  });

  it("un archivo ajeno las echa en falta todas", () => {
    expect(columnasFaltantes(["ID DE PAGO", "NOMBRE COMPLETO", "MONEDA"]))
      .toEqual(["fecha", "monto", "tipo"]);
  });

  it("un archivo sin cabeceras no se da por bueno", () => {
    expect(esPlantilla([])).toBe(false);
  });
});
