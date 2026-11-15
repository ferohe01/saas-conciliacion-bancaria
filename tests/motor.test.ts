import { describe, it, expect } from "vitest";
import type {
  MovimientoBancario,
  PayloadConciliacion,
  RegistroInterno,
} from "@/lib/contract/payload";
import type { Match } from "@/lib/contract/resultado";
import { ResultadoConciliacion } from "@/lib/contract/resultado";
import { capaExacta } from "@/lib/motor/exacta";
import { capaDifusa } from "@/lib/motor/difusa";
import { capaAgrupacion } from "@/lib/motor/agrupacion";
import { prepararIa } from "@/lib/motor/candidatosIa";
import { adjudicarIa, extraerPares } from "@/lib/motor/adjudicarIa";
import { ensamblarResultado } from "@/lib/motor/ensamblar";
import { ejecutarMotor, type FaseMotor } from "@/lib/motor/motor";
import type { Etapa } from "@/lib/motor/tipos";

/**
 * El motor de conciliación (antes: nodos Code de n8n).
 *
 * Estos casos son los mismos —con las mismas cifras— que vigilaban los `.js` de
 * n8n ejecutándolos con `new Function`. Ahora el motor es TypeScript con tipos
 * y se prueba directamente, incluida la cadena completa con un modelo simulado,
 * que con n8n solo se podía verificar end-to-end.
 */

const reg = (r: Partial<RegistroInterno> & { id_interno: string; monto: number }): RegistroInterno => ({
  fecha: "2026-06-01",
  tipo: r.monto >= 0 ? "cobranza" : "pago",
  ...r,
});
const mov = (m: Partial<MovimientoBancario> & { id_movimiento: string; monto: number }): MovimientoBancario => ({
  fecha: "2026-06-01",
  tipo: m.monto >= 0 ? "abono" : "cargo",
  ...m,
});
const etapa = (
  pendientesInternos: RegistroInterno[],
  pendientesBancarios: MovimientoBancario[],
  matches: Match[] = [],
): Etapa => ({ matches, pendientesInternos, pendientesBancarios });

/**
 * El prefiltro de identidad de la agrupación es la regla cuyo fallo produce
 * conciliaciones **silenciosamente equivocadas**: sin él, un subset-sum
 * empareja partidas sin relación cuya suma cuadra por azar.
 */
describe("agrupación 1:N — prefiltro de identidad", () => {
  const config = { max_combinacion: 3, ventana_ia_dias: 30, tolerancia_monto_abs: 5 };
  const base = (refInt: string, refBanco: string, glosa: string | null) =>
    etapa(
      [
        reg({ id_interno: "REG-1", fecha: "2026-06-10", monto: 79, contraparte: null, descripcion: null, referencia: refInt }),
        reg({ id_interno: "REG-2", fecha: "2026-06-10", monto: 79, contraparte: null, descripcion: null, referencia: refInt }),
      ],
      [mov({ id_movimiento: "BCO-1", fecha: "2026-06-10", monto: 158, glosa, referencia_banco: refBanco })],
    );

  it("agrupa cuando comparten referencia, aunque no haya nombre", () => {
    // Cuenta recaudadora: los recibos llegan sin contraparte y lo que comparten
    // los pagados juntos es el código de operación.
    const r = capaAgrupacion(base("EFECTIVO001", "EFECTIVO001", "EFECTIVO001"), config);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.categoria_diferencia).toBe("agrupacion_1aN");
    expect(r.matches[0]!.ids_internos).toEqual(["REG-1", "REG-2"]);
    expect(r.matches[0]!.justificacion).toContain("código de operación");
    expect(r.pendientesInternos).toHaveLength(0);
    expect(r.pendientesBancarios).toHaveLength(0);
  });

  it("NO agrupa cuando la suma cuadra por casualidad", () => {
    expect(capaAgrupacion(base("A-1", "C-9", null), config).matches).toHaveLength(0);
  });

  it("una agrupación nunca se auto-concilia", () => {
    const r = capaAgrupacion(base("EFECTIVO001", "EFECTIVO001", null), config);
    expect(r.matches[0]!.estado_revision).toBe("pendiente");
  });
});

describe("capa exacta — el respaldo por monto+fecha", () => {
  const caso = (refInt: string | null, refBanco: string | null) =>
    capaExacta(
      [reg({ id_interno: "REG-1", monto: 99, referencia: refInt })],
      [mov({ id_movimiento: "BCO-1", monto: 99, referencia_banco: refBanco })],
    );

  it("NO empareja cuando ambas referencias existen y se contradicen", () => {
    // Con cientos de recibos de S/ 99 el mismo día, el respaldo casó 541 pares
    // con códigos sin relación — y los marcó `auto`.
    expect(caso("OP-AAA", "OP-BBB").matches).toHaveLength(0);
  });

  it("sí empareja por monto+fecha cuando falta la referencia", () => {
    expect(caso(null, null).matches).toHaveLength(1);
    expect(caso("OP-AAA", null).matches).toHaveLength(1);
    expect(caso(null, "OP-BBB").matches).toHaveLength(1);
  });

  it("empareja por referencia idéntica, que es el camino principal", () => {
    const r = caso("OP-AAA", "OP-AAA");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.metodo).toBe("exacta");
    expect(r.matches[0]!.estado_revision).toBe("auto");
  });

  it("el prefijo de entidad no impide casar (WIN-S001-… ≡ S001-…)", () => {
    const r = capaExacta(
      [reg({ id_interno: "REG-1", monto: 99, referencia: "WIN-S001-11618954", fecha: "2026-06-01" })],
      [mov({ id_movimiento: "BCO-1", monto: 99, referencia_banco: "S001-11618954", fecha: "2026-06-20" })],
    );
    expect(r.matches).toHaveLength(1);
  });
});

describe("capa difusa", () => {
  const config = { tolerancia_monto_abs: 5, tolerancia_monto_pct: 0, tolerancia_dias: 3 };

  it("exige al menos una palabra del nombre en común", () => {
    const r = capaDifusa(
      etapa(
        [reg({ id_interno: "REG-1", monto: 100, contraparte: "Comercial Ñuñez SAC" })],
        [mov({ id_movimiento: "BCO-1", monto: 97, glosa: "EFECTIVO000123" })],
      ),
      config,
    );
    expect(r.matches).toHaveLength(0);
  });

  it("casa por nombre dentro de la tolerancia y lo marca como comisión", () => {
    const r = capaDifusa(
      etapa(
        [reg({ id_interno: "REG-1", monto: 100, contraparte: "Comercial Ñuñez SAC" })],
        [mov({ id_movimiento: "BCO-1", monto: 97, fecha: "2026-06-03", glosa: "TRANSF COMERCIAL NUNEZ" })],
      ),
      config,
    );
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.metodo).toBe("difusa");
    expect(r.matches[0]!.diferencia_monto).toBe(3);
    expect(r.matches[0]!.categoria_diferencia).toBe("comision_bancaria");
  });

  it("no casa fuera de la ventana de días", () => {
    const r = capaDifusa(
      etapa(
        [reg({ id_interno: "REG-1", monto: 100, contraparte: "Comercial Nunez" })],
        [mov({ id_movimiento: "BCO-1", monto: 100, fecha: "2026-06-10", glosa: "COMERCIAL NUNEZ" })],
      ),
      config,
    );
    expect(r.matches).toHaveLength(0);
  });
});

/**
 * El cuadre es el VEREDICTO que el cliente enseña a su contador, y un error
 * aquí no se ve — sale un número plausible.
 */
describe("cuadre bancario (ensamblado)", () => {
  const caso = (
    saldos: { extracto: number; libros: number },
    pendientes: { internos?: number[]; bancarios?: number[] } = {},
    matches: Match[] = [],
  ) =>
    ensamblarResultado(
      etapa(
        (pendientes.internos ?? []).map((monto, i) => reg({ id_interno: `REG-${i}`, monto })),
        (pendientes.bancarios ?? []).map((monto, i) => mov({ id_movimiento: `BCO-${i}`, monto })),
        matches,
      ),
      { internos: 0, bancarios: 0 },
      { saldo_extracto_final: saldos.extracto, saldo_libros_final: saldos.libros },
    ).cuadre;

  it("cuadra cuando no hay nada suelto", () => {
    expect(caso({ extracto: 1000, libros: 1000 }).diferencia).toBe(0);
  });

  it("cierra con un depósito en tránsito", () => {
    const c = caso({ extracto: 900, libros: 1000 }, { internos: [100] });
    expect(c.depositos_en_transito).toBe(100);
    expect(c.diferencia).toBe(0);
  });

  it("cierra con un cheque girado y no cobrado", () => {
    const c = caso({ extracto: 1100, libros: 1000 }, { internos: [-100] });
    expect(c.cheques_no_cobrados).toBe(-100);
    expect(c.diferencia).toBe(0);
  });

  it("cierra con una comisión que el banco cobró y los libros no tienen", () => {
    const c = caso({ extracto: 950, libros: 1000 }, { bancarios: [-50] });
    expect(c.cargos_no_registrados).toBe(-50);
    expect(c.diferencia).toBe(0);
  });

  it("cierra con un abono que el banco registró y los libros no", () => {
    const c = caso({ extracto: 1050, libros: 1000 }, { bancarios: [50] });
    expect(c.abonos_no_registrados).toBe(50);
    expect(c.diferencia).toBe(0);
  });

  it("cierra con las cuatro partidas a la vez", () => {
    const c = caso({ extracto: 940, libros: 1000 }, { internos: [100, -30], bancarios: [20, -10] });
    expect(c.saldo_banco_ajustado).toBe(1000);
    expect(c.diferencia).toBe(0);
  });

  it("el corte del 30/06: la diferencia es la brecha de saldos más la de partidas", () => {
    const c = caso({ extracto: 660, libros: 0 }, { internos: [414_616.52], bancarios: [2_067.49] });
    expect(c.diferencia).toBe(413_209.03);
  });

  it("un par con diferencia entra en el cuadre", () => {
    // Faltaban 20 soles exactos en junio: la diferencia de UN par de la IA.
    const c = caso({ extracto: 80, libros: 100 }, {}, [
      { ids_internos: ["R1"], ids_movimientos: ["B1"], metodo: "ia", diferencia_monto: 20, estado_revision: "pendiente" },
    ]);
    expect(c.diferencias_emparejadas).toBe(20);
    expect(c.diferencia).toBe(0);
  });

  it("los pares exactos no aportan nada, por construcción", () => {
    const c = caso({ extracto: 100, libros: 100 }, {}, [
      { ids_internos: ["R1"], ids_movimientos: ["B1"], metodo: "exacta", diferencia_monto: 0, estado_revision: "auto" },
    ]);
    expect(c.diferencias_emparejadas).toBe(0);
    expect(c.diferencia).toBe(0);
  });
});

/** El residuo de un cliente grande, con forma de recaudadora. */
const residuo = (n: number, m: number) =>
  etapa(
    Array.from({ length: n }, (_, i) =>
      reg({
        id_interno: `REG-${i}`, fecha: "2026-06-15", monto: 100 + (i % 50),
        referencia: `SR11-${i}`, contraparte: null, descripcion: `PA-WIN-${i}`,
      }),
    ),
    Array.from({ length: m }, (_, j) =>
      mov({
        id_movimiento: `BCO-${j}`, fecha: "2026-06-15", monto: 100 + (j % 50),
        referencia_banco: `SR11-${j}`, glosa: `EFECTIVO${j}`,
      }),
    ),
  );
const configIa = { tolerancia_ia_monto: 50, ventana_ia_dias: 30, top_k_candidatos: 5, umbral_confianza_auto: 0.95 };

describe("la cadena después de la IA aguanta el residuo", () => {
  it("con la IA caída, el resultado sale igual y nada queda a medias", () => {
    const e = residuo(4382, 3204);
    const prep = prepararIa(e, configIa);
    const tras = adjudicarIa(e, prep.shortlists, null, configIa); // el LLM no respondió
    const resultado = ensamblarResultado(tras, { internos: 4382, bancarios: 3204 }, {});

    expect(resultado.resumen.sugeridos_ia).toBe(0);
    expect(resultado.resumen.sin_conciliar_internos).toBe(4382);
    expect(resultado.resumen.sin_conciliar_bancarios).toBe(3204);
    expect(resultado.no_conciliados).toHaveLength(4382 + 3204);
    expect(ResultadoConciliacion.safeParse(resultado).success).toBe(true);
  });

  it("el prompt cabe en un modelo real", () => {
    // Con 4.382 internos llegó a pesar 4,7 MB (~1,2 millones de tokens).
    const prep = prepararIa(residuo(4382, 3204), configIa);
    expect(prep.user.length).toBeLessThan(500 * 1024);
    expect(prep.shortlists.length).toBeLessThanOrEqual(150);
  });

  it("solo se adjudica lo que el modelo llegó a ver", () => {
    const e = residuo(50, 50);
    const prep = prepararIa(e, configIa);
    const inventado = JSON.stringify([{ id_interno: "REG-9999", id_movimiento: "BCO-0", confianza: 0.99 }]);
    expect(adjudicarIa(e, prep.shortlists, inventado, configIa).matches).toHaveLength(0);
  });

  it("una adjudicación válida por debajo del umbral queda pendiente", () => {
    const e = residuo(1, 1);
    const prep = prepararIa(e, configIa);
    const r = adjudicarIa(
      e,
      prep.shortlists,
      '```json\n{"pares":[{"id_interno":"REG-0","id_movimiento":"BCO-0","confianza":0.8,"categoria":"redondeo"}]}\n```',
      configIa,
    );
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.metodo).toBe("ia");
    expect(r.matches[0]!.estado_revision).toBe("pendiente");
    expect(r.matches[0]!.categoria_diferencia).toBe("redondeo");
  });

  it("una respuesta ilegible es «ningún par», no un error", () => {
    expect(extraerPares("esto no es json")).toEqual([]);
    expect(extraerPares(null)).toEqual([]);
    expect(extraerPares({ pares: [{ id_interno: "a" }] })).toHaveLength(1);
  });
});

/**
 * ⚠️⚠️ EL CÓDIGO DE OPERACIÓN PERUANO ES NUMÉRICO. Exigirle letra + dígito al
 * CAMPO de referencia dejaba fuera toda retención: con 233 × 221 el LLM recibió
 * CERO shortlists.
 */
describe("candidatos IA: el código de operación numérico cuenta como referencia", () => {
  const retencion = (codigo: string) =>
    prepararIa(
      etapa(
        [reg({
          id_interno: "REG-1", monto: 12244.56, referencia: codigo,
          contraparte: "Rosa Elvira Quispe Mamani", descripcion: "",
        })],
        [mov({
          id_movimiento: "BCO-1", monto: 11877.22, referencia_banco: codigo,
          glosa: "ABONO TRANSF. ROSA ELVIRA QUISPE M (NETO RETENC)",
        })],
      ),
      { tolerancia_ia_monto: 10, ventana_ia_dias: 30, top_k_candidatos: 5 },
    ).shortlists;

  it("un código numérico llega al modelo pese a salirse de la banda", () => {
    const s = retencion("30010182");
    expect(s).toHaveLength(1);
    expect(s[0]!.candidatos[0]!.comparte_ref).toBe(true);
  });

  it("un código alfanumérico sigue funcionando igual", () => {
    expect(retencion("SR11-02748951")[0]!.candidatos[0]!.comparte_ref).toBe(true);
  });

  it("un código demasiado corto NO se toma por referencia", () => {
    const s = retencion("12");
    expect(s.length === 0 || s[0]!.candidatos[0]!.comparte_ref === false).toBe(true);
  });
});

/**
 * Pagos parciales: mismo recibo, el banco recibió MENOS. En la recaudadora eran
 * los 9 casos que llegaban al modelo y salían todos «ninguno»: sin nombre en
 * ningún lado, el prompt le exigía una identidad que no podía ver.
 */
describe("candidatos IA: pagos parciales", () => {
  const cfg = { tolerancia_ia_monto: 10, ventana_ia_dias: 30, top_k_candidatos: 3, umbral_confianza_auto: 0.95 };
  // Caso real de junio, sin nombre en ningún lado.
  const caso = (montoBanco: number) =>
    etapa(
      [reg({ id_interno: "REG-1", fecha: "2026-06-17", monto: 53.79, referencia: "SR11-03320120", contraparte: null, descripcion: null })],
      [mov({ id_movimiento: "BCO-1", fecha: "2026-06-17", monto: montoBanco, referencia_banco: "SR11-03320120", glosa: "EFECTIVO00000040225552" })],
    );

  it("mismo código y el banco recibió menos: llega marcado como pago parcial", () => {
    const s = prepararIa(caso(33.79), cfg).shortlists;
    expect(s).toHaveLength(1);
    expect(s[0]!.candidatos[0]!.categoria_probable).toBe("pago_parcial");
  });

  it("si el banco recibió MÁS no es pago parcial", () => {
    expect(prepararIa(caso(73.79), cfg).shortlists[0]!.candidatos[0]!.categoria_probable).toBe(
      "requiere_investigacion",
    );
  });

  it("una diferencia pequeña sigue siendo comisión", () => {
    expect(prepararIa(caso(50.79), cfg).shortlists[0]!.candidatos[0]!.categoria_probable).toBe(
      "comision_bancaria",
    );
  });

  it("el prompt le dice al modelo que el código es identidad y qué es un pago parcial", () => {
    const { system } = prepararIa(caso(33.79), cfg);
    expect(system).toContain("comparte_ref=true");
    expect(system).toContain("PAGO PARCIAL");
  });

  it("un pago parcial nunca se auto-concilia, aunque el modelo esté seguro", () => {
    const e = caso(33.79);
    const prep = prepararIa(e, cfg);
    const r = adjudicarIa(
      e,
      prep.shortlists,
      JSON.stringify({ pares: [{ id_interno: "REG-1", id_movimiento: "BCO-1", confianza: 0.99, categoria: "pago_parcial" }] }),
      cfg,
    );
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.categoria_diferencia).toBe("pago_parcial");
    expect(r.matches[0]!.diferencia_monto).toBe(20);
    expect(r.matches[0]!.estado_revision).toBe("pendiente");
  });

  it("tampoco si el modelo lo etiqueta de otra forma", () => {
    const e = caso(33.79);
    const prep = prepararIa(e, cfg);
    const r = adjudicarIa(
      e,
      prep.shortlists,
      JSON.stringify({ pares: [{ id_interno: "REG-1", id_movimiento: "BCO-1", confianza: 0.99, categoria: "redondeo" }] }),
      cfg,
    );
    expect(r.matches[0]!.estado_revision).toBe("pendiente");
  });

  it("lo que no es parcial sigue la regla del umbral de siempre", () => {
    const e = caso(53.79 - 3); // comisión de 3
    const prep = prepararIa(e, cfg);
    const r = adjudicarIa(
      e,
      prep.shortlists,
      JSON.stringify({ pares: [{ id_interno: "REG-1", id_movimiento: "BCO-1", confianza: 0.99, categoria: "comision_bancaria" }] }),
      cfg,
    );
    expect(r.matches[0]!.estado_revision).toBe("auto");
  });
});

describe("el motor completo", () => {
  const payload = (
    internos: RegistroInterno[],
    bancarios: MovimientoBancario[],
  ): PayloadConciliacion => ({
    job_id: "rec-2026-06-test",
    metadata: {
      empresa_id: "e",
      usuario_id: "u",
      periodo: { desde: "2026-06-01", hasta: "2026-06-30" },
      cuenta: { banco: "BCP", numero: "****6049", moneda: "PEN" },
      saldos: { saldo_extracto_final: 1000, saldo_libros_final: 1000 },
    },
    config: {
      tolerancia_monto_abs: 5, tolerancia_monto_pct: 0, tolerancia_dias: 3,
      tolerancia_ia_monto: 10, top_k_candidatos: 3, ventana_ia_dias: 30,
      max_combinacion: 3, umbral_confianza_auto: 0.95, arrastre_meses: 12,
    },
    registros_internos: internos,
    movimientos_bancarios: bancarios,
  });

  it("recorre las cuatro fases en orden y devuelve un resultado válido", async () => {
    const fases: FaseMotor[] = [];
    const { resultado } = await ejecutarMotor(
      payload(
        [reg({ id_interno: "REG-1", monto: 99, referencia: "OP-1" })],
        [mov({ id_movimiento: "BCO-1", monto: 99, referencia_banco: "OP-1" })],
      ),
      { alEntrarEnFase: (f) => void fases.push(f) },
    );
    expect(fases).toEqual(["exacta", "difusa", "agrupacion", "ia"]);
    expect(resultado.resumen.conciliados_exactos).toBe(1);
    expect(ResultadoConciliacion.safeParse(resultado).success).toBe(true);
  });

  it("sin nada que preguntar, no llama al modelo", async () => {
    let llamadas = 0;
    const { traza } = await ejecutarMotor(
      payload(
        [reg({ id_interno: "REG-1", monto: 99, referencia: "OP-1" })],
        [mov({ id_movimiento: "BCO-1", monto: 99, referencia_banco: "OP-1" })],
      ),
      { consultarIa: async () => { llamadas++; return null; } },
    );
    expect(llamadas).toBe(0);
    expect(traza.iaRespondio).toBeNull();
  });

  it("adjudica lo que propone el modelo sobre la shortlist", async () => {
    // Retención: mismo código, 367,34 de diferencia. Ninguna capa
    // determinística lo casa; la IA sí, y queda pendiente de revisión.
    const { resultado, traza } = await ejecutarMotor(
      payload(
        [reg({ id_interno: "REG-1", monto: 12244.56, referencia: "30010182", contraparte: "Rosa Quispe" })],
        [mov({ id_movimiento: "BCO-1", monto: 11877.22, referencia_banco: "30010182", glosa: "ROSA QUISPE NETO RETENC" })],
      ),
      {
        consultarIa: async () =>
          JSON.stringify({ pares: [{ id_interno: "REG-1", id_movimiento: "BCO-1", confianza: 0.9, categoria: "requiere_investigacion" }] }),
      },
    );
    expect(traza.iaRespondio).toBe(true);
    expect(resultado.resumen.sugeridos_ia).toBe(1);
    expect(resultado.matches[0]!.estado_revision).toBe("pendiente");
    expect(resultado.cuadre.diferencias_emparejadas).toBe(367.34);
  });

  it("si el modelo no contesta, la conciliación termina igual", async () => {
    const { resultado, traza } = await ejecutarMotor(
      payload(
        [reg({ id_interno: "REG-1", monto: 12244.56, referencia: "30010182" })],
        [mov({ id_movimiento: "BCO-1", monto: 11877.22, referencia_banco: "30010182" })],
      ),
      { consultarIa: async () => null },
    );
    expect(traza.iaRespondio).toBe(false);
    expect(resultado.resumen.sin_conciliar_internos).toBe(1);
    expect(resultado.resumen.sin_conciliar_bancarios).toBe(1);
  });
});
