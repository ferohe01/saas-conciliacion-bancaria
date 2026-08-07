import { describe, it, expect } from "vitest";
import {
  PayloadConciliacion,
  CONFIG_CONCILIACION_DEFAULT,
  Cuadre,
  type PayloadConciliacion as PayloadType,
} from "@/lib/contract";

/**
 * Payload válido de referencia (basado en el ejemplo del contrato §7.2).
 * Los tests parten de esta base y mutan campos para verificar validaciones.
 */
function payloadBase(): PayloadType {
  return {
    job_id: "rec-2026-07-a8f3",
    metadata: {
      empresa_id: "emp_00123",
      usuario_id: "usr_0045",
      periodo: { desde: "2026-06-01", hasta: "2026-06-30" },
      cuenta: { banco: "BCP", numero: "****4521", moneda: "PEN" },
      saldos: {
        saldo_extracto_inicial: 45200.0,
        saldo_extracto_final: 58910.5,
        saldo_libros_final: 59340.5,
      },
      callback_url: "https://app.example.com/api/webhooks/resultado-conciliacion",
    },
    config: CONFIG_CONCILIACION_DEFAULT,
    registros_internos: [
      {
        id_interno: "REG-0001",
        fecha: "2026-06-15",
        monto: 4950.0,
        tipo: "cobranza",
        referencia: "F001-234",
        contraparte: "Ferretería Lima Norte EIRL",
        descripcion: "Pago factura F001-234",
      },
    ],
    movimientos_bancarios: [
      {
        id_movimiento: "BCO-0001",
        fecha: "2026-06-15",
        monto: 4945.0,
        tipo: "abono",
        glosa: "TRANSF CCE FERRETERIA LIMA",
        referencia_banco: "OP-778812",
      },
    ],
  };
}

describe("PayloadConciliacion", () => {
  it("acepta un payload válido de referencia", () => {
    const res = PayloadConciliacion.safeParse(payloadBase());
    expect(res.success).toBe(true);
  });

  it("rechaza un job_id con formato inválido", () => {
    const p = { ...payloadBase(), job_id: "abc-123" };
    const res = PayloadConciliacion.safeParse(p);
    expect(res.success).toBe(false);
  });

  it("rechaza fechas fuera de formato ISO", () => {
    const p = payloadBase();
    p.registros_internos[0]!.fecha = "15/06/2026";
    const res = PayloadConciliacion.safeParse(p);
    expect(res.success).toBe(false);
  });

  it("rechaza un período con desde posterior a hasta", () => {
    const p = payloadBase();
    p.metadata.periodo = { desde: "2026-06-30", hasta: "2026-06-01" };
    const res = PayloadConciliacion.safeParse(p);
    expect(res.success).toBe(false);
  });

  it("rechaza id_interno duplicados", () => {
    const p = payloadBase();
    p.registros_internos = [
      p.registros_internos[0]!,
      { ...p.registros_internos[0]!, monto: 100 },
    ];
    const res = PayloadConciliacion.safeParse(p);
    expect(res.success).toBe(false);
  });

  it("rechaza tipos de registro/movimiento fuera del enum", () => {
    const p = payloadBase() as unknown as Record<string, unknown>;
    (p.registros_internos as { tipo: string }[])[0]!.tipo = "abono"; // válido solo en bancarios
    const res = PayloadConciliacion.safeParse(p);
    expect(res.success).toBe(false);
  });

  it("exige al menos un registro y un movimiento", () => {
    const p = payloadBase();
    p.registros_internos = [];
    const res = PayloadConciliacion.safeParse(p);
    expect(res.success).toBe(false);
  });
});

describe("Cuadre — compatibilidad con resultados ya guardados", () => {
  /** El cuadre tal como lo escribía n8n antes de que existiera el renglón. */
  const antiguo = {
    saldo_extracto_final: 1000,
    depositos_en_transito: 0,
    cheques_no_cobrados: 0,
    cargos_no_registrados: 0,
    saldo_banco_ajustado: 1000,
    saldo_libros_final: 1000,
    diferencia: 0,
  };

  it("un cuadre sin `abonos_no_registrados` sigue siendo legible", () => {
    // Si el campo fuera obligatorio, TODO el histórico dejaría de abrirse: los
    // resultados viven como JSONB en la fila del job y no se migran.
    const r = Cuadre.safeParse(antiguo);
    expect(r.success).toBe(true);
  });

  it("y se rellena con 0, que es lo que valía entonces", () => {
    // Cero y no recalculado: los resultados antiguos no se reescriben hacia
    // atrás, así que el informe sigue diciendo lo que dijo el día que se emitió.
    expect(Cuadre.parse(antiguo).abonos_no_registrados).toBe(0);
  });
});
