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

/**
 * La columna de referencia es la que decide el resultado de una cuenta
 * recaudadora: sin ella la capa exacta no puede emparejar nada.
 *
 * Una conciliación de 450.999 movimientos terminó en 0% porque la columna
 * `Recibos` no se reconoció y nadie la mapeó a mano. Estos tests fijan los
 * nombres que un banco peruano usa para ese dato.
 */
describe("detección de la columna de referencia", () => {
  const conEncabezados = (headers: string[]) =>
    detectarColumnas(headers, [Object.fromEntries(headers.map((h) => [h, "x"]))]);

  it("reconoce «Recibos», que es como la llama una recaudadora", () => {
    expect(
      conEncabezados(["OPERACIÓN", "Recibos", "Fecha", "Importe", "Descripcion"])
        .referencia,
    ).toBe("Recibos");
  });

  it("reconoce las formas habituales de un extracto", () => {
    expect(conEncabezados(["Fecha", "Referencia"]).referencia).toBe("Referencia");
    expect(conEncabezados(["Fecha", "Nro Operacion"]).referencia).toBe("Nro Operacion");
    expect(conEncabezados(["Fecha", "Recibo"]).referencia).toBe("Recibo");
  });
});

describe("extracto bancario peruano: la columna «Operación»", () => {
  /**
   * ⚠️ El caso que mordió en una demo. Un extracto del BCP trae una columna
   * `Operación` con el código del movimiento. Por nombre encajaba en `tipo`
   * —«operacion» estaba en sus palabras— y de `referencia` se había EXCLUIDO a
   * propósito para que no compitiera con «nro operación». Resultado: `tipo` mal
   * puesto, con valores que no significan nada, y `referencia` SIN MAPEAR, que
   * es la columna de la que depende todo el emparejamiento.
   */
  const extracto = [
    { Fecha: "01/06/2026", Descripción: "ABONO TRANSF. PLASTICOS DEL PACIFICO", Monto: "7351.72", Saldo: "45851.72", Operación: "30010039", Sucursal: "0451" },
    { Fecha: "02/06/2026", Descripción: "PAGO PROVEEDOR BACKUS", Monto: "-6592.01", Saldo: "39259.71", Operación: "30010040", Sucursal: "0451" },
    { Fecha: "03/06/2026", Descripción: "ABONO TRANSF. COMERCIAL NUNEZ", Monto: "12251.62", Saldo: "51511.33", Operación: "30010041", Sucursal: "0451" },
  ];

  it("la manda a REFERENCIA, no a tipo", () => {
    const m = detectarColumnas(Object.keys(extracto[0]!), extracto);
    expect(m.referencia).toBe("Operación");
    expect(m.tipo).toBeUndefined();
  });

  it("acierta el resto del extracto", () => {
    const m = detectarColumnas(Object.keys(extracto[0]!), extracto);
    expect(m.fecha).toBe("Fecha");
    expect(m.monto).toBe("Monto");
    expect(m.descripcion).toBe("Descripción");
  });

  it("una columna específica le gana a «Operación»", () => {
    // La señal débil pierde contra una palabra específica: era el motivo por el
    // que se excluyó, y se conserva.
    const conRecibos = extracto.map((f) => ({ ...f, Recibos: `SR11-0${f.Operación}` }));
    const m = detectarColumnas(Object.keys(conRecibos[0]!), conRecibos);
    expect(m.referencia).toBe("Recibos");
  });

  it("una columna de tipo DE VERDAD sí se detecta", () => {
    const conTipo = extracto.map((f, i) => ({ ...f, Movimiento: i === 1 ? "cargo" : "abono" }));
    const m = detectarColumnas(Object.keys(conTipo[0]!), conTipo);
    expect(m.tipo).toBe("Movimiento");
    expect(m.referencia).toBe("Operación");
  });

  it("no confunde el saldo con la referencia", () => {
    // `Saldo` son números con decimales: eso es un importe, no un código.
    const m = detectarColumnas(Object.keys(extracto[0]!), extracto);
    expect(m.referencia).not.toBe("Saldo");
    expect(m.monto).not.toBe("Saldo");
  });
});
