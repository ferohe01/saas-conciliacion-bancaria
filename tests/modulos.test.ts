import { describe, it, expect } from "vitest";
import {
  MODULOS,
  buscarModulo,
  estadoModulo,
  tieneModulo,
  avisoModuloPorVencer,
} from "../src/lib/modulos";

const AHORA = new Date("2026-07-29T12:00:00Z");
const dias = (n: number) =>
  new Date(AHORA.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

describe("catálogo", () => {
  it("los ids no se repiten", () => {
    expect(new Set(MODULOS.map((m) => m.id)).size).toBe(MODULOS.length);
  });

  it("buscarModulo encuentra y descarta", () => {
    expect(buscarModulo("cobranzas")?.nombre).toBe("Cuentas por cobrar");
    expect(buscarModulo("inventado")).toBeUndefined();
  });
});

describe("estadoModulo", () => {
  it("sin suscripción NO está activo: un módulo de pago no se regala", () => {
    expect(estadoModulo("cobranzas", [], AHORA).activo).toBe(false);
    expect(estadoModulo("cobranzas", null, AHORA).activo).toBe(false);
    expect(estadoModulo("cobranzas", undefined, AHORA).activo).toBe(false);
  });

  it("suscripción vigente está activa y cuenta los días", () => {
    const e = estadoModulo(
      "cobranzas",
      [{ modulo: "cobranzas", activo_hasta: dias(12) }],
      AHORA,
    );
    expect(e.activo).toBe(true);
    expect(e.diasRestantes).toBe(12);
  });

  it("suscripción vencida deja de estar activa", () => {
    const e = estadoModulo(
      "cobranzas",
      [{ modulo: "cobranzas", activo_hasta: dias(-1) }],
      AHORA,
    );
    expect(e.activo).toBe(false);
    expect(e.diasRestantes).toBe(0);
  });

  it("el vencimiento exacto ya corta", () => {
    const e = estadoModulo(
      "cobranzas",
      [{ modulo: "cobranzas", activo_hasta: AHORA.toISOString() }],
      AHORA,
    );
    expect(e.activo).toBe(false);
  });

  it("sin fecha = sin vencimiento (cortesía o acuerdo especial)", () => {
    const e = estadoModulo(
      "cobranzas",
      [{ modulo: "cobranzas", activo_hasta: null }],
      AHORA,
    );
    expect(e.activo).toBe(true);
    expect(e.fin).toBeNull();
    expect(e.diasRestantes).toBeNull();
  });

  it("una fecha corrupta NO concede acceso", () => {
    const e = estadoModulo(
      "cobranzas",
      [{ modulo: "cobranzas", activo_hasta: "no-es-fecha" }],
      AHORA,
    );
    expect(e.activo).toBe(false);
  });

  it("la suscripción de otro módulo no sirve para este", () => {
    const e = estadoModulo(
      "cobranzas",
      [{ modulo: "otro-modulo", activo_hasta: dias(30) }],
      AHORA,
    );
    expect(e.activo).toBe(false);
  });

  it("tieneModulo es el atajo de lo mismo", () => {
    const s = [{ modulo: "cobranzas", activo_hasta: dias(5) }];
    expect(tieneModulo("cobranzas", s, AHORA)).toBe(true);
    expect(tieneModulo("cobranzas", [], AHORA)).toBe(false);
  });
});

describe("avisoModuloPorVencer", () => {
  it("calla si falta más de una semana", () => {
    const e = estadoModulo("cobranzas", [{ modulo: "cobranzas", activo_hasta: dias(9) }], AHORA);
    expect(avisoModuloPorVencer(e)).toBeNull();
  });

  it("avisa en la última semana", () => {
    const e = estadoModulo("cobranzas", [{ modulo: "cobranzas", activo_hasta: dias(4) }], AHORA);
    expect(avisoModuloPorVencer(e)).toBe("Vence en 4 días.");
  });

  it("el último día tiene su propio texto", () => {
    const e = estadoModulo("cobranzas", [{ modulo: "cobranzas", activo_hasta: dias(0.4) }], AHORA);
    expect(avisoModuloPorVencer(e)).toBe("Vence hoy.");
  });

  it("no avisa de lo que no caduca ni de lo que ya venció", () => {
    const sinFin = estadoModulo("cobranzas", [{ modulo: "cobranzas", activo_hasta: null }], AHORA);
    const vencido = estadoModulo("cobranzas", [{ modulo: "cobranzas", activo_hasta: dias(-2) }], AHORA);
    expect(avisoModuloPorVencer(sinFin)).toBeNull();
    expect(avisoModuloPorVencer(vencido)).toBeNull();
  });
});
