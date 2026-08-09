import { describe, it, expect } from "vitest";
import {
  MODULOS,
  buscarModulo,
  estadoModulo,
  tieneModulo,
  avisoModuloPorVencer,
  type AccesoCuenta,
} from "../src/lib/modulos";

const AHORA = new Date("2026-07-29T12:00:00Z");
const dias = (n: number) =>
  new Date(AHORA.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

/** Prueba gratuita en curso, tal como la construye `modulos-servidor`. */
const enPrueba = (diasRestantes = 18): AccesoCuenta => ({
  motivo: "prueba",
  fin: new Date(dias(diasRestantes)),
  diasRestantes,
});

/** Cliente de pago: el plan no caduca por módulo. */
const dePago: AccesoCuenta = { motivo: "plan", fin: null, diasRestantes: null };

describe("catálogo", () => {
  it("los ids no se repiten", () => {
    expect(new Set(MODULOS.map((m) => m.id)).size).toBe(MODULOS.length);
  });

  it("buscarModulo encuentra y descarta", () => {
    expect(buscarModulo("cobranzas")?.nombre).toBe("Cuentas por cobrar y pagar");
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

describe("el sistema se vende entero", () => {
  it("el plan de pago incluye el módulo: no hay nada que comprar aparte", () => {
    const e = estadoModulo("cobranzas", [], AHORA, dePago);
    expect(e.activo).toBe(true);
    expect(e.origen).toBe("plan");
  });

  it("y el plan no le pone fecha de caducidad a un módulo", () => {
    const e = estadoModulo("cobranzas", [], AHORA, dePago);
    expect(e.fin).toBeNull();
    expect(e.diasRestantes).toBeNull();
    expect(avisoModuloPorVencer(e)).toBeNull();
  });

  it("una suscripción de módulo vencida NO cierra nada a quien paga", () => {
    const e = estadoModulo(
      "cobranzas",
      [{ modulo: "cobranzas", activo_hasta: dias(-30) }],
      AHORA,
      dePago,
    );
    expect(e.activo).toBe(true);
    expect(e.origen).toBe("plan");
  });

  it("pagar y probar dan el mismo acceso: es la promesa del producto", () => {
    expect(tieneModulo("cobranzas", [], AHORA, dePago)).toBe(
      tieneModulo("cobranzas", [], AHORA, enPrueba()),
    );
  });

  it("sin contratar nada, durante la prueba el módulo está activo", () => {
    const e = estadoModulo("cobranzas", [], AHORA, enPrueba());
    expect(e.activo).toBe(true);
    expect(e.origen).toBe("prueba");
    expect(e.diasRestantes).toBe(18);
  });

  it("es la MISMA regla que usa el control de acceso", () => {
    expect(tieneModulo("cobranzas", [], AHORA, enPrueba())).toBe(true);
    expect(tieneModulo("cobranzas", null, AHORA, enPrueba())).toBe(true);
  });

  it("el ÚNICO estado que cierra un módulo es la prueba vencida sin activar", () => {
    expect(tieneModulo("cobranzas", [], AHORA, null)).toBe(false);
    expect(estadoModulo("cobranzas", [], AHORA, null).origen).toBeNull();
  });

  it("una concesión suelta vigente manda sobre la prueba: sobrevive al día 31", () => {
    const e = estadoModulo(
      "cobranzas",
      [{ modulo: "cobranzas", activo_hasta: dias(60) }],
      AHORA,
      enPrueba(),
    );
    expect(e.origen).toBe("contratado");
    expect(e.diasRestantes).toBe(60);
  });

  it("una suscripción vencida no quita lo que la prueba concede", () => {
    const e = estadoModulo(
      "cobranzas",
      [{ modulo: "cobranzas", activo_hasta: dias(-3) }],
      AHORA,
      enPrueba(),
    );
    expect(e.activo).toBe(true);
    expect(e.origen).toBe("prueba");
  });

  it("una fecha corrupta tampoco: la prueba sigue abriendo", () => {
    const e = estadoModulo(
      "cobranzas",
      [{ modulo: "cobranzas", activo_hasta: "no-es-fecha" }],
      AHORA,
      enPrueba(),
    );
    expect(e.activo).toBe(true);
    expect(e.origen).toBe("prueba");
  });

  it("sin fecha de fin de prueba conocida, sigue abriendo", () => {
    const e = estadoModulo("cobranzas", [], AHORA, {
      motivo: "prueba",
      fin: null,
      diasRestantes: 30,
    });
    expect(e.activo).toBe(true);
    expect(e.fin).toBeNull();
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

  it("en la prueba dice que lo que termina es la PRUEBA, no el módulo", () => {
    const e = estadoModulo("cobranzas", [], AHORA, enPrueba(4));
    expect(avisoModuloPorVencer(e)).toBe("Tu prueba termina en 4 días.");
    expect(avisoModuloPorVencer(estadoModulo("cobranzas", [], AHORA, enPrueba(1)))).toBe(
      "Tu prueba termina hoy.",
    );
    expect(avisoModuloPorVencer(estadoModulo("cobranzas", [], AHORA, enPrueba(20)))).toBeNull();
  });

  it("no avisa de lo que no caduca ni de lo que ya venció", () => {
    const sinFin = estadoModulo("cobranzas", [{ modulo: "cobranzas", activo_hasta: null }], AHORA);
    const vencido = estadoModulo("cobranzas", [{ modulo: "cobranzas", activo_hasta: dias(-2) }], AHORA);
    expect(avisoModuloPorVencer(sinFin)).toBeNull();
    expect(avisoModuloPorVencer(vencido)).toBeNull();
  });
});
