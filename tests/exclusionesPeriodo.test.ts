import { describe, it, expect } from "vitest";
import {
  exclusionesDelPeriodo,
  fraseTotal,
  type ConteosPeriodo,
} from "@/lib/exclusionesPeriodo";

/**
 * El caso que originó esto: 236 comprobantes cargados, 233 entran, y los 3 que
 * faltan son facturas en DÓLARES fechadas el 03, el 15 y el 24 de junio. Ni una
 * está fuera del período, y sin embargo la tarjeta decía «el resto es de otros
 * períodos» — a la vez que la línea siguiente decía, correctamente, que eran de
 * otra moneda. Dos explicaciones para las mismas tres filas, y la primera
 * inventada.
 */

function c(p: Partial<ConteosPeriodo> = {}): ConteosPeriodo {
  return {
    registros: 233,
    totalCargados: 236,
    yaCobrados: 0,
    otrasMonedas: 3,
    fueraPeriodo: 0,
    anulados: 0,
    ...p,
  };
}

describe("exclusionesDelPeriodo · el caso de junio", () => {
  it("⚠️ NO dice «otros períodos» cuando lo que sobra es de otra moneda", () => {
    const e = exclusionesDelPeriodo(c(), "PEN");
    expect(e.map((x) => x.clave)).toEqual(["otras_monedas"]);
    expect(e[0]!.texto).toContain("esta cuenta es en PEN");
  });

  it("y la cuenta cierra: 233 + 3 = 236", () => {
    const conteos = c();
    const explicados = exclusionesDelPeriodo(conteos, "PEN").reduce(
      (s, x) => s + x.cantidad,
      0,
    );
    expect(conteos.registros + explicados).toBe(conteos.totalCargados);
  });
});

describe("exclusionesDelPeriodo · cada causa por su nombre", () => {
  it("nombra las cuatro cuando conviven", () => {
    const e = exclusionesDelPeriodo(
      c({
        registros: 100,
        totalCargados: 130,
        fueraPeriodo: 12,
        yaCobrados: 10,
        otrasMonedas: 5,
        anulados: 3,
      }),
      "PEN",
    );
    expect(e.map((x) => x.clave)).toEqual([
      "fuera_periodo",
      "ya_cobrados",
      "otras_monedas",
      "anulados",
    ]);
    expect(e.reduce((s, x) => s + x.cantidad, 0)).toBe(30);
  });

  it("⚠️ si las causas conocidas no suman, lo que falta se dice SIN EXPLICAR", () => {
    // Nunca se reparte entre las causas a mano: una explicación que no cuadra
    // es peor que ninguna. Mismo criterio que la cascada de `origenPartidas`.
    const e = exclusionesDelPeriodo(
      c({ registros: 100, totalCargados: 130, otrasMonedas: 5 }),
      "PEN",
    );
    const resto = e.find((x) => x.clave === "sin_explicar");
    expect(resto?.cantidad).toBe(25);
    expect(resto?.texto).toContain("sin explicar");
  });

  it("con la 0053 sin aplicar no inventa causas: todo cae en «sin explicar»", () => {
    // El despliegue puede ir por delante de la migración. Entonces faltan dos
    // contadores, y lo honesto es decir que no se sabe.
    const sinMigracion: ConteosPeriodo = {
      registros: 220,
      totalCargados: 236,
      yaCobrados: 0,
      otrasMonedas: 3,
    };
    const e = exclusionesDelPeriodo(sinMigracion, "PEN");
    expect(e.find((x) => x.clave === "sin_explicar")?.cantidad).toBe(13);
  });

  it("cuando entran todos no hay nada que explicar", () => {
    expect(exclusionesDelPeriodo(c({ registros: 236, otrasMonedas: 0 }), "PEN")).toEqual([]);
    expect(fraseTotal(c({ registros: 236 }))).toBeNull();
  });

  it("el singular se escribe en singular", () => {
    const e = exclusionesDelPeriodo(
      c({ registros: 235, totalCargados: 236, otrasMonedas: 1 }),
      "USD",
    );
    expect(e[0]!.texto).toContain("1 está en otra moneda");
    expect(e[0]!.texto).toContain("no entra:");
    expect(e[0]!.texto).not.toContain("no entran");
  });

  it("no cuenta exclusiones negativas si el total viene raro", () => {
    // Defensa barata: si `totalCargados` fuera menor que los del período —no
    // debería—, no se pinta una lista con números sin sentido.
    expect(exclusionesDelPeriodo(c({ registros: 300 }), "PEN")).toEqual([]);
  });
});

describe("fraseTotal", () => {
  it("solo aparece cuando hay algo fuera", () => {
    expect(fraseTotal(c())).toBe("Tienes 236 cargados en total:");
  });

  it("y usa el separador de miles de es-PE", () => {
    expect(fraseTotal(c({ registros: 1000, totalCargados: 452605 }))).toContain(
      "452,605",
    );
  });
});
