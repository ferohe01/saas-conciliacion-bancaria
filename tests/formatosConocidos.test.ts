import { describe, it, expect } from "vitest";
import {
  reconocerFormato,
  saldoMasReciente,
  type SaldoEnFecha,
} from "@/lib/parsing/formatosConocidos";
import { aplicarMapeo } from "@/lib/parsing/mapeoComprobantes";

// Cabecera real del export (primera hoja de «WIN-Libro Mayor JUNIO COMPLETO»).
const CABECERA = [
  "Cuenta", "Tipo de Transacción", "Periodo Contable", "Fecha",
  "ID de transacción", "Nro. Documento", "Documento Relacionado",
  "WIN - Nro. Documento", "Entidad", "Entidad - Asientos", "Nota - Cabecera",
  "Nota - Línea", "Tipo de Cambio", "Moneda", "Importe Moneda Base", "Débito",
  "Crédito", "Saldo",
];

describe("formato conocido: libro mayor de WIN", () => {
  it("se reconoce y no le falta nada", () => {
    const r = reconocerFormato(CABECERA);
    expect(r?.formato.id).toBe("win_libro_mayor");
    expect(r?.faltan).toEqual([]);
    expect(r?.config.tipoFijo).toBe("cobranza");
    expect(r?.config.mapeo.monto).toBe("Débito");
    expect(r?.config.mapeo.serie_numero).toBe("WIN - Nro. Documento");
  });

  it("interpreta una línea real del mayor", () => {
    const r = reconocerFormato(CABECERA)!;
    const fila = aplicarMapeo(
      {
        "Tipo de Transacción": "Pago",
        Fecha: "2026-06-01",
        "Nro. Documento": "PA-WIN-03888887",
        "WIN - Nro. Documento": "SR11-00418971",
        "Nota - Cabecera": "000030516142",
        Moneda: "Soles",
        "Importe Moneda Base": 73.58,
        Débito: 73.58,
      },
      r.config,
    );
    expect(fila).toMatchObject({
      fecha: "2026-06-01",
      monto: 73.58,
      tipo: "cobranza",
      serie_numero: "SR11-00418971",
      moneda: "PEN",
    });
  });

  it("una línea de crédito (salida) se omite: no trae débito", () => {
    const r = reconocerFormato(CABECERA)!;
    const fila = aplicarMapeo(
      { Fecha: "2026-05-26", "WIN - Nro. Documento": "SR11-02912186", Crédito: 69 },
      r.config,
    );
    expect(fila).toBeNull();
  });

  it("las columnas de más se ignoran", () => {
    const r = reconocerFormato([...CABECERA, "Columna nueva", "Otra"]);
    expect(r?.faltan).toEqual([]);
    expect(Object.values(r!.config.mapeo)).not.toContain("Columna nueva");
  });

  it("si falta una columna NECESARIA, se dice cuál y para qué", () => {
    const r = reconocerFormato(CABECERA.filter((c) => c !== "Débito"));
    expect(r?.formato.id).toBe("win_libro_mayor");
    expect(r?.faltan.map((f) => f.columna)).toEqual(["Débito"]);
    expect(r?.faltan[0]?.para).toContain("importe");
  });

  it("si falta una opcional, se importa igual sin mapearla", () => {
    const r = reconocerFormato(
      CABECERA.filter((c) => c !== "Moneda" && c !== "Nota - Cabecera"),
    );
    expect(r?.faltan).toEqual([]);
    expect(r?.config.mapeo.moneda).toBeUndefined();
    expect(r?.config.mapeo.descripcion).toBeUndefined();
  });

  it("tolera mayúsculas, acentos y espacios, y conserva la cabecera real", () => {
    const r = reconocerFormato(
      CABECERA.map((c) => (c === "Débito" ? " DEBITO " : c)),
    );
    expect(r?.faltan).toEqual([]);
    expect(r?.config.mapeo.monto).toBe(" DEBITO ");
  });

  it("expone la columna de saldo acumulado, con su cabecera real", () => {
    expect(reconocerFormato(CABECERA)?.columnaSaldo).toBe("Saldo");
    expect(
      reconocerFormato(CABECERA.filter((c) => c !== "Saldo"))?.columnaSaldo,
    ).toBeNull();
  });

  it("un archivo que no se le parece no se reconoce", () => {
    expect(reconocerFormato(["fecha", "monto", "tipo", "referencia"])).toBeNull();
    expect(reconocerFormato(["Fecha", "Débito", "Crédito", "Saldo"])).toBeNull();
  });
});

describe("saldoMasReciente: el saldo según libros es el de la línea más reciente", () => {
  const recorrer = (lineas: SaldoEnFecha[]) =>
    lineas.reduce<SaldoEnFecha | null>((p, l) => saldoMasReciente(p, l), null);

  it("por FECHA, no por posición: el mayor empieza con líneas del mes anterior", () => {
    // Forma real del export: abre con asientos del 26/05 y cierra el 30/06.
    expect(
      recorrer([
        { fecha: "2026-06-30", saldo: 13_886_768.15 },
        { fecha: "2026-05-26", saldo: 7_055_975.46 },
      ]),
    ).toEqual({ fecha: "2026-06-30", saldo: 13_886_768.15 });
  });

  it("dentro del mismo día gana la línea posterior: el saldo es acumulado", () => {
    expect(
      recorrer([
        { fecha: "2026-06-30", saldo: 13_886_768.15 },
        { fecha: "2026-06-30", saldo: 13_886_769.15 },
      ]),
    ).toEqual({ fecha: "2026-06-30", saldo: 13_886_769.15 });
  });

  it("sin líneas no hay saldo", () => {
    expect(recorrer([])).toBeNull();
  });
});