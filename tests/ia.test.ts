import { describe, it, expect } from "vitest";
import { verificarCifras } from "../src/lib/ia/verificacion";
import {
  promptRevisionPrevia,
  promptPartida,
  promptSeguimiento,
  contextoRevisionPrevia,
  promptGeneral,
  promptGeneralConHistorial,
  MAX_TURNOS,
  MAX_TURNOS_GENERAL,
  MAX_PREGUNTA,
} from "../src/lib/ia/prompts";
import { HERRAMIENTAS, herramientaValida } from "../src/lib/ia/herramientas";
import { segmentar } from "../src/lib/ia/formato";
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

describe("herramientas del asistente general", () => {
  it("los nombres no se repiten: el modelo elige por nombre", () => {
    const n = HERRAMIENTAS.map((h) => h.nombre);
    expect(new Set(n).size).toBe(n.length);
  });

  it("ninguna acepta empresa_id — sería un ?empresa_id= en manos de cualquiera", () => {
    for (const h of HERRAMIENTAS) {
      const props = Object.keys(h.parametros.properties);
      expect(props).not.toContain("empresa_id");
      expect(props.join(",")).not.toMatch(/empresa/i);
    }
  });

  it("ninguna promete escribir: el asistente consulta, no ejecuta", () => {
    const verbos = /\b(aprob|concili[ae]|borr|elimin|crea|actualiz|modific)/i;
    for (const h of HERRAMIENTAS) {
      expect(h.nombre).not.toMatch(verbos);
    }
  });

  it("todas cierran su esquema: un argumento inventado no pasa", () => {
    for (const h of HERRAMIENTAS) {
      expect(h.parametros.additionalProperties).toBe(false);
      expect(h.parametros.type).toBe("object");
    }
  });

  it("cada una explica CUÁNDO usarla, no solo qué devuelve", () => {
    for (const h of HERRAMIENTAS) {
      expect(h.descripcion.length).toBeGreaterThan(60);
    }
  });

  it("herramientaValida rechaza un nombre inventado por el modelo", () => {
    expect(herramientaValida("cuentas_por_cobrar")).toBe(true);
    expect(herramientaValida("borrar_todo")).toBe(false);
  });
});

describe("prompt del chat general", () => {
  it("obliga a consultar en vez de responder de memoria", () => {
    const sistema = promptGeneral("hola")[0]!.content;
    expect(sistema).toContain("USA UNA HERRAMIENTA");
    expect(sistema).toContain("si no la consultaste, no la sabes");
  });

  it("le prohíbe rellenar el hueco cuando no puede responder", () => {
    const sistema = promptGeneral("hola")[0]!.content;
    expect(sistema).toContain("No rellenes el hueco");
  });

  it("le exige decir dónde comprobar el dato", () => {
    expect(promptGeneral("hola")[0]!.content).toContain("en qué pantalla");
  });

  it("recorta el historial y la pregunta, como el acotado", () => {
    const historial = Array.from({ length: 100 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `t${i}`,
    }));
    const m = promptGeneralConHistorial(historial, "x".repeat(MAX_PREGUNTA + 99));
    expect(m.length).toBeLessThanOrEqual(1 + MAX_TURNOS_GENERAL * 2 + 1);
    expect(m[m.length - 1]!.content.length).toBe(MAX_PREGUNTA);
  });

  it("el system NO crece con los datos: solo cambia con el día", () => {
    const d = new Date("2026-06-15T12:00:00Z");
    expect(promptGeneral("a", d)[0]!.content).toBe(promptGeneral("b", d)[0]!.content);
  });

  it("⚠️ le dice qué día es: sin eso no puede resolver «este mes»", () => {
    const sistema = promptGeneral("x", new Date("2026-06-15T12:00:00Z"))[0]!.content;
    expect(sistema).toContain("HOY ES 2026-06-15");
    expect(sistema).toContain("Nunca supongas el año");
  });

  it("usa el calendario de Lima, no el del servidor", () => {
    // 03:00 UTC del día 1 es todavía el último día del mes anterior en Perú.
    const sistema = promptGeneral("x", new Date("2026-07-01T03:00:00Z"))[0]!.content;
    expect(sistema).toContain("HOY ES 2026-06-30");
  });

  it("⚠️ rechaza lo ajeno con una frase fija, en vez de responderlo", () => {
    const sistema = promptGeneral("x")[0]!.content;
    expect(sistema).toContain("DE QUÉ NO HABLAS");
    expect(sistema).toContain("Solo puedo ayudarte con tus cobros");
    expect(sistema).toContain("No respondas la pregunta ni aunque la sepas");
  });

  it("exige decir el período exacto: un importe sin rango no se comprueba", () => {
    expect(promptGeneral("x")[0]!.content).toContain("DI EL PERÍODO EXACTO");
  });
});

describe("verificación sobre resultados de herramientas", () => {
  // Lo que devolvería `cuentas_por_cobrar`.
  const SALIDA =
    "Cuentas por cobrar (foto de hoy):\n" +
    "Total: S/ 19,221.00 en 340 documentos.\n" +
    "Vencido: S/ 8,004.50.";

  it("deja pasar lo que la consulta devolvió", () => {
    expect(
      verificarCifras("Te deben S/ 19,221.00, y S/ 8,004.50 está vencido.", SALIDA)
        .ok,
    ).toBe(true);
  });

  it("⚠️ atrapa un total inventado, que es el peor fallo posible aquí", () => {
    const r = verificarCifras("Te deben S/ 25,000.00 en total.", SALIDA);
    expect(r.ok).toBe(false);
    expect(r.intrusas).toContain("25,000.00");
  });

  it("atrapa también un porcentaje calculado por su cuenta", () => {
    // 8004.50 / 19221 = 41,6 %, correcto pero NO viene dado: el modelo no
    // calcula, y si lo hace no se le cree.
    expect(verificarCifras("El 41.6 % está vencido.", SALIDA).ok).toBe(false);
  });
});

describe("formato de la respuesta del modelo", () => {
  const plano = (t: string) =>
    segmentar(t)
      .map((s) => s.texto)
      .join("");

  it("convierte **negrita** en un segmento fuerte, sin los asteriscos", () => {
    const s = segmentar("Cárgalas desde **Comprobantes**, con la plantilla.");
    expect(s.filter((x) => x.tipo === "fuerte").map((x) => x.texto)).toEqual([
      "Comprobantes",
    ]);
    expect(plano(s.map((x) => x.texto).join(""))).not.toContain("*");
  });

  it("maneja varias marcas en la misma frase", () => {
    const s = segmentar("Míralo en **Por cobrar** o en **Por pagar**.");
    expect(s.filter((x) => x.tipo === "fuerte")).toHaveLength(2);
  });

  it("reconoce `código` para nombres de columna", () => {
    const s = segmentar("La columna `referencia` es la que decide.");
    expect(s.find((x) => x.tipo === "codigo")?.texto).toBe("referencia");
  });

  it("⚠️ NO toca el asterisco simple: '3 * 4' es aritmética, no cursiva", () => {
    const s = segmentar("Son 3 * 4 = 12 documentos.");
    expect(s).toHaveLength(1);
    expect(s[0]!.tipo).toBe("texto");
  });

  it("una marca sin cerrar se deja literal en vez de comerse el resto", () => {
    const s = segmentar("Esto **no cierra y sigue el texto");
    expect(plano("Esto **no cierra y sigue el texto")).toBe(
      "Esto **no cierra y sigue el texto",
    );
    expect(s.every((x) => x.tipo === "texto")).toBe(true);
  });

  it("no pierde ni añade texto: lo que entra es lo que sale", () => {
    const casos = [
      "sin marcas",
      "**todo en negrita**",
      "a **b** c `d` e",
      "",
      "****",
      "línea 1\nlínea 2 con **negrita**",
    ];
    for (const c of casos) {
      expect(plano(c)).toBe(c.replace(/\*\*([^*]+?)\*\*/g, "$1").replace(/`([^`]+?)`/g, "$1"));
    }
  });

  it("conserva los saltos de línea, que dan la estructura de la respuesta", () => {
    const s = segmentar("uno\n\ndos **tres**");
    expect(s[0]!.texto).toContain("\n\n");
  });

  it("un texto vacío no produce segmentos", () => {
    expect(segmentar("")).toEqual([]);
  });
});

describe("⚠️ fechas: el fallo que rechazaba respuestas correctas", () => {
  // Un usuario preguntó "¿qué necesitas para darme el balance de marzo?" —sin
  // datos, así que no se consultó nada— y el asistente pidió el rango. Con la
  // lista de admitidas vacía, una respuesta correcta se descartaba.
  const SIN_CONSULTAS = "";

  it("acepta un rango de fechas propuesto cuando no se consultó nada", () => {
    const r = verificarCifras(
      "Necesito el período exacto: ¿del 01/03/2026 al 31/03/2026?",
      SIN_CONSULTAS,
    );
    expect(r.ok).toBe(true);
  });

  it("acepta las formas escritas y la ISO", () => {
    for (const t of [
      "Del 1 de marzo de 2026 al 31 de marzo de 2026.",
      "El período 2026-03-01 a 2026-03-31.",
      "Los datos de marzo de 2026.",
      "Durante 2026 no hubo movimientos.",
    ]) {
      expect(verificarCifras(t, SIN_CONSULTAS).ok, t).toBe(true);
    }
  });

  it("⚠️ pero un IMPORTE junto a la fecha se sigue comprobando", () => {
    // Es lo que la verificación existe para atrapar: la fecha es calendario,
    // el dinero es el dato.
    const r = verificarCifras(
      "El 31/03/2026 cobraste S/ 88,450.00.",
      SIN_CONSULTAS,
    );
    expect(r.ok).toBe(false);
    expect(r.intrusas).toContain("88,450.00");
  });

  it("un recuento inventado tampoco se salva por ir con una fecha", () => {
    const r = verificarCifras("En marzo de 2026 tienes 4,318 facturas.", "");
    expect(r.ok).toBe(false);
    expect(r.intrusas).toContain("4,318");
  });
});
