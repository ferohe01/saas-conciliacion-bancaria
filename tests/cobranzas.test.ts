import { describe, it, expect } from "vitest";
import {
  calcularAplicaciones,
  estaConfirmado,
  type MatchLite,
} from "../src/lib/cobranzas";

const reg = (id: string, monto: number, comprobante_id?: string | null) => ({
  id_interno: id,
  monto,
  comprobante_id,
});
const mov = (id: string, monto: number) => ({ id_movimiento: id, monto });

describe("estaConfirmado", () => {
  const m = (estado_revision?: string) => ({
    ids_internos: [],
    ids_movimientos: [],
    estado_revision,
  });

  it("las conciliaciones AUTOMATICAS del motor cuentan", () => {
    // 'auto' es lo que emiten 01_exacta, 02_difusa y 03_ia por encima del
    // umbral. Omitirlo dejaba 29 de 33 pares sin descontar saldo.
    expect(estaConfirmado(m("auto"))).toBe(true);
  });

  it("lo que una persona confirmo cuenta", () => {
    expect(estaConfirmado(m("aceptado"))).toBe(true);
    expect(estaConfirmado(m("modificado"))).toBe(true);
  });

  it("lo pendiente y lo rechazado NO cobran nada", () => {
    expect(estaConfirmado(m("pendiente"))).toBe(false);
    expect(estaConfirmado(m("rechazado"))).toBe(false);
    expect(estaConfirmado(m())).toBe(false);
  });

  it("un estado inventado no concede cobro", () => {
    // 'manual' es un METODO, no un estado de revision. La primera version lo
    // incluia por error.
    expect(estaConfirmado(m("manual"))).toBe(false);
  });
});

describe("calcularAplicaciones", () => {
  it("1:1 exacto aplica el importe completo", () => {
    const m: MatchLite[] = [
      { ids_internos: ["REG-1"], ids_movimientos: ["MOV-1"], estado_revision: "aceptado" },
    ];
    const r = calcularAplicaciones(m, [reg("REG-1", 500, "c1")], [mov("MOV-1", 500)]);
    expect(r).toEqual([
      { comprobante_id: "c1", id_movimiento: "MOV-1", monto_aplicado: 500 },
    ]);
  });

  it("pago parcial deja saldo: entra menos de lo facturado", () => {
    const m: MatchLite[] = [
      { ids_internos: ["REG-1"], ids_movimientos: ["MOV-1"], estado_revision: "aceptado" },
    ];
    const r = calcularAplicaciones(m, [reg("REG-1", 1000, "c1")], [mov("MOV-1", 400)]);
    expect(r[0]!.monto_aplicado).toBe(400);
  });

  it("agrupación 1:N reparte el depósito entre las facturas", () => {
    // Un abono de 1000 que junta tres cuotas de 500, 300 y 200.
    const m: MatchLite[] = [
      {
        ids_internos: ["REG-1", "REG-2", "REG-3"],
        ids_movimientos: ["MOV-1"],
        estado_revision: "aceptado",
      },
    ];
    const r = calcularAplicaciones(
      m,
      [reg("REG-1", 500, "c1"), reg("REG-2", 300, "c2"), reg("REG-3", 200, "c3")],
      [mov("MOV-1", 1000)],
    );
    expect(r.map((x) => x.monto_aplicado)).toEqual([500, 300, 200]);
    expect(r.every((x) => x.id_movimiento === "MOV-1")).toBe(true);
  });

  it("N:1 (varios depósitos para una factura) suma lo que entró", () => {
    const m: MatchLite[] = [
      { ids_internos: ["REG-1"], ids_movimientos: ["MOV-1", "MOV-2"], estado_revision: "aceptado" },
    ];
    const r = calcularAplicaciones(
      m,
      [reg("REG-1", 1000, "c1")],
      [mov("MOV-1", 600), mov("MOV-2", 400)],
    );
    expect(r[0]!.monto_aplicado).toBe(1000);
    expect(r[0]!.id_movimiento).toBe("MOV-1+MOV-2");
  });

  it("si entró de más, NO se cobra más de lo que vale la factura", () => {
    const m: MatchLite[] = [
      { ids_internos: ["REG-1"], ids_movimientos: ["MOV-1"], estado_revision: "aceptado" },
    ];
    const r = calcularAplicaciones(m, [reg("REG-1", 500, "c1")], [mov("MOV-1", 520)]);
    expect(r[0]!.monto_aplicado).toBe(500);
  });

  it("los signos no importan: un pago va en negativo y se aplica igual", () => {
    const m: MatchLite[] = [
      { ids_internos: ["REG-1"], ids_movimientos: ["MOV-1"], estado_revision: "aceptado" },
    ];
    const r = calcularAplicaciones(m, [reg("REG-1", -800, "c1")], [mov("MOV-1", -800)]);
    expect(r[0]!.monto_aplicado).toBe(800);
  });

  it("un match sin comprobante detrás (fuente Excel) no genera nada", () => {
    const m: MatchLite[] = [
      { ids_internos: ["REG-1"], ids_movimientos: ["MOV-1"], estado_revision: "aceptado" },
    ];
    expect(calcularAplicaciones(m, [reg("REG-1", 500, null)], [mov("MOV-1", 500)])).toEqual([]);
  });

  it("un match automatico del motor SI descuenta saldo", () => {
    const m: MatchLite[] = [
      { ids_internos: ["REG-1"], ids_movimientos: ["MOV-1"], estado_revision: "auto" },
    ];
    const r = calcularAplicaciones(m, [reg("REG-1", 900, "c1")], [mov("MOV-1", 900)]);
    expect(r[0]!.monto_aplicado).toBe(900);
  });

  it("una sugerencia sin revisar no toca ningún saldo", () => {
    const m: MatchLite[] = [
      { ids_internos: ["REG-1"], ids_movimientos: ["MOV-1"], estado_revision: "pendiente" },
    ];
    expect(calcularAplicaciones(m, [reg("REG-1", 500, "c1")], [mov("MOV-1", 500)])).toEqual([]);
  });

  it("sin datos del movimiento (extracto PDF) asume cobro completo", () => {
    const m: MatchLite[] = [
      { ids_internos: ["REG-1"], ids_movimientos: ["MOV-1"], estado_revision: "aceptado" },
    ];
    const r = calcularAplicaciones(m, [reg("REG-1", 750, "c1")], []);
    expect(r[0]!.monto_aplicado).toBe(750);
  });

  it("la clave del movimiento es estable aunque cambie el orden", () => {
    const base = { ids_internos: ["REG-1"], estado_revision: "aceptado" };
    const a = calcularAplicaciones(
      [{ ...base, ids_movimientos: ["MOV-2", "MOV-1"] }],
      [reg("REG-1", 100, "c1")], [mov("MOV-1", 50), mov("MOV-2", 50)],
    );
    const b = calcularAplicaciones(
      [{ ...base, ids_movimientos: ["MOV-1", "MOV-2"] }],
      [reg("REG-1", 100, "c1")], [mov("MOV-1", 50), mov("MOV-2", 50)],
    );
    expect(a[0]!.id_movimiento).toBe(b[0]!.id_movimiento);
  });

  it("redondea a dos decimales: no deja céntimos fantasma", () => {
    const m: MatchLite[] = [
      { ids_internos: ["REG-1", "REG-2"], ids_movimientos: ["MOV-1"], estado_revision: "aceptado" },
    ];
    const r = calcularAplicaciones(
      m,
      [reg("REG-1", 100, "c1"), reg("REG-2", 200, "c2")],
      [mov("MOV-1", 100)],
    );
    expect(r.map((x) => x.monto_aplicado)).toEqual([33.33, 66.67]);
  });
});

describe("diferencias absorbidas (comisión, redondeo)", () => {
  const TOL = { tolerancia_monto_abs: 5, tolerancia_monto_pct: 0.5 };
  const conCategoria = (categoria: string): MatchLite[] => [
    {
      ids_internos: ["REG-1"],
      ids_movimientos: ["MOV-1"],
      estado_revision: "auto",
      categoria_diferencia: categoria,
    },
  ];

  it("una comisión bancaria deja la factura COBRADA, no en parcial", () => {
    // Facturas de 1850, el banco abona 1846.50: la comisión no es deuda.
    const r = calcularAplicaciones(
      conCategoria("comision_bancaria"),
      [reg("REG-1", 1850, "c1")],
      [mov("MOV-1", 1846.5)],
      TOL,
    );
    expect(r[0]!.monto_aplicado).toBe(1850);
  });

  it("el redondeo también se absorbe", () => {
    const r = calcularAplicaciones(
      conCategoria("redondeo"),
      [reg("REG-1", 990, "c1")],
      [mov("MOV-1", 989.5)],
      TOL,
    );
    expect(r[0]!.monto_aplicado).toBe(990);
  });

  it("NO se absorbe si el faltante excede las tolerancias de la empresa", () => {
    // Etiquetado como comisión pero faltan 200: eso no es una comisión.
    // Sin este límite, un match mal categorizado cerraría una factura impagada.
    const r = calcularAplicaciones(
      conCategoria("comision_bancaria"),
      [reg("REG-1", 1000, "c1")],
      [mov("MOV-1", 800)],
      TOL,
    );
    expect(r[0]!.monto_aplicado).toBe(800);
  });

  it("un pago parcial NO se absorbe: ahí falta dinero de verdad", () => {
    const r = calcularAplicaciones(
      conCategoria("pago_parcial"),
      [reg("REG-1", 1000, "c1")],
      [mov("MOV-1", 998)],
      TOL,
    );
    expect(r[0]!.monto_aplicado).toBe(998);
  });

  it("sin tolerancias configuradas no se absorbe nada", () => {
    const r = calcularAplicaciones(
      conCategoria("comision_bancaria"),
      [reg("REG-1", 1850, "c1")],
      [mov("MOV-1", 1846.5)],
    );
    expect(r[0]!.monto_aplicado).toBe(1846.5);
  });

  it("el porcentaje también sirve de límite en importes grandes", () => {
    // 0.5% de 50000 = 250, asi que un faltante de 200 entra.
    const r = calcularAplicaciones(
      conCategoria("comision_bancaria"),
      [reg("REG-1", 50000, "c1")],
      [mov("MOV-1", 49800)],
      TOL,
    );
    expect(r[0]!.monto_aplicado).toBe(50000);
  });
});

describe("tope por saldo disponible (doble descuento)", () => {
  const match: MatchLite = {
    ids_internos: ["REG-1"],
    ids_movimientos: ["MOV-1"],
    estado_revision: "aceptado",
  };
  const registros = [reg("REG-1", 1000, "comp-1")];
  const movimientos = [mov("MOV-1", 1000)];

  it("sin mapa de disponibles aplica el importe completo (comportamiento previo)", () => {
    const r = calcularAplicaciones(match ? [match] : [], registros, movimientos, {});
    expect(r[0]!.monto_aplicado).toBe(1000);
  });

  /*
   * El caso que motivó el arreglo: la misma factura conciliada desde dos
   * cuentas bancarias distintas en el mismo período. Ambas conciliaciones
   * pueden estar aprobadas a la vez —son extractos distintos— y antes cada una
   * descontaba el importe COMPLETO, dejando el saldo en negativo sin avisar.
   */
  it("una factura ya cobrada por otro job no recibe nada", () => {
    const r = calcularAplicaciones(
      [match],
      registros,
      movimientos,
      {},
      new Map([["comp-1", 0]]),
    );
    expect(r).toHaveLength(0);
  });

  it("si le queda menos de lo que entró, se aplica solo lo que le queda", () => {
    const r = calcularAplicaciones(
      [match],
      registros,
      movimientos,
      {},
      new Map([["comp-1", 300]]),
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.monto_aplicado).toBe(300);
  });

  it("dos matches del mismo job no se pasan entre los dos", () => {
    const dos: MatchLite[] = [
      { ids_internos: ["REG-1"], ids_movimientos: ["MOV-1"], estado_revision: "aceptado" },
      { ids_internos: ["REG-2"], ids_movimientos: ["MOV-2"], estado_revision: "aceptado" },
    ];
    const r = calcularAplicaciones(
      dos,
      [reg("REG-1", 600, "comp-1"), reg("REG-2", 600, "comp-1")],
      [mov("MOV-1", 600), mov("MOV-2", 600)],
      {},
      new Map([["comp-1", 1000]]),
    );
    const total = r.reduce((s, a) => s + a.monto_aplicado, 0);
    expect(total).toBe(1000); // 600 + 400, no 1200
  });

  it("un comprobante que no está en el mapa no recibe nada", () => {
    const r = calcularAplicaciones([match], registros, movimientos, {}, new Map());
    expect(r).toHaveLength(0);
  });
});
