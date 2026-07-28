import { describe, it, expect } from "vitest";
import {
  estadoSuscripcion,
  avisoPorVencer,
  montoPEN,
  PLANES_SUSCRIPCION,
  DATOS_PAGO,
  DIAS_PRUEBA,
} from "../src/lib/suscripcion";

const AHORA = new Date("2026-07-27T12:00:00Z");
const dias = (n: number) =>
  new Date(AHORA.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

describe("estadoSuscripcion", () => {
  it("plan activo no caduca nunca", () => {
    const e = estadoSuscripcion(
      { plan: "activo", prueba_hasta: dias(-90) },
      AHORA,
    );
    expect(e.puedeConciliar).toBe(true);
    expect(e.expirada).toBe(false);
    expect(e.fin).toBeNull();
  });

  it("prueba vigente permite conciliar y cuenta los días", () => {
    const e = estadoSuscripcion({ plan: "prueba", prueba_hasta: dias(10) }, AHORA);
    expect(e.puedeConciliar).toBe(true);
    expect(e.expirada).toBe(false);
    expect(e.diasRestantes).toBe(10);
  });

  it("prueba vencida bloquea y deja los días en cero", () => {
    const e = estadoSuscripcion({ plan: "prueba", prueba_hasta: dias(-1) }, AHORA);
    expect(e.puedeConciliar).toBe(false);
    expect(e.expirada).toBe(true);
    expect(e.diasRestantes).toBe(0);
  });

  it("el vencimiento exacto ya bloquea", () => {
    const e = estadoSuscripcion(
      { plan: "prueba", prueba_hasta: AHORA.toISOString() },
      AHORA,
    );
    expect(e.expirada).toBe(true);
    expect(e.puedeConciliar).toBe(false);
  });

  it("sin prueba_hasta usa created_at + 30 días", () => {
    const vigente = estadoSuscripcion({ created_at: dias(-10) }, AHORA);
    expect(vigente.puedeConciliar).toBe(true);
    expect(vigente.diasRestantes).toBe(DIAS_PRUEBA - 10);

    const vencida = estadoSuscripcion({ created_at: dias(-31) }, AHORA);
    expect(vencida.puedeConciliar).toBe(false);
    expect(vencida.expirada).toBe(true);
  });

  it("prueba_hasta manda sobre created_at (permite extender a mano)", () => {
    const e = estadoSuscripcion(
      { created_at: dias(-100), prueba_hasta: dias(5) },
      AHORA,
    );
    expect(e.puedeConciliar).toBe(true);
    expect(e.diasRestantes).toBe(5);
  });

  it("sin ninguna fecha no bloquea: un dato ausente no deja fuera a un cliente", () => {
    const e = estadoSuscripcion({}, AHORA);
    expect(e.puedeConciliar).toBe(true);
    expect(e.expirada).toBe(false);
  });

  it("una fecha inválida se trata como ausente", () => {
    const e = estadoSuscripcion({ prueba_hasta: "no-es-fecha" }, AHORA);
    expect(e.puedeConciliar).toBe(true);
  });

  it("un plan desconocido se degrada a 'prueba', no a acceso libre", () => {
    const e = estadoSuscripcion(
      { plan: "premium-inventado", prueba_hasta: dias(-1) },
      AHORA,
    );
    expect(e.plan).toBe("prueba");
    expect(e.puedeConciliar).toBe(false);
  });
});

describe("avisoPorVencer", () => {
  it("calla si faltan más de 7 días", () => {
    expect(avisoPorVencer(estadoSuscripcion({ prueba_hasta: dias(8) }, AHORA))).toBeNull();
  });

  it("avisa en la última semana", () => {
    expect(avisoPorVencer(estadoSuscripcion({ prueba_hasta: dias(5) }, AHORA))).toBe(
      "Tu prueba termina en 5 días.",
    );
  });

  it("el último día tiene su propio texto", () => {
    expect(
      avisoPorVencer(estadoSuscripcion({ prueba_hasta: dias(0.5) }, AHORA)),
    ).toBe("Tu prueba termina hoy.");
  });

  it("no avisa si ya venció (para eso está el bloqueo)", () => {
    expect(avisoPorVencer(estadoSuscripcion({ prueba_hasta: dias(-1) }, AHORA))).toBeNull();
  });

  it("no avisa en plan activo", () => {
    expect(avisoPorVencer(estadoSuscripcion({ plan: "activo" }, AHORA))).toBeNull();
  });
});

describe("datos comerciales", () => {
  it("montoPEN muestra siempre dos decimales", () => {
    expect(montoPEN(99.9)).toBe("S/ 99.90");
    expect(montoPEN(1199.9)).toBe("S/ 1,199.90");
    expect(montoPEN(0)).toBe("S/ 0.00");
  });

  it("los dos planes existen con sus importes", () => {
    const porId = Object.fromEntries(
      PLANES_SUSCRIPCION.map((p) => [p.id, p.monto]),
    );
    expect(porId.mensual).toBe(99.9);
    expect(porId.anual).toBe(1199.9);
  });

  it("el CCI tiene los 20 digitos que exige el formato peruano", () => {
    expect(DATOS_PAGO.cci).toMatch(/^\d{20}$/);
  });

  it("el numero de cuenta conserva su formato con guiones", () => {
    expect(DATOS_PAGO.numero).toMatch(/^\d{3}-\d{8}-\d{3}$/);
  });
});
