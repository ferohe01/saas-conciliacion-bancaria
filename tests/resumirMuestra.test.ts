import { describe, it, expect } from "vitest";
import {
  resumirMuestra,
  MAPEO_PLANTILLA,
  type Config,
} from "@/lib/parsing/mapeoComprobantes";

/**
 * La vista previa del mapeo, contada sobre la muestra ENTERA.
 *
 * Antes interpretaba las tres primeras filas y ya. Con un mayor contable real
 * eso produjo la peor pantalla posible: las tres primeras filas del archivo son
 * líneas de un asiento de crédito —sin débito, tipo «Asiento»—, así que la
 * previa decía tres veces «esta fila se omitiría» sobre un archivo en el que
 * 452.454 de 452.605 filas se cargan perfectamente.
 */

/** El formato con el que se carga el mayor: importe en `Débito`, tipo declarado. */
const CONFIG_MAYOR: Config = {
  mapeo: {
    fecha: "Fecha",
    monto: "Débito",
    serie_numero: "WIN - Nro. Documento",
  },
  tipoFijo: "cobranza",
};

/** Tres líneas de asiento (crédito) y luego cobros de verdad. */
function mayor(cobros: number): Record<string, unknown>[] {
  const filas: Record<string, unknown>[] = [];
  for (let i = 0; i < 3; i++) {
    filas.push({
      "Fecha": "2026-05-26",
      "WIN - Nro. Documento": `SR11-0291${i}`,
      "Débito": "",
      "Crédito": "69.00",
    });
  }
  for (let i = 0; i < cobros; i++) {
    filas.push({
      "Fecha": "2026-06-14",
      "WIN - Nro. Documento": `SR11-0041${8000 + i}`,
      "Débito": "73.58",
      "Crédito": "",
    });
  }
  return filas;
}

describe("resumirMuestra", () => {
  it("los ejemplos son filas que SÍ entran, aunque el archivo empiece por otras", () => {
    const r = resumirMuestra(mayor(20), CONFIG_MAYOR);
    expect(r.ejemplos).toHaveLength(3);
    // Ninguna de las tres primeras del archivo: todas son de crédito.
    for (const e of r.ejemplos) {
      expect(e.fecha).toBe("2026-06-14");
      expect(e.monto).toBe(73.58);
    }
  });

  it("cuenta lo que se queda fuera y por qué", () => {
    const r = resumirMuestra(mayor(20), CONFIG_MAYOR);
    expect(r.total).toBe(23);
    expect(r.entran).toBe(20);
    expect(r.motivos).toEqual([{ falta: ["el importe"], filas: 3 }]);
  });

  it("agrupa los motivos y los ordena por cuántas filas afectan", () => {
    const filas = [
      ...mayor(5),
      { "Fecha": "", "WIN - Nro. Documento": "X", "Débito": "10.00" },
      { "Fecha": "", "WIN - Nro. Documento": "Y", "Débito": "" },
    ];
    const r = resumirMuestra(filas, CONFIG_MAYOR);
    expect(r.motivos[0]).toEqual({ falta: ["el importe"], filas: 3 });
    expect(r.motivos).toContainEqual({ falta: ["la fecha"], filas: 1 });
    expect(r.motivos).toContainEqual({
      falta: ["la fecha", "el importe"],
      filas: 1,
    });
  });

  it("sin nada que omitir lo dice igual: entran todas", () => {
    // Un recuento que solo aparece con problemas deja sin saber si el silencio
    // significa "correcto" o "no se miró".
    const r = resumirMuestra(mayor(0).slice(3), CONFIG_MAYOR);
    expect(r.total).toBe(0);
    expect(r.motivos).toEqual([]);
  });

  it("cuando NO entra ninguna, se ve: es la alarma de verdad", () => {
    // El mapeo apunta al importe equivocado (la columna de crédito está vacía
    // en los cobros y llena en los asientos, pero aquí se mapea `Crédito` y las
    // filas de cobro no lo traen).
    const malo: Config = {
      mapeo: { fecha: "Fecha", monto: "Crédito" },
      tipoFijo: "cobranza",
    };
    const r = resumirMuestra(mayor(10).slice(3), malo);
    expect(r.entran).toBe(0);
    expect(r.ejemplos).toEqual([]);
    expect(r.motivos[0]!.falta).toEqual(["el importe"]);
  });

  it("la plantilla de siempre sigue interpretándose igual", () => {
    const filas = [
      {
        fecha: "01/06/2026",
        monto: "118.00",
        tipo: "cobranza",
        referencia: "F001-1",
        moneda: "PEN",
      },
    ];
    const r = resumirMuestra(filas, { mapeo: MAPEO_PLANTILLA, tipoFijo: null });
    expect(r.entran).toBe(1);
    expect(r.ejemplos[0]!.serie_numero).toBe("F001-1");
    expect(r.ejemplos[0]!.fecha).toBe("2026-06-01");
  });

  it("respeta el tope de ejemplos", () => {
    expect(resumirMuestra(mayor(50), CONFIG_MAYOR, 1).ejemplos).toHaveLength(1);
  });
});
