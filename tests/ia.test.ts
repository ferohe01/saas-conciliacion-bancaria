import { describe, it, expect } from "vitest";
import { verificarCifras } from "../src/lib/ia/verificacion";
import {
  promptRevisionPrevia,
  promptPartida,
  promptSeguimiento,
  contextoRevisionPrevia,
  MAX_TURNOS,
  MAX_PREGUNTA,
} from "../src/lib/ia/prompts";
import { evaluarDiagnostico, type ContadoresPrevios } from "../src/lib/diagnosticoPrevio";
import type { Diagnostico } from "../src/lib/diagnosticoPartida";

describe("verificarCifras — ninguna cifra que el modelo no haya recibido", () => {
  const CONTEXTO =
    "Casarían 12 de 450,999 movimientos (0 %). Hay 452,177 comprobantes. " +
    "Diferencia de 4.50.";

  it("deja pasar lo que sí estaba", () => {
    const r = verificarCifras(
      "De tus 450,999 movimientos solo casarían 12.",
      CONTEXTO,
    );
    expect(r.ok).toBe(true);
  });

  it("⚠️ ATRAPA una cifra inventada, que es todo el propósito", () => {
    const r = verificarCifras(
      "De tus 450,999 movimientos casarían 380,000.",
      CONTEXTO,
    );
    expect(r.ok).toBe(false);
    expect(r.intrusas).toContain("380,000");
  });

  it("acepta redondeos: 99.03 % puede decirse como 99 %", () => {
    expect(verificarCifras("Cerca del 99 %.", "cobertura 99.03 %").ok).toBe(true);
    expect(verificarCifras("Un 99.0 %.", "cobertura 99.03 %").ok).toBe(true);
  });

  it("acepta enteros pequeños que son prosa, no datos", () => {
    const r = verificarCifras("Hay 2 cosas que revisar y 3 opciones.", CONTEXTO);
    expect(r.ok).toBe(true);
  });

  it("pero un número grande inventado no pasa por 'prosa'", () => {
    expect(verificarCifras("Son unos 5,000 casos.", CONTEXTO).ok).toBe(false);
  });

  it("lee el número en los dos formatos: nadie debe fallar por el separador", () => {
    expect(verificarCifras("1.234,50", "importe 1,234.50").ok).toBe(true);
  });

  it("una respuesta sin cifras siempre es verificable", () => {
    expect(verificarCifras("Revisa la columna de referencia.", "").ok).toBe(true);
  });

  it("no repite la misma intrusa dos veces", () => {
    const r = verificarCifras("Son 999,999 y otra vez 999,999.", CONTEXTO);
    expect(r.intrusas).toEqual(["999,999"]);
  });
});

describe("el contexto NO crece con los datos del cliente", () => {
  const contadores = (n: number): ContadoresPrevios => ({
    internos: n,
    internos_con_ref: n,
    internos_ref_repetida: 0,
    movimientos: n,
    movimientos_con_ref: 0,
    movimientos_ref_repetida: 0,
    movimientos_abono: n,
    movimientos_cargo: 1,
    movimientos_fuera: 0,
    movimientos_dia_bajo: 1,
    refs_compartidas: 0,
    pares_estimados: 0,
  });

  it("un cliente 400 veces mayor no produce un prompt 400 veces mayor", () => {
    const chico = contextoRevisionPrevia(evaluarDiagnostico(contadores(1_000), 20_000));
    const grande = contextoRevisionPrevia(
      evaluarDiagnostico(contadores(452_177), 500_000),
    );
    // Solo cambian los dígitos de las cifras, no el número de hallazgos.
    expect(Math.abs(grande.length - chico.length)).toBeLessThan(100);
  });

  it("el prompt entero cabe de sobra: aquí no se mandan filas", () => {
    const { mensajes } = promptRevisionPrevia(
      evaluarDiagnostico(contadores(452_177), 500_000),
    );
    const total = mensajes.map((m) => m.content).join("").length;
    expect(total).toBeLessThan(4_000);
  });
});

describe("prompts", () => {
  const HALLAZGOS = evaluarDiagnostico(
    {
      internos: 100,
      internos_con_ref: 100,
      internos_ref_repetida: 0,
      movimientos: 100,
      movimientos_con_ref: 0,
      movimientos_ref_repetida: 0,
      movimientos_abono: 90,
      movimientos_cargo: 10,
      movimientos_fuera: 0,
      movimientos_dia_bajo: 10,
      refs_compartidas: 0,
      pares_estimados: 0,
    },
    20_000,
  );

  it("el sistema prohíbe inventar cifras y calcular", () => {
    const sistema = promptRevisionPrevia(HALLAZGOS).mensajes[0]!.content;
    expect(sistema).toContain("No inventes");
    expect(sistema).toContain("No calcules");
  });

  it("prohíbe además afirmar por qué decidió el motor", () => {
    const sistema = promptRevisionPrevia(HALLAZGOS).mensajes[0]!.content;
    expect(sistema).toContain("No afirmes por qué el motor");
  });

  it("⚠️ el contexto devuelto es EXACTAMENTE lo que va en el mensaje", () => {
    // Verificar contra otra cosa haría que la comprobación dejara de decir lo
    // que promete.
    const { mensajes, contexto } = promptRevisionPrevia(HALLAZGOS);
    expect(mensajes[1]!.content).toContain(contexto);
  });

  it("toda cifra del contexto de partida sale de la evidencia recibida", () => {
    const d: Diagnostico = {
      codigo: "ya_emparejado",
      titulo: "Se lo llevó otra partida",
      detalle: "El movimiento ya quedó emparejado con REG-0002.",
      accion: "Deshaz el otro par.",
      evidencia: [
        {
          id: "BCO-1",
          fecha: "2026-07-03",
          monto: 99,
          texto: "DEPOSITO",
          referencia: "SR1102748951",
          ocupadoPor: "REG-0002",
        },
      ],
    };
    const { contexto } = promptPartida(d);
    expect(contexto).toContain("99");
    expect(contexto).toContain("2026-07-03");
    expect(verificarCifras("El movimiento de 99 del 2026-07-03.", contexto).ok).toBe(
      true,
    );
  });
});

describe("repreguntas acotadas (fase 4)", () => {
  const base = promptRevisionPrevia([]).mensajes;

  it("conserva el system y el contexto en cada turno", () => {
    const m = promptSeguimiento(base, [], "¿y si no tengo esa columna?");
    expect(m[0]).toEqual(base[0]);
    expect(m[m.length - 1]!.content).toBe("¿y si no tengo esa columna?");
  });

  it("recorta el historial: la conversación no crece sin límite", () => {
    const historial = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `t${i}`,
    }));
    const m = promptSeguimiento(base, historial, "otra");
    expect(m.length).toBeLessThanOrEqual(base.length + MAX_TURNOS * 2 + 1);
  });

  it("recorta una pregunta desmedida en vez de mandarla entera", () => {
    const larga = "a".repeat(MAX_PREGUNTA + 500);
    const m = promptSeguimiento(base, [], larga);
    expect(m[m.length - 1]!.content.length).toBe(MAX_PREGUNTA);
  });
});
