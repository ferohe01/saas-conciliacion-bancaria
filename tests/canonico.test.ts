import { describe, it, expect } from "vitest";
import {
  normalizarInternos,
  normalizarBancarios,
} from "@/lib/normalizacion/canonico";
import { PayloadConciliacion } from "@/lib/contract";

const filasInternos = [
  { Fecha: "15/06/2026", Importe: "4,950.00", Tipo: "cobranza", Ref: "F001-234" },
  { Fecha: "16/06/2026", Importe: "1,200.00", Tipo: "pago", Ref: "F001-235" },
  { Fecha: "basura", Importe: "abc", Tipo: "", Ref: "" }, // inválida
];

const filasBanco = [
  { "Fecha Mov.": "15/06/2026", Monto: "4945.00", Glosa: "TRANSF" },
  { "Fecha Mov.": "16/06/2026", Monto: "-1200.00", Glosa: "PAGO SERV" },
];

describe("normalizarInternos", () => {
  it("aplica convención de signos y descarta inválidas", () => {
    const mapeo = {
      fecha: "Fecha",
      monto: "Importe",
      tipo: "Tipo",
      referencia: "Ref",
    };
    const r = normalizarInternos(filasInternos, mapeo);
    expect(r.filas).toHaveLength(2);
    expect(r.invalidas).toBe(1);
    // cobranza → positivo, pago → negativo
    expect(r.filas[0]!.monto).toBeCloseTo(4950);
    expect(r.filas[0]!.tipo).toBe("cobranza");
    expect(r.filas[1]!.monto).toBeCloseTo(-1200);
    expect(r.filas[1]!.tipo).toBe("pago");
    // IDs únicos con prefijo
    expect(r.filas[0]!.id_interno).toBe("REG-0001");
  });

  it("infiere dirección por el signo cuando no hay columna tipo", () => {
    const mapeo = { fecha: "Fecha", monto: "Monto" };
    const filas = [{ Fecha: "15/06/2026", Monto: "-500" }];
    const r = normalizarInternos(filas, mapeo);
    expect(r.filas[0]!.tipo).toBe("pago");
    expect(r.filas[0]!.monto).toBeCloseTo(-500);
  });
});

describe("normalizarBancarios", () => {
  it("infiere abono/cargo por el signo del monto", () => {
    const mapeo = { fecha: "Fecha Mov.", monto: "Monto", descripcion: "Glosa" };
    const r = normalizarBancarios(filasBanco, mapeo);
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0]!.tipo).toBe("abono");
    expect(r.filas[0]!.monto).toBeCloseTo(4945);
    expect(r.filas[1]!.tipo).toBe("cargo");
    expect(r.filas[1]!.monto).toBeCloseTo(-1200);
    expect(r.filas[0]!.id_movimiento).toBe("BCO-0001");
  });
});

describe("integración con el contrato", () => {
  it("las filas normalizadas forman un payload válido", () => {
    const internos = normalizarInternos(filasInternos, {
      fecha: "Fecha",
      monto: "Importe",
      tipo: "Tipo",
      referencia: "Ref",
    }).filas;
    const bancarios = normalizarBancarios(filasBanco, {
      fecha: "Fecha Mov.",
      monto: "Monto",
      descripcion: "Glosa",
    }).filas;

    const payload = {
      job_id: "rec-2026-06-ab12",
      metadata: {
        empresa_id: "emp_1",
        usuario_id: "usr_1",
        periodo: { desde: "2026-06-01", hasta: "2026-06-30" },
        cuenta: { banco: "BCP", numero: "****4521", moneda: "PEN" },
        saldos: { saldo_libros_final: 1000 },
        callback_url: "https://app.example.com/api/webhooks/resultado-conciliacion",
      },
      config: {
        tolerancia_monto_abs: 5,
        tolerancia_monto_pct: 0.5,
        tolerancia_dias: 3,
        umbral_confianza_auto: 0.95,
      },
      registros_internos: internos,
      movimientos_bancarios: bancarios,
    };

    const res = PayloadConciliacion.safeParse(payload);
    expect(res.success).toBe(true);
  });
});
