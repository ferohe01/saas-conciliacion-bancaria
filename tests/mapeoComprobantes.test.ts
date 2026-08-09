import { describe, it, expect } from "vitest";
import {
  aplicarMapeo,
  normalizarTipo,
  esPlantilla,
  configCompleta,
  faltaEnConfig,
  MAPEO_PLANTILLA,
  ConfigMapeoGuardado,
  type Config,
} from "../src/lib/parsing/mapeoComprobantes";
import { detectarColumnasComprobante } from "../src/lib/parsing/deteccionComprobantes";

/** Un libro de ventas como los que exporta un ERP peruano. */
const EXPORT_CLIENTE = [
  {
    "F. EMISIÓN": "15/06/2026",
    "F. VCTO": "15/07/2026",
    "TIPO DOC": "FACTURA",
    "SERIE-NÚMERO": "F001-00123",
    "N° OPERACIÓN": "00000001300486",
    "RUC CLIENTE": "20512345678",
    "RAZÓN SOCIAL": "Comercial Ñuñez SAC",
    "TOTAL": "1,250.00",
    "GLOSA": "Servicio de junio",
  },
  {
    "F. EMISIÓN": "16/06/2026",
    "F. VCTO": "16/07/2026",
    "TIPO DOC": "BOLETA",
    "SERIE-NÚMERO": "B001-00044",
    "N° OPERACIÓN": "00000001300487",
    "RUC CLIENTE": "10456789012",
    "RAZÓN SOCIAL": "Ferretería Los Andes EIRL",
    "TOTAL": "980.50",
    "GLOSA": "Venta al contado",
  },
];

const HEADERS = Object.keys(EXPORT_CLIENTE[0]!);

describe("la plantilla sigue siendo un atajo, no un mecanismo aparte", () => {
  it("un archivo con las columnas de la plantilla se reconoce", () => {
    expect(esPlantilla(["fecha", "monto", "tipo", "referencia"])).toBe(true);
  });

  it("no le importan mayúsculas ni espacios", () => {
    expect(esPlantilla([" Fecha ", "MONTO", "Tipo"])).toBe(true);
  });

  it("el export del cliente NO es la plantilla: hay que preguntar", () => {
    expect(esPlantilla(HEADERS)).toBe(false);
  });

  it("con el mapeo de la plantilla se lee igual que siempre", () => {
    const fila = aplicarMapeo(
      {
        fecha: "15/06/2026",
        monto: "1250.00",
        tipo: "cobranza",
        referencia: "F001-00123",
      },
      { mapeo: MAPEO_PLANTILLA },
    );
    expect(fila?.fecha).toBe("2026-06-15");
    expect(fila?.monto).toBe(1250);
    expect(fila?.serie_numero).toBe("F001-00123");
  });
});

describe("detección sobre un export real", () => {
  const m = detectarColumnasComprobante(HEADERS, EXPORT_CLIENTE);

  it("acierta los tres obligatorios", () => {
    expect(m.fecha).toBe("F. EMISIÓN");
    expect(m.monto).toBe("TOTAL");
    expect(m.tipo).toBe("TIPO DOC");
  });

  it("distingue el número de documento de la referencia bancaria", () => {
    // Es LA confusión cara: son datos distintos y el motor los usa distinto.
    expect(m.serie_numero).toBe("SERIE-NÚMERO");
    expect(m.referencia_externa).toBe("N° OPERACIÓN");
  });

  it("reconoce el RUC por su forma, no solo por el nombre", () => {
    expect(m.ruc_contraparte).toBe("RUC CLIENTE");
  });

  it("no confunde la fecha de vencimiento con la de emisión", () => {
    expect(m.fecha_vencimiento).toBe("F. VCTO");
  });

  it("ninguna columna se usa para dos campos", () => {
    const usados = Object.values(m);
    expect(new Set(usados).size).toBe(usados.length);
  });
});

describe("tipo", () => {
  it("traduce los sinónimos que traen los exports reales", () => {
    expect(normalizarTipo("FACTURA")).toBe("cobranza");
    expect(normalizarTipo("Boleta")).toBe("cobranza");
    expect(normalizarTipo("VENTA")).toBe("cobranza");
    expect(normalizarTipo("compra")).toBe("pago");
    expect(normalizarTipo("EGRESO")).toBe("pago");
  });

  it("lo que no reconoce lo dice, en vez de adivinar", () => {
    expect(normalizarTipo("XYZ")).toBeNull();
    expect(normalizarTipo("")).toBeNull();
  });

  it("⚠️ el tipo declarado MANDA sobre la columna", () => {
    // Si el usuario dijo "todo son cobranzas", una columna con valores raros no
    // debe convertir algunas filas en pagos sin que se entere.
    const fila = aplicarMapeo(
      { f: "15/06/2026", t: "150", clase: "COMPRA" },
      {
        mapeo: { fecha: "f", monto: "t", tipo: "clase" },
        tipoFijo: "cobranza",
      },
    );
    expect(fila?.tipo).toBe("cobranza");
  });

  it("un archivo sin columna de tipo se puede importar declarándolo", () => {
    const config: Config = {
      mapeo: { fecha: "f", monto: "t" },
      tipoFijo: "cobranza",
    };
    expect(configCompleta(config)).toBe(true);
    expect(aplicarMapeo({ f: "15/06/2026", t: "10" }, config)?.tipo).toBe(
      "cobranza",
    );
  });
});

describe("aplicarMapeo", () => {
  const config: Config = {
    mapeo: detectarColumnasComprobante(HEADERS, EXPORT_CLIENTE),
    tipoFijo: null,
  };

  it("convierte el export del cliente a la forma canónica", () => {
    const f = aplicarMapeo(EXPORT_CLIENTE[0]!, config);
    expect(f).toEqual({
      fecha: "2026-06-15",
      fecha_vencimiento: "2026-07-15",
      monto: 1250,
      tipo: "cobranza",
      serie_numero: "F001-00123",
      referencia_externa: "00000001300486",
      ruc_contraparte: "20512345678",
      razon_social: "Comercial Ñuñez SAC",
      descripcion: "Servicio de junio",
    });
  });

  it("una fila sin lo obligatorio se descarta en vez de inventarse", () => {
    expect(aplicarMapeo({ "F. EMISIÓN": "15/06/2026" }, config)).toBeNull();
    expect(aplicarMapeo({ TOTAL: "100" }, config)).toBeNull();
  });

  it("un campo no mapeado queda en null, no rompe", () => {
    const f = aplicarMapeo(
      { f: "15/06/2026", t: "10", c: "venta" },
      { mapeo: { fecha: "f", monto: "t", tipo: "c" } },
    );
    expect(f?.serie_numero).toBeNull();
    expect(f?.razon_social).toBeNull();
  });
});

describe("qué falta para poder importar", () => {
  it("lo dice en palabras, no deja el botón muerto sin explicación", () => {
    expect(faltaEnConfig({ mapeo: {} })).toEqual([
      "la fecha",
      "el importe",
      "el tipo (una columna, o declararlo para todo el archivo)",
    ]);
  });

  it("con los tres resueltos no falta nada", () => {
    expect(
      faltaEnConfig({ mapeo: { fecha: "a", monto: "b", tipo: "c" } }),
    ).toEqual([]);
  });
});

describe("lo guardado se valida al LEERLO", () => {
  it("acepta un mapeo bien formado", () => {
    const r = ConfigMapeoGuardado.safeParse({
      mapeo: { fecha: "F1", monto: "T" },
      tipoFijo: "cobranza",
    });
    expect(r.success).toBe(true);
  });

  it("⚠️ rechaza una clave desconocida: elige qué columna se lee", () => {
    const r = ConfigMapeoGuardado.safeParse({
      mapeo: { fecha: "F1", inventado: "X" },
    });
    expect(r.success).toBe(false);
  });

  it("un valor corrupto no rompe la pantalla: simplemente no vale", () => {
    for (const v of [null, "texto", 42, { mapeo: "no es objeto" }]) {
      expect(ConfigMapeoGuardado.safeParse(v).success).toBe(false);
    }
  });
});
