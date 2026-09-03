import { describe, it, expect } from "vitest";
import {
  CAMPOS,
  CAMPOS_EXTRACTO,
  detectarColumnas,
  detectarColumnasConDudas,
} from "@/lib/parsing/deteccion";
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

  /**
   * ⚠️ El Paso 1 enfrenta dos tarjetas gemelas —comprobantes contra extracto— y
   * la de comprobantes suma `cobranzas − pagos`. Con la suma de valores
   * absolutos las dos mostraban cosas distintas con el mismo aspecto: en el
   * juego de junio, «S/ 640.150,95» de libros al lado de «S/ 1.629.605,72» del
   * banco. La lectura natural es que falta un millón, y es falsa.
   */
  it("el NETO compensa cargos y abonos; `sumaTotal` no", () => {
    const filas = [
      { F: "01/06/2026", M: "1000.00" },
      { F: "02/06/2026", M: "-400.00" },
    ];
    const r = calcularResumen(filas, { fecha: "F", monto: "M" });
    expect(r.sumaTotal).toBeCloseTo(1400); // cuánto se movió
    expect(r.neto).toBeCloseTo(600); // qué dejó en la cuenta
  });

  it("un mes que sale en negativo se dice en negativo", () => {
    const filas = [{ F: "01/06/2026", M: "100" }, { F: "02/06/2026", M: "-900" }];
    expect(calcularResumen(filas, { fecha: "F", monto: "M" }).neto).toBeCloseTo(-800);
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

/**
 * ⚠️⚠️ Dos columnas que se parecen, y elegir mal no da un error.
 *
 * Un extracto real trae `Nro Operacion` (el código interno del banco) y
 * `Nro Referencia` (lo que casa con los comprobantes). La heurística elegía la
 * primera por dos motivos que se reforzaban: coincidía ENTERA con la palabra
 * clave `nro operacion` (3) mientras la buena solo CONTENÍA `referencia` (2), y
 * el desempate por unicidad la premiaba —los códigos del banco no se repiten
 * nunca y las referencias sí, porque un cliente paga dos recibos con la misma—.
 *
 * Consecuencia medida sobre los archivos del cliente: la capa exacta comparó
 * `REF-1002` contra `OP-500002`, el respaldo por monto+fecha lo bloqueó la
 * guarda de contradicción de referencias (haciendo bien su trabajo) y la
 * conciliación terminó en **0 pares de 25 partidas** con los dos archivos
 * perfectamente emparejables.
 */
describe("dos columnas candidatas a referencia", () => {
  const headers = [
    "Nro Operacion",
    "Nro Referencia",
    "Fecha de Pago",
    "Concepto / Cliente",
    "Monto Abonado (S/)",
  ];
  const filas = [
    ["OP-500001", "REF-1001", "2026-08-27", "Pago Empresa Alfa SAC", "1,500.00"],
    ["OP-500002", "REF-1002", "2026-08-27", "Pago Comercial Beta EIRL", "2,300.50"],
    ["OP-500003", "REF-1003", "2026-08-28", "Pago Industrias Gamma SA", "980.00"],
    ["OP-500014", "REF-1001", "2026-08-31", "Pago Empresa Alfa SAC (duplicado)", "1,500.00"],
    ["OP-500015", "REF-1006", "2026-08-31", "Pago Corporacion Zeta SA", "3,105.00"],
  ].map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));

  it("gana la que dice «referencia», aunque la otra coincida entera y no repita valores", () => {
    expect(detectarColumnas(headers, filas).referencia).toBe("Nro Referencia");
  });

  /**
   * ⚠️ El segundo fallo del mismo archivo, y el más difícil de ver. La
   * asignación es greedy y CONSUME el encabezado: `contraparte` —campo que
   * `MovimientoBancario` ni siquiera tiene— se llevaba «Concepto / Cliente» y
   * `descripcion` quedaba sin mapear. Como la `glosa` sale SOLO de
   * `mapeo.descripcion`, los movimientos llegaban al motor sin nombre y la capa
   * difusa, que exige una palabra en común con la contraparte, no podía
   * emparejar nada. En pantalla eran filas «BCO-0001» sin más.
   */
  it("la columna de nombre va a DESCRIPCIÓN: el extracto no tiene contraparte", () => {
    const m = detectarColumnas(headers, filas);
    expect(m.descripcion).toBe("Concepto / Cliente");
    expect(m).not.toHaveProperty("contraparte");
  });

  it("acierta el resto", () => {
    const m = detectarColumnas(headers, filas);
    expect(m.fecha).toBe("Fecha de Pago");
    expect(m.monto).toBe("Monto Abonado (S/)");
  });

  it("nombra la candidata descartada, que es la única pista del usuario", () => {
    const { alternativas } = detectarColumnasConDudas(headers, filas);
    expect(alternativas.referencia).toContain("Nro Operacion");
  });
});

/**
 * Las formas en que un banco peruano escribe el mismo encabezado. La detección
 * separa el encabezado en palabras, así que un punto, un guion bajo o un «N°»
 * en medio ya no impiden reconocerlo.
 */
describe("nombres de columna flexibles", () => {
  const conEncabezados = (headers: string[]) =>
    detectarColumnas(headers, [Object.fromEntries(headers.map((h) => [h, "AB-1234"]))]);

  it.each([
    "Nro. Referencia",
    "N° Referencia",
    "REFERENCIA_BANCO",
    "Referencia/Operación",
    "Ref. Pago",
    "Nº de Operación",
    "Cod. Operacion",
    "Voucher",
    "Constancia de pago",
    "Recibo N°",
  ])("reconoce «%s» como referencia", (h) => {
    expect(conEncabezados(["Fecha", h, "Importe"]).referencia).toBe(h);
  });

  /**
   * ⚠️ Ampliar el vocabulario solo sirve si no arrastra falsos. `id` dentro de
   * «Ciudad» o «Salida» no significa nada: las palabras cortas cuentan como
   * token completo, no como subcadena.
   */
  it("no confunde una palabra corta escondida dentro de otra", () => {
    const m = conEncabezados(["Fecha", "Ciudad", "Importe"]);
    expect(m.referencia).not.toBe("Ciudad");
  });
});

/**
 * ⚠️ Blindaje del cliente que YA concilia bien. Su extracto se detectaba y se
 * concilia al 99 %; lo que se cambió aquí no puede moverle una sola columna.
 * (En producción ni siquiera llega a depender de esto: su mapeo está guardado
 * en `cuentas_bancarias.mapeo_columnas.extracto` y `elegirMapeo` lo hace ganar
 * sobre la detección. Este test cubre el caso de una cuenta nueva.)
 */
describe("regresión: el extracto de una recaudadora sigue detectándose igual", () => {
  const filas = [
    { Fecha: "01/06/2026", Descripción: "ABONO TRANSF. PLASTICOS DEL PACIFICO", Monto: "7351.72", Saldo: "45851.72", Recibos: "SR11-02748951", Operación: "30010039" },
    { Fecha: "02/06/2026", Descripción: "PAGO PROVEEDOR BACKUS", Monto: "-6592.01", Saldo: "39259.71", Recibos: "SR11-03590663", Operación: "30010040" },
    { Fecha: "03/06/2026", Descripción: "ABONO TRANSF. COMERCIAL NUNEZ", Monto: "12251.62", Saldo: "51511.33", Recibos: "SR11-02748952", Operación: "30010041" },
  ];

  it("«Recibos» sigue ganando a «Operación»", () => {
    const m = detectarColumnas(Object.keys(filas[0]!), filas);
    expect(m.referencia).toBe("Recibos");
    expect(m.fecha).toBe("Fecha");
    expect(m.monto).toBe("Monto");
    expect(m.descripcion).toBe("Descripción");
    expect(m.monto).not.toBe("Saldo");
  });
});

/**
 * ⚠️⚠️ La invariante que protege la glosa del extracto.
 *
 * La asignación de columnas es greedy y CONSUME el encabezado: si un campo que
 * el extracto no usa entra en esta lista, puede quedarse con la columna de otro
 * que sí. Ya pasó con `contraparte`, que se llevaba «Concepto / Cliente» y
 * dejaba `descripcion` sin mapear — y como `normalizarMovimiento` construye la
 * glosa SOLO desde `mapeo.descripcion`, los movimientos llegaban al motor sin
 * nombre y la capa difusa se quedaba sin poder emparejar.
 *
 * Si algún día `MovimientoBancario` gana un campo de contraparte, este test
 * falla y hay que decidirlo a conciencia.
 */
describe("los campos que el extracto puede reclamar", () => {
  it("no incluye `contraparte`: un MovimientoBancario no la tiene", () => {
    expect(CAMPOS_EXTRACTO).not.toContain("contraparte");
  });

  it("todos son campos canónicos conocidos", () => {
    for (const c of CAMPOS_EXTRACTO) expect(CAMPOS).toContain(c);
  });
});
