import { describe, it, expect } from "vitest";
import {
  detectarColumnasComprobante,
  detectarComprobantesConDudas,
} from "@/lib/parsing/deteccionComprobantes";

/**
 * La detección con un EXPORT CONTABLE, que es donde se rompía.
 *
 * El caso viene de un mayor real de 452.605 filas. Con la heurística anterior
 * proponía tres columnas mal, y ninguna de las tres fallaba en pantalla:
 *
 *   monto         → `Importe Moneda Base`  → negativos → la carga entera se
 *                                            rechaza por el check de saldo
 *   tipo          → `Tipo de Transacción`  → sus valores son "Pago" y
 *                                            "Asiento": 452.461 cobranzas
 *                                            cargadas como PAGOS, el dinero
 *                                            entero al lado contrario
 *   nº documento  → `Nro. Documento`       → es el asiento, no el recibo → el
 *                                            banco no conoce ese código → 0 %
 *
 * Estos tests fijan las tres correcciones y el aviso de empate.
 */

const HEADERS = [
  "Cuenta", "Tipo de Transacción", "Periodo Contable", "Fecha",
  "ID de transacción", "Nro. Documento", "Documento Relacionado",
  "WIN - Nro. Documento", "Entidad", "Nota - Cabecera", "Tipo de Cambio",
  "Moneda", "Importe Moneda Base", "Débito", "Crédito",
];

/** Un mayor: primero las líneas de un asiento de crédito, luego los cobros. */
function mayor(): Record<string, unknown>[] {
  const filas: Record<string, unknown>[] = [];
  // 40 líneas del MISMO asiento: crédito, sin débito, y con el nº de asiento
  // repetido en todas (por eso `Nro. Documento` no es una identidad).
  for (let i = 0; i < 40; i++) {
    filas.push({
      "Cuenta": "",
      "Tipo de Transacción": "Asiento",
      "Periodo Contable": "jun 2026",
      "Fecha": "2026-05-26",
      "ID de transacción": "41605673",
      "Nro. Documento": "AD-WIN-01075796",
      "Documento Relacionado": "",
      "WIN - Nro. Documento": `SR11-0291${2000 + i}`,
      "Entidad": "",
      "Nota - Cabecera": "CREDICARGO BCP MAYO 26",
      "Tipo de Cambio": "1",
      "Moneda": "Soles",
      "Importe Moneda Base": "-69.00",
      "Débito": "",
      "Crédito": "69.00",
    });
  }
  // 160 cobros: débito, cada uno con su recibo y su nº de pago propios.
  for (let i = 0; i < 160; i++) {
    filas.push({
      "Cuenta": "",
      "Tipo de Transacción": "Pago",
      "Periodo Contable": "jun 2026",
      "Fecha": "2026-06-14",
      "ID de transacción": `4070${2000 + i}`,
      "Nro. Documento": `PA-WIN-0388${8000 + i}`,
      "Documento Relacionado": "",
      "WIN - Nro. Documento": `SR11-0041${8000 + i}`,
      "Entidad": "C-195931 MILIKA VELASQUEZ",
      "Nota - Cabecera": `0000305161${40 + i}`,
      "Tipo de Cambio": "1",
      "Moneda": "Soles",
      "Importe Moneda Base": "73.58",
      "Débito": "73.58",
      "Crédito": "",
    });
  }
  return filas;
}

describe("detección con un export contable", () => {
  const filas = mayor();
  const { mapeo, alternativas } = detectarComprobantesConDudas(HEADERS, filas);

  it("elige la columna de importe SIN signo y con datos en casi todas las filas", () => {
    // `Importe Moneda Base` mezcla signos (es el movimiento del mayor) y
    // `Crédito` solo tiene valor en el 20 % de las filas.
    expect(mapeo.monto).toBe("Débito");
  });

  it("NO propone una columna de tipo cuyos valores no significan nada", () => {
    // «Asiento» no es cobranza ni pago. Proponer nada obliga a declararlo, que
    // es la respuesta correcta; proponer esa columna carga los cobros como
    // pagos y nadie lo ve.
    expect(mapeo.tipo).toBeUndefined();
  });

  it("elige como nº de documento el que NO se repite", () => {
    expect(mapeo.serie_numero).toBe("WIN - Nro. Documento");
  });

  it("deja la referencia de emparejamiento vacía si nada la nombra", () => {
    // Mapearla mal es el error más caro: manda al motor a casar por un código
    // que el banco no tiene. Sin candidata clara, mejor vacía.
    expect(mapeo.referencia_externa).toBeUndefined();
  });

  it("acierta lo demás", () => {
    expect(mapeo.fecha).toBe("Fecha");
    expect(mapeo.moneda).toBe("Moneda");
  });

  it("avisa de las columnas con las que dudó", () => {
    expect(alternativas.monto).toContain("Importe Moneda Base");
    expect(alternativas.serie_numero).toContain("Nro. Documento");
  });

  it("no propone una columna vacía en toda la muestra", () => {
    const usados = Object.values(mapeo);
    expect(usados).not.toContain("Documento Relacionado");
    expect(usados).not.toContain("Cuenta");
    expect(Object.values(alternativas).flat()).not.toContain("Documento Relacionado");
  });
});

describe("no rompe el caso normal", () => {
  it("un libro de ventas se detecta igual que siempre", () => {
    const filas = [
      { "F. EMISION": "01/06/2026", "SERIE-NUMERO": "F001-000123", "TIPO": "FACTURA", "RAZON SOCIAL": "ACME SAC", "RUC": "20512345678", "TOTAL": "1180.00", "MONEDA": "PEN", "N° OPERACION": "000123456" },
      { "F. EMISION": "02/06/2026", "SERIE-NUMERO": "B001-000045", "TIPO": "BOLETA", "RAZON SOCIAL": "Juan Perez", "RUC": "", "TOTAL": "59.00", "MONEDA": "PEN", "N° OPERACION": "000123457" },
      { "F. EMISION": "03/06/2026", "SERIE-NUMERO": "F001-000124", "TIPO": "FACTURA", "RAZON SOCIAL": "Otra SAC", "RUC": "20587654321", "TOTAL": "236.00", "MONEDA": "PEN", "N° OPERACION": "000123458" },
    ];
    const m = detectarColumnasComprobante(Object.keys(filas[0]!), filas);
    expect(m.fecha).toBe("F. EMISION");
    expect(m.monto).toBe("TOTAL");
    expect(m.tipo).toBe("TIPO");
    expect(m.serie_numero).toBe("SERIE-NUMERO");
    expect(m.referencia_externa).toBe("N° OPERACION");
    expect(m.razon_social).toBe("RAZON SOCIAL");
    expect(m.moneda).toBe("MONEDA");
  });

  it("una nota de crédito en negativo no descarta la columna de importe", () => {
    // La mezcla de signos penaliza, no veta: si no hay otra candidata, gana.
    const filas = [
      { FECHA: "01/06/2026", TOTAL: "100.00", TIPO: "FACTURA" },
      { FECHA: "02/06/2026", TOTAL: "-40.00", TIPO: "FACTURA" },
    ];
    expect(detectarColumnasComprobante(Object.keys(filas[0]!), filas).monto).toBe("TOTAL");
  });

  it("sin filas de muestra se detecta solo por el nombre, como antes", () => {
    const m = detectarColumnasComprobante(["fecha", "monto", "tipo"], []);
    expect(m).toEqual({ fecha: "fecha", monto: "monto", tipo: "tipo" });
  });
});
