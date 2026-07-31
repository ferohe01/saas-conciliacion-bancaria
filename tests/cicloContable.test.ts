import { describe, it, expect } from "vitest";
import {
  ESTADOS_CONTABLES,
  afectaSaldo,
  accionesPosibles,
  puede,
  esTerminal,
  destino,
  puedeAprobarse,
  ETIQUETA,
  EXPLICACION,
  type EstadoContable,
} from "@/lib/cicloContable";

describe("afectaSaldo", () => {
  it("solo la aprobada mueve el saldo de los comprobantes", () => {
    expect(afectaSaldo("aprobada")).toBe(true);
    for (const e of ESTADOS_CONTABLES.filter((x) => x !== "aprobada")) {
      expect(afectaSaldo(e)).toBe(false);
    }
  });

  // El bug que esto previene: dos corridas del mismo período con decisiones
  // confirmadas descontaban el saldo dos veces.
  it("un borrador con decisiones confirmadas NO mueve saldo", () => {
    expect(afectaSaldo("borrador")).toBe(false);
  });

  it("una reemplazada deja de mover saldo", () => {
    expect(afectaSaldo("reemplazada")).toBe(false);
  });
});

describe("transiciones", () => {
  it("anulada y reemplazada son terminales", () => {
    expect(esTerminal("anulada")).toBe(true);
    expect(esTerminal("reemplazada")).toBe(true);
    expect(accionesPosibles("anulada")).toHaveLength(0);
    expect(accionesPosibles("reemplazada")).toHaveLength(0);
  });

  it("un borrador puede aprobarse, observarse o anularse, pero no reabrirse", () => {
    expect(puede("borrador", "aprobar")).toBe(true);
    expect(puede("borrador", "observar")).toBe(true);
    expect(puede("borrador", "anular")).toBe(true);
    expect(puede("borrador", "reabrir")).toBe(false);
  });

  it("una observada puede reabrirse o aprobarse", () => {
    expect(puede("observada", "reabrir")).toBe(true);
    expect(puede("observada", "aprobar")).toBe(true);
  });

  it("una aprobada no vuelve a aprobarse", () => {
    expect(puede("aprobada", "aprobar")).toBe(false);
    expect(puede("aprobada", "anular")).toBe(true);
  });

  it("`reemplazada` no es destino de ninguna acción: la pone la base al aprobar otra", () => {
    const destinos = (["aprobar", "observar", "anular", "reabrir"] as const).map(destino);
    expect(destinos).not.toContain("reemplazada");
  });

  it("cada acción lleva a un estado válido", () => {
    for (const a of ["aprobar", "observar", "anular", "reabrir"] as const) {
      expect(ESTADOS_CONTABLES).toContain(destino(a));
    }
  });
});

describe("puedeAprobarse", () => {
  it("no aprueba lo que n8n aún no terminó", () => {
    const r = puedeAprobarse("borrador", "procesando");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/no ha terminado/i);
  });

  it("no aprueba un job en error aunque el estado contable lo permita", () => {
    expect(puedeAprobarse("borrador", "error").ok).toBe(false);
  });

  it("aprueba un borrador ya procesado", () => {
    expect(puedeAprobarse("borrador", "completado").ok).toBe(true);
  });

  it("explica por qué no puede aprobarse una ya aprobada", () => {
    const r = puedeAprobarse("aprobada", "completado");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/ya está aprobada/i);
  });

  it("una anulada no revive aprobándola", () => {
    expect(puedeAprobarse("anulada", "completado").ok).toBe(false);
  });
});

describe("textos de interfaz", () => {
  it("todos los estados tienen etiqueta y explicación", () => {
    for (const e of ESTADOS_CONTABLES) {
      expect(ETIQUETA[e as EstadoContable]).toBeTruthy();
      expect(EXPLICACION[e as EstadoContable]).toBeTruthy();
    }
  });
});
