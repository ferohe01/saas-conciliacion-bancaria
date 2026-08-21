import { describe, it, expect } from "vitest";
import {
  cascadaPartidas,
  leerOrigen,
  resumenDiferencia,
  type OrigenPartidas,
} from "@/lib/origenPartidas";

/**
 * El caso real de WIN, que es el que originó todo esto:
 *
 *     452.605 filas del mayor
 *       − 296  no se cargaron (el reparto por causa es de ejemplo: lo que fija
 *              el test es que la cuenta cierre)
 *     452.309 comprobantes
 *       − 132  fuera del período (26/05, y se concilió junio)
 *     452.177 registros internos
 *       − 447.795 conciliados
 *       =   4.382 sin conciliar
 */
const WIN: OrigenPartidas = {
  alcance: "cargas",
  cargas: 1,
  archivoFilas: 452_605,
  archivoRepetidas: 8,
  archivoInvalidas: 288,
  archivoExistentes: 0,
  archivoInsertados: 452_309,
  cargados: 452_309,
  fueraPeriodo: 132,
  yaCobrados: 0,
  otraMoneda: 0,
  internos: 452_177,
  arrastrados: 0,
};
const MOTOR = { internos: 452_177, conciliados: 447_795 };

const suma = (lineas: { cantidad: number; tipo: string }[]) =>
  lineas.filter((l) => l.tipo === "resta").reduce((a, l) => a + l.cantidad, 0);

describe("cascadaPartidas", () => {
  it("la cuenta CIERRA en cada bloque", () => {
    // Es la única propiedad que de verdad importa: si no cuadra, la
    // explicación hace más daño que el número sin explicar.
    for (const b of cascadaPartidas(WIN, MOTOR)) {
      const inicio = b.lineas.find((l) => l.tipo === "inicio")!;
      const total = b.lineas.find((l) => l.tipo === "total")!;
      expect(inicio.cantidad - suma(b.lineas), b.clave).toBe(total.cantidad);
    }
  });

  it("cuenta los tres tramos del caso real", () => {
    const b = cascadaPartidas(WIN, MOTOR);
    expect(b.map((x) => x.clave)).toEqual(["archivo", "seleccion", "motor"]);
    expect(b[0]!.lineas.at(-1)!.cantidad).toBe(452_309);
    expect(b[1]!.lineas.at(-1)!.cantidad).toBe(452_177);
    expect(b[2]!.lineas.at(-1)!.cantidad).toBe(4_382);
  });

  it("toda resta lleva su explicación", () => {
    for (const b of cascadaPartidas(WIN, MOTOR)) {
      for (const l of b.lineas) expect(l.explicacion.length).toBeGreaterThan(20);
    }
  });

  it("lo que no se puede atribuir se DICE, no se reparte", () => {
    // Faltan 100 entre lo leído y lo insertado que no encajan en ninguna causa.
    const raro = { ...WIN, archivoInvalidas: 188 };
    const bloque = cascadaPartidas(raro, MOTOR)[0]!;
    const resto = bloque.lineas.find((l) => l.sinExplicar);
    expect(resto?.cantidad).toBe(100);
    const inicio = bloque.lineas.find((l) => l.tipo === "inicio")!;
    const total = bloque.lineas.find((l) => l.tipo === "total")!;
    expect(inicio.cantidad - suma(bloque.lineas)).toBe(total.cantidad);
  });

  it("un borrado posterior a la carga aparece como tal Y sigue cuadrando", () => {
    // Se deshizo una carga entre importar y conciliar: 309 comprobantes menos.
    // ⚠️ El bloque arranca en lo INSERTADO, no en lo que queda; si arrancara en
    // lo que queda, la línea que explica el borrado descuadraría el bloque.
    const conBorrado = { ...WIN, cargados: 452_000, internos: 451_868 };
    const motor = { internos: 451_868, conciliados: 447_795 };
    const bloque = cascadaPartidas(conBorrado, motor)[1]!;

    const borrados = bloque.lineas.find((l) => l.clave === "borrados");
    expect(borrados?.cantidad).toBe(309);
    expect(bloque.lineas.some((l) => l.sinExplicar)).toBe(false);

    for (const b of cascadaPartidas(conBorrado, motor)) {
      const inicio = b.lineas.find((l) => l.tipo === "inicio")!;
      const total = b.lineas.find((l) => l.tipo === "total")!;
      expect(inicio.cantidad - suma(b.lineas), b.clave).toBe(total.cantidad);
    }
  });

  it("el total de un bloque es el inicio del siguiente: la cascada encadena", () => {
    const bloques = cascadaPartidas(WIN, MOTOR);
    for (let i = 1; i < bloques.length; i++) {
      const anterior = bloques[i - 1]!.lineas.find((l) => l.tipo === "total")!;
      const siguiente = bloques[i]!.lineas.find((l) => l.tipo === "inicio")!;
      expect(siguiente.cantidad).toBe(anterior.cantidad);
    }
  });

  it("sin foto de origen queda el bloque del motor, no una invención", () => {
    const b = cascadaPartidas(null, MOTOR);
    expect(b.map((x) => x.clave)).toEqual(["motor"]);
    expect(b[0]!.lineas.at(-1)!.cantidad).toBe(4_382);
  });

  it("con alcance de empresa NO se enseña el bloque del archivo", () => {
    // Datos anteriores a la 0043: no se sabe qué carga trajo qué, así que
    // hablar de "filas del archivo" sería inventarlo.
    const viejo: OrigenPartidas = { ...WIN, alcance: "empresa" };
    const b = cascadaPartidas(viejo, MOTOR);
    expect(b.map((x) => x.clave)).toEqual(["seleccion", "motor"]);
  });

  it("enseña la diferencia si la foto y el motor no coinciden", () => {
    const b = cascadaPartidas(WIN, { internos: 452_000, conciliados: 447_795 });
    const linea = b.at(-1)!.lineas.find((l) => l.clave === "descuadre");
    expect(linea?.cantidad).toBe(177);
    expect(linea?.sinExplicar).toBe(true);
  });

  it("sin descuadre no aparece esa línea", () => {
    const b = cascadaPartidas(WIN, MOTOR);
    expect(b.at(-1)!.lineas.some((l) => l.clave === "descuadre")).toBe(false);
  });
});

describe("resumenDiferencia", () => {
  it("resume el caso real en una frase con sus causas", () => {
    const r = resumenDiferencia(WIN, MOTOR)!;
    expect(r.total).toBe(452_605 - 447_795);
    expect(r.base).toBe("de tu archivo");
    // es-PE separa los miles con coma, como el resto de la aplicación.
    expect(r.frase).toContain("4,382 entraron pero no encontraron pareja");
    expect(r.frase).toContain("288 no traían fecha, importe o tipo");
    expect(r.frase).toContain("132 son de fechas fuera del período");
  });

  it("⚠️ NO llama «no llegaron a cargarse» a lo que se borró después", () => {
    // El caso real que lo destapó: ocho cargas del mismo archivo con borrados
    // entre medias. La frase decía «1.348 no llegaron a cargarse» cuando 282 no
    // llegaron y 1.066 sí llegaron y se quitaron — contradiciendo a la tabla
    // que tenía justo debajo.
    const recargas: OrigenPartidas = {
      alcance: "cargas",
      cargas: 8,
      archivoFilas: 1_584,
      archivoRepetidas: 0,
      archivoInvalidas: 0,
      archivoExistentes: 282,
      archivoInsertados: 1_302,
      cargados: 236,
      fueraPeriodo: 0,
      yaCobrados: 0,
      otraMoneda: 3,
      internos: 233,
      arrastrados: 0,
    };
    const r = resumenDiferencia(recargas, { internos: 233, conciliados: 221 })!;
    expect(r.frase).toContain("1,066 se quitaron después de cargarlas");
    expect(r.frase).toContain("282 ya estaban cargadas de antes");
    expect(r.frase).not.toContain("no llegaron a cargarse");
  });

  it("nombra la base: con ocho cargas no es «tu archivo»", () => {
    // El archivo tiene 236 filas; 1.584 es la suma de lo leído en ocho cargas,
    // así que llamarlo «tu archivo» es falso — y es el número que se enseña.
    const recargas: OrigenPartidas = {
      alcance: "cargas", cargas: 8, archivoFilas: 1_584, archivoRepetidas: 0,
      archivoInvalidas: 0, archivoExistentes: 282, archivoInsertados: 1_302,
      cargados: 236, fueraPeriodo: 0, yaCobrados: 0, otraMoneda: 3, internos: 233,
      arrastrados: 0,
    };
    expect(resumenDiferencia(recargas, { internos: 233, conciliados: 221 })!.base)
      .toBe("de las 8 cargas de este período");
  });

  it("no enumera más de tres causas: la cuarta y siguientes se agrupan", () => {
    const muchas: OrigenPartidas = {
      ...WIN,
      archivoRepetidas: 10,
      archivoInvalidas: 20,
      archivoExistentes: 30,
      archivoInsertados: 452_545,
      cargados: 452_500,
      fueraPeriodo: 40,
      otraMoneda: 5,
      internos: 452_177,
    };
    const r = resumenDiferencia(muchas, MOTOR)!;
    expect(r.frase).toMatch(/causas? más\.$/);
  });

  it("devuelve null cuando no hay nada que explicar", () => {
    const perfecto: OrigenPartidas = {
      ...WIN,
      archivoFilas: 100,
      archivoRepetidas: 0,
      archivoInvalidas: 0,
      archivoExistentes: 0,
      archivoInsertados: 100,
      cargados: 100,
      fueraPeriodo: 0,
      internos: 100,
    };
    expect(resumenDiferencia(perfecto, { internos: 100, conciliados: 100 })).toBeNull();
  });

  it("sin datos no inventa nada", () => {
    expect(resumenDiferencia(null, MOTOR)).toBeNull();
    expect(resumenDiferencia(WIN, null)).toBeNull();
  });
});

describe("leerOrigen", () => {
  it("lee la fila de Postgres con sus nombres snake_case", () => {
    const o = leerOrigen({
      alcance: "cargas",
      cargas: 2,
      archivo_filas: "10",
      archivo_repetidas: 1,
      archivo_invalidas: null,
      archivo_existentes: 0,
      archivo_insertados: 9,
      cargados: 9,
      fuera_periodo: 1,
      ya_cobrados: 0,
      otra_moneda: 0,
      internos: 8,
    })!;
    expect(o.archivoFilas).toBe(10);
    expect(o.archivoInvalidas).toBe(0);
    expect(o.internos).toBe(8);
  });

  it("un alcance desconocido degrada a 'empresa', nunca al revés", () => {
    // Prometer que está acotado a unas cargas cuando no se sabe sería anunciar
    // una precisión que no existe.
    expect(leerOrigen({ alcance: "vete a saber" })!.alcance).toBe("empresa");
    expect(leerOrigen(null)).toBeNull();
  });
});
