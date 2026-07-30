import { describe, it, expect } from "vitest";
import {
  calcularAging,
  diasVencido,
  tramoDe,
  type ComprobanteCobrar,
} from "../src/lib/aging";

const HOY = new Date("2026-07-29T12:00:00Z");
const dia = (n: number) =>
  new Date(Date.UTC(2026, 6, 29) + n * 86400000).toISOString().slice(0, 10);

const cmp = (p: Partial<ComprobanteCobrar>): ComprobanteCobrar => ({
  id: "x",
  fecha: dia(0),
  fecha_vencimiento: null,
  monto: 100,
  saldo: 100,
  tipo: "cobranza",
  estado: "pendiente",
  serie_numero: null,
  ruc_contraparte: null,
  razon_social_contraparte: "Cliente A",
  ...p,
});

describe("diasVencido", () => {
  it("cuenta desde el vencimiento cuando existe", () => {
    expect(diasVencido({ fecha: dia(-90), fecha_vencimiento: dia(-10) }, HOY)).toBe(10);
  });

  it("una factura a crédito aún vigente NO está vencida", () => {
    // Emitida hace 60 días pero vence dentro de 30: el negocio no la reclama.
    expect(diasVencido({ fecha: dia(-60), fecha_vencimiento: dia(30) }, HOY)).toBe(-30);
  });

  it("sin vencimiento usa la emisión", () => {
    expect(diasVencido({ fecha: dia(-45), fecha_vencimiento: null }, HOY)).toBe(45);
  });

  it("sin ninguna fecha devuelve null", () => {
    expect(diasVencido({ fecha: null, fecha_vencimiento: null }, HOY)).toBeNull();
  });
});

describe("tramoDe", () => {
  it("reparte por los cortes esperados", () => {
    expect(tramoDe(-5)).toBe("por_vencer");
    expect(tramoDe(0)).toBe("por_vencer");
    expect(tramoDe(1)).toBe("d1_30");
    expect(tramoDe(30)).toBe("d1_30");
    expect(tramoDe(31)).toBe("d31_60");
    expect(tramoDe(90)).toBe("d61_90");
    expect(tramoDe(91)).toBe("d90_mas");
    expect(tramoDe(null)).toBe("por_vencer");
  });
});

describe("calcularAging", () => {
  it("agrupa por cliente y separa vencido de por vencer", () => {
    const r = calcularAging(
      [
        cmp({ razon_social_contraparte: "Cliente A", saldo: 500, fecha_vencimiento: dia(-40) }),
        cmp({ razon_social_contraparte: "Cliente A", saldo: 300, fecha_vencimiento: dia(10) }),
        cmp({ razon_social_contraparte: "Cliente B", saldo: 200, fecha_vencimiento: dia(-100) }),
      ],
      HOY,
    );
    expect(r.total).toBe(1000);
    expect(r.vencido).toBe(700);
    expect(r.porTramo.d31_60).toBe(500);
    expect(r.porTramo.d90_mas).toBe(200);
    expect(r.porTramo.por_vencer).toBe(300);
    expect(r.documentos).toBe(3);
  });

  it("ordena primero a quien más debe VENCIDO, no a quien más debe", () => {
    const r = calcularAging(
      [
        cmp({ razon_social_contraparte: "Debe mucho pero al dia", saldo: 5000, fecha_vencimiento: dia(20) }),
        cmp({ razon_social_contraparte: "Debe poco pero vencido", saldo: 100, fecha_vencimiento: dia(-50) }),
      ],
      HOY,
    );
    expect(r.contrapartes[0]!.contraparte).toBe("Debe poco pero vencido");
  });

  it("los pagos no son deuda de clientes: se excluyen", () => {
    const r = calcularAging([cmp({ tipo: "pago", saldo: 900 })], HOY);
    expect(r.total).toBe(0);
    expect(r.contrapartes).toHaveLength(0);
  });

  it("lo cobrado y lo anulado no cuentan", () => {
    const r = calcularAging(
      [
        cmp({ estado: "cobrado", saldo: 0 }),
        cmp({ estado: "anulado", saldo: 500 }),
        cmp({ estado: "parcial", saldo: 250 }),
      ],
      HOY,
    );
    expect(r.total).toBe(250);
    expect(r.documentos).toBe(1);
  });

  it("un saldo de céntimos no se cuenta como deuda", () => {
    expect(calcularAging([cmp({ saldo: 0.004 })], HOY).total).toBe(0);
  });

  it("un cliente sin nombre se agrupa aparte, no se pierde", () => {
    const r = calcularAging(
      [cmp({ razon_social_contraparte: "", saldo: 400, fecha_vencimiento: dia(-5) })],
      HOY,
    );
    expect(r.contrapartes[0]!.contraparte).toBe("Sin identificar");
    expect(r.total).toBe(400);
  });

  it("sin comprobantes devuelve un resumen en cero, no revienta", () => {
    const r = calcularAging([], HOY);
    expect(r.total).toBe(0);
    expect(r.contrapartes).toEqual([]);
    expect(r.porTramo.d1_30).toBe(0);
  });
});

describe("los dos lados nunca se mezclan", () => {
  const mixto = [
    cmp({ tipo: "cobranza", razon_social_contraparte: "Cliente A", saldo: 1000, fecha_vencimiento: dia(-10) }),
    cmp({ tipo: "cobranza", razon_social_contraparte: "Cliente B", saldo: 500, fecha_vencimiento: dia(5) }),
    cmp({ tipo: "pago", razon_social_contraparte: "Proveedor X", saldo: 700, fecha_vencimiento: dia(-20) }),
    cmp({ tipo: "pago", razon_social_contraparte: "Proveedor Y", saldo: 300, fecha_vencimiento: dia(15) }),
  ];

  it("por cobrar solo suma cobranzas", () => {
    const r = calcularAging(mixto, HOY, "cobranza");
    expect(r.total).toBe(1500);
    expect(r.documentos).toBe(2);
    expect(r.contrapartes.map((c) => c.contraparte).sort()).toEqual(["Cliente A", "Cliente B"]);
  });

  it("por pagar solo suma pagos", () => {
    const r = calcularAging(mixto, HOY, "pago");
    expect(r.total).toBe(1000);
    expect(r.documentos).toBe(2);
    expect(r.contrapartes.map((c) => c.contraparte).sort()).toEqual(["Proveedor X", "Proveedor Y"]);
  });

  it("los totales de los dos lados nunca se suman entre si", () => {
    const cobrar = calcularAging(mixto, HOY, "cobranza").total;
    const pagar = calcularAging(mixto, HOY, "pago").total;
    // Cada lado responde a su propia pregunta; la suma no significa nada.
    expect(cobrar).not.toBe(pagar);
    expect(cobrar + pagar).toBe(2500);
  });

  it("un comprobante sin tipo cuenta como cobranza", () => {
    const r = calcularAging([cmp({ tipo: null, saldo: 400 })], HOY, "cobranza");
    expect(r.total).toBe(400);
    expect(calcularAging([cmp({ tipo: null, saldo: 400 })], HOY, "pago").total).toBe(0);
  });
});
