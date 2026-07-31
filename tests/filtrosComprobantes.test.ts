import { describe, it, expect } from "vitest";
import {
  normalizar,
  filtrarComprobantes,
  hayFiltroComprobantes,
  filtroDesdeParams,
  FILTRO_COMPROBANTES_VACIO,
} from "@/lib/filtrosComprobantes";
import {
  filtrarSaldo,
  hayFiltroSaldo,
  filtroSaldoDesdeParams,
  FILTRO_SALDO_VACIO,
} from "@/lib/filtrosSaldo";
import type { ComprobanteCobrar } from "@/lib/aging";

const filas = [
  {
    fecha: "2026-07-02",
    tipo: "cobranza",
    estado: "pendiente",
    serie_numero: "F001-101",
    razon_social_contraparte: "Minera Andina SAC",
  },
  {
    fecha: "2026-07-15",
    tipo: "pago",
    estado: "cobrado",
    serie_numero: "E001-139",
    razon_social_contraparte: "Electro Servicio SA",
  },
  {
    fecha: "2026-03-05",
    tipo: null, // sin tipo → se trata como cobranza
    estado: "pendiente",
    serie_numero: "TEST-004",
    razon_social_contraparte: "García Ñuñez EIRL",
  },
];

describe("normalizar", () => {
  it("quita tildes y mayúsculas para que buscar no exija acertar la tilde", () => {
    expect(normalizar("García")).toBe("garcia");
    expect(normalizar("  MINERA  ")).toBe("minera");
  });

  /*
   * La ñ también se descompone y pierde la virgulilla. En un buscador eso se
   * quiere: quien teclea "nunez" espera encontrar a "Ñuñez", y en un teclado
   * ajeno la ñ no siempre está a mano. El coste es que "peña" y "pena"
   * colisionan, aceptable para filtrar una lista y no para ordenarla.
   */
  it("la ñ se busca sin virgulilla, a propósito", () => {
    expect(normalizar("Ñuñez")).toBe("nunez");
  });
});

describe("filtrarComprobantes", () => {
  const base = FILTRO_COMPROBANTES_VACIO;

  it("sin filtro devuelve todo", () => {
    expect(filtrarComprobantes(filas, base)).toHaveLength(3);
  });

  it("filtra por tipo, tratando el tipo nulo como cobranza", () => {
    expect(filtrarComprobantes(filas, { ...base, tipo: "cobranza" })).toHaveLength(2);
    expect(filtrarComprobantes(filas, { ...base, tipo: "pago" })).toHaveLength(1);
  });

  it("filtra por estado", () => {
    expect(filtrarComprobantes(filas, { ...base, estado: "pendiente" })).toHaveLength(2);
    expect(filtrarComprobantes(filas, { ...base, estado: "anulado" })).toHaveLength(0);
  });

  it("filtra por año y mes", () => {
    expect(filtrarComprobantes(filas, { ...base, anio: 2026, mes: 7 })).toHaveLength(2);
    expect(filtrarComprobantes(filas, { ...base, mes: 3 })).toHaveLength(1);
  });

  it("busca por serie y por nombre, ignorando tildes", () => {
    expect(filtrarComprobantes(filas, { ...base, busca: "F001" })).toHaveLength(1);
    expect(filtrarComprobantes(filas, { ...base, busca: "garcia" })).toHaveLength(1);
    expect(filtrarComprobantes(filas, { ...base, busca: "MINERA" })).toHaveLength(1);
  });

  it("combina filtros", () => {
    const r = filtrarComprobantes(filas, {
      ...base,
      tipo: "cobranza",
      anio: 2026,
      mes: 7,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.serie_numero).toBe("F001-101");
  });

  it("hayFiltroComprobantes distingue el filtro vacío", () => {
    expect(hayFiltroComprobantes(base)).toBe(false);
    expect(hayFiltroComprobantes({ ...base, busca: "  " })).toBe(false);
    expect(hayFiltroComprobantes({ ...base, tipo: "pago" })).toBe(true);
  });

  it("filtroDesdeParams tolera basura en la URL", () => {
    expect(filtroDesdeParams({ tipo: "inventado", mes: "99", anio: "abc" })).toEqual(
      FILTRO_COMPROBANTES_VACIO,
    );
    expect(filtroDesdeParams({ tipo: "pago", mes: "7", anio: "2026" })).toMatchObject({
      tipo: "pago",
      mes: 7,
      anio: 2026,
    });
  });
});

describe("filtrarSaldo", () => {
  const hoy = new Date("2026-07-31T12:00:00Z");
  const docs: ComprobanteCobrar[] = [
    {
      id: "1",
      fecha: "2026-07-01",
      fecha_vencimiento: "2026-08-30", // aún no vence
      monto: 1000,
      saldo: 1000,
      tipo: "cobranza",
      estado: "pendiente",
      serie_numero: "F001-101",
      ruc_contraparte: "20512345678",
      razon_social_contraparte: "Minera Andina SAC",
    },
    {
      id: "2",
      fecha: "2026-05-01",
      fecha_vencimiento: "2026-06-15", // ~46 días vencido
      monto: 500,
      saldo: 500,
      tipo: "cobranza",
      estado: "pendiente",
      serie_numero: "F001-050",
      ruc_contraparte: "20599999999",
      razon_social_contraparte: "Textiles Perú SAC",
    },
  ];

  it("sin filtro devuelve todo", () => {
    expect(filtrarSaldo(docs, FILTRO_SALDO_VACIO, hoy)).toHaveLength(2);
  });

  it("«solo vencido» excluye lo que aún no vence", () => {
    const r = filtrarSaldo(docs, { ...FILTRO_SALDO_VACIO, soloVencido: true }, hoy);
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("2");
  });

  it("filtra por tramo de antigüedad", () => {
    expect(
      filtrarSaldo(docs, { ...FILTRO_SALDO_VACIO, tramo: "por_vencer" }, hoy),
    ).toHaveLength(1);
    expect(
      filtrarSaldo(docs, { ...FILTRO_SALDO_VACIO, tramo: "d31_60" }, hoy),
    ).toHaveLength(1);
    expect(
      filtrarSaldo(docs, { ...FILTRO_SALDO_VACIO, tramo: "d90_mas" }, hoy),
    ).toHaveLength(0);
  });

  it("busca por nombre, RUC y serie", () => {
    expect(
      filtrarSaldo(docs, { ...FILTRO_SALDO_VACIO, busca: "textiles" }, hoy),
    ).toHaveLength(1);
    expect(
      filtrarSaldo(docs, { ...FILTRO_SALDO_VACIO, busca: "20512345678" }, hoy),
    ).toHaveLength(1);
    expect(
      filtrarSaldo(docs, { ...FILTRO_SALDO_VACIO, busca: "F001-050" }, hoy),
    ).toHaveLength(1);
  });

  it("hayFiltroSaldo y filtroSaldoDesdeParams", () => {
    expect(hayFiltroSaldo(FILTRO_SALDO_VACIO)).toBe(false);
    expect(hayFiltroSaldo({ ...FILTRO_SALDO_VACIO, soloVencido: true })).toBe(true);
    expect(filtroSaldoDesdeParams({ tramo: "inventado" }).tramo).toBe("todos");
    expect(filtroSaldoDesdeParams({ tramo: "d61_90", vencido: "1" })).toMatchObject({
      tramo: "d61_90",
      soloVencido: true,
    });
  });
});
