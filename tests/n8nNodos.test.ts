import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Los nodos Code de n8n son la FUENTE ÚNICA del motor, pero viven fuera del
 * typecheck (son .js sueltos) y no se ejecutan en los tests: se verifican
 * end-to-end en n8n. Consecuencia real: un `].join("` con un salto de línea
 * dentro del string estuvo commiteado sin que nada lo detectara. Reimportar el
 * workflow habría dejado el nodo muerto y el fallo habría aparecido en mitad de
 * una conciliación de 20.000 registros.
 *
 * Esto no prueba la lógica —para eso está n8n— pero garantiza lo mínimo: que el
 * archivo sea JavaScript válido.
 */
const DIR = "n8n";
const nodos = readdirSync(DIR).filter((f) => f.endsWith(".js"));

describe("nodos Code de n8n", () => {
  it("hay nodos que revisar", () => {
    expect(nodos.length).toBeGreaterThan(0);
  });

  it.each(nodos)("%s es JavaScript válido", (archivo) => {
    expect(() =>
      execFileSync(process.execPath, ["--check", join(DIR, archivo)], {
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it.each(nodos)("%s no tiene saltos de línea crudos dentro de un string", (archivo) => {
    // El fallo exacto que motivó este test: `.join("` + salto real + `")`.
    const src = readFileSync(join(DIR, archivo), "utf8");
    expect(src).not.toMatch(/"[^"\n]*\n[^"\n]*"\s*\)\s*;?\s*$/m);
  });
});

describe("workflows generados", () => {
  const jsons = readdirSync(DIR).filter((f) => f.endsWith(".json"));

  it.each(jsons)("%s está al día con los nodos fuente", (archivo) => {
    // Si alguien edita un nodo y olvida regenerar, el JSON importable queda
    // desfasado — y es el JSON lo que se sube a n8n.
    const wf = JSON.parse(readFileSync(join(DIR, archivo), "utf8"));
    for (const nodo of wf.nodes) {
      const js = nodo.parameters?.jsCode;
      if (typeof js !== "string") continue;
      const fuente = nodos.find((f) => readFileSync(join(DIR, f), "utf8") === js);
      expect(fuente, `el nodo "${nodo.name}" de ${archivo} no coincide con ningún .js`).toBeDefined();
    }
  });
});

/**
 * Excepción deliberada a "los nodos Code no se testean unitariamente".
 *
 * El prefiltro de identidad de la agrupación es la única regla del motor cuyo
 * fallo produce conciliaciones **silenciosamente equivocadas**: sin él, un
 * subset-sum empareja partidas sin relación cuya suma cuadra por azar, y el
 * resultado parece correcto. Eso merece una red aquí y no solo en n8n.
 */
describe("agrupación 1:N — prefiltro de identidad", () => {
  const correr = (entrada: unknown) =>
    new Function("$json", readFileSync(join(DIR, "03a_agrupacion.js"), "utf8"))(
      entrada,
    )[0].json;

  const base = (refInt: string, refBanco: string, glosa: string | null) => ({
    job_id: "t",
    metadata: {},
    config: { max_combinacion: 3, ventana_ia_dias: 30, tolerancia_monto_abs: 5 },
    total_internos: 2,
    total_bancarios: 1,
    matches: [],
    pendientes_internos: [
      { id_interno: "REG-1", fecha: "2026-06-10", monto: 79, contraparte: null, descripcion: null, referencia: refInt },
      { id_interno: "REG-2", fecha: "2026-06-10", monto: 79, contraparte: null, descripcion: null, referencia: refInt },
    ],
    pendientes_bancarios: [
      { id_movimiento: "BCO-1", fecha: "2026-06-10", monto: 158, glosa, referencia_banco: refBanco },
    ],
  });

  it("agrupa cuando comparten referencia, aunque no haya nombre", () => {
    // El caso de una cuenta recaudadora: los recibos llegan sin contraparte y
    // lo que comparten los pagados juntos es el código de operación. Exigir
    // nombre hacía imposible conciliar justo estos.
    const r = correr(base("EFECTIVO001", "EFECTIVO001", "EFECTIVO001"));
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].categoria_diferencia).toBe("agrupacion_1aN");
    expect(r.matches[0].ids_internos).toEqual(["REG-1", "REG-2"]);
    expect(r.matches[0].justificacion).toContain("código de operación");
  });

  it("NO agrupa cuando la suma cuadra por casualidad", () => {
    // Sin identidad compartida no hay grupo, por muy bien que sumen.
    expect(correr(base("A-1", "C-9", null)).matches).toHaveLength(0);
  });

  it("una agrupación nunca se auto-concilia", () => {
    // Va siempre a revisión humana: es una propuesta, no un hecho.
    const r = correr(base("EFECTIVO001", "EFECTIVO001", null));
    expect(r.matches[0].estado_revision).toBe("pendiente");
  });
});

describe("capa exacta — el respaldo por monto+fecha", () => {
  const correr = (entrada: unknown) => {
    const src = readFileSync(join(DIR, "01_exacta.js"), "utf8").replace(
      "const src = $('Webhook').first().json;",
      "const src = $json;",
    );
    return new Function("$json", src)({ body: entrada })[0].json;
  };

  const caso = (refInt: string | null, refBanco: string | null) => ({
    job_id: "t",
    metadata: {},
    config: {},
    registros_internos: [
      { id_interno: "REG-1", fecha: "2026-06-01", monto: 99, tipo: "cobranza", referencia: refInt },
    ],
    movimientos_bancarios: [
      { id_movimiento: "BCO-1", fecha: "2026-06-01", monto: 99, tipo: "abono", referencia_banco: refBanco },
    ],
  });

  it("NO empareja cuando ambas referencias existen y se contradicen", () => {
    // A escala esto no es teórico: con cientos de recibos de S/ 99 el mismo día,
    // el respaldo casó 541 pares con códigos de operación sin relación — y los
    // marcó `auto`, o sea conciliados sin que nadie los mirara.
    expect(correr(caso("OP-AAA", "OP-BBB")).matches).toHaveLength(0);
  });

  it("sí empareja por monto+fecha cuando falta la referencia", () => {
    // El respaldo existe para eso: ventas al contado, extractos sin referencia.
    expect(correr(caso(null, null)).matches).toHaveLength(1);
    expect(correr(caso("OP-AAA", null)).matches).toHaveLength(1);
    expect(correr(caso(null, "OP-BBB")).matches).toHaveLength(1);
  });

  it("empareja por referencia idéntica, que es el camino principal", () => {
    const r = correr(caso("OP-AAA", "OP-AAA"));
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].metodo).toBe("exacta");
  });
});

/**
 * Segunda excepción, por el mismo motivo: el cuadre es el VEREDICTO que el
 * cliente enseña a su contador, y un error aquí no se ve — sale un número
 * plausible.
 *
 * Tenía dos, tapándose entre sí. Los abonos que el banco registró y los libros
 * no, no se contaban en ningún renglón (24 depósitos de una recaudadora
 * desaparecidos del informe). Y los cargos se sumaban en vez de restarse, lo
 * que con una comisión no la corregía sino que la duplicaba con el signo
 * cambiado. Resultado: el cuadre no podía dar cero aunque toda diferencia
 * estuviera explicada — que es exactamente lo único que el cuadre demuestra.
 */
describe("cuadre bancario", () => {
  const correr = (entrada: unknown) =>
    new Function("$json", readFileSync(join(DIR, "04_ensamblar.js"), "utf8"))(
      entrada,
    )[0].json.resultado_update.resultado.cuadre;

  /** Un período con los saldos dados y las partidas sueltas que se le pasen. */
  const caso = (
    saldos: { extracto: number; libros: number },
    pendientes: { internos?: number[]; bancarios?: number[] } = {},
  ) =>
    correr({
      job_id: "t",
      metadata: { saldos: { saldo_extracto_final: saldos.extracto, saldo_libros_final: saldos.libros } },
      total_internos: 0,
      total_bancarios: 0,
      matches: [],
      pendientes_internos: (pendientes.internos ?? []).map((monto, i) => ({ id_interno: `REG-${i}`, monto })),
      pendientes_bancarios: (pendientes.bancarios ?? []).map((monto, i) => ({ id_movimiento: `BCO-${i}`, monto })),
    });

  it("cuadra cuando no hay nada suelto", () => {
    expect(caso({ extracto: 1000, libros: 1000 }).diferencia).toBe(0);
  });

  it("cierra con un depósito en tránsito", () => {
    // El libro ya lo tiene, el extracto todavía no: 900 + 100 = 1000.
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
    // El fallo del signo: el extracto YA descontó los 50, los libros no, así
    // que libros = extracto + 50. Sumarlos daba −100 en vez de 0.
    const c = caso({ extracto: 950, libros: 1000 }, { bancarios: [-50] });
    expect(c.cargos_no_registrados).toBe(-50);
    expect(c.diferencia).toBe(0);
  });

  it("cierra con un abono que el banco registró y los libros no", () => {
    // El renglón que faltaba: sin él la diferencia se quedaba en −50.
    const c = caso({ extracto: 1050, libros: 1000 }, { bancarios: [50] });
    expect(c.abonos_no_registrados).toBe(50);
    expect(c.diferencia).toBe(0);
  });

  it("cierra con las cuatro partidas a la vez", () => {
    // extracto 940 + 100 − 30 − 20 + 10 = 1000 = libros.
    const c = caso(
      { extracto: 940, libros: 1000 },
      { internos: [100, -30], bancarios: [20, -10] },
    );
    expect(c.saldo_banco_ajustado).toBe(1000);
    expect(c.diferencia).toBe(0);
  });

  it("el corte del 30/06: la diferencia es la brecha de saldos más la de partidas", () => {
    // Caso real reducido: 4.207 recibos cobrados por otro canal (+414.616,52)
    // y 24 depósitos que el banco trae y los libros no (−2.067,49).
    const c = caso(
      { extracto: 660, libros: 0 },
      { internos: [414_616.52], bancarios: [2_067.49] },
    );
    expect(c.diferencia).toBe(413_209.03);
  });
});

/**
 * La cadena posterior a la IA, con el residuo de un cliente grande.
 *
 * Los tres nodos que van detrás de "Candidatos IA" nunca se habían ejercitado a
 * volumen, y son los que convierten el trabajo en resultado: si alguno revienta,
 * se pierden los 447.795 pares que la capa exacta ya resolvió — el 99 % — porque
 * "Actualizar Supabase" no llega a ejecutarse y el job se queda en `procesando`.
 *
 * El caso que se prueba es el PEOR: la IA no contesta. Es el más probable de
 * todos —depende de un servicio externo— y el que más tiene que degradar bien.
 */
describe("la cadena después de la IA aguanta el residuo", () => {
  const DIR2 = "n8n";
  const residuo = (n: number, m: number) => ({
    job_id: "t",
    metadata: { saldos: { saldo_extracto_final: 0, saldo_libros_final: 0 } },
    config: { tolerancia_ia_monto: 50, ventana_ia_dias: 30, top_k_candidatos: 5, umbral_confianza_auto: 0.95 },
    total_internos: n,
    total_bancarios: m,
    matches: [],
    pendientes_internos: Array.from({ length: n }, (_, i) => ({
      id_interno: `REG-${i}`, fecha: "2026-06-15", monto: 100 + (i % 50),
      referencia: `SR11-${i}`, contraparte: null, descripcion: `PA-WIN-${i}`, tipo: "cobranza",
    })),
    pendientes_bancarios: Array.from({ length: m }, (_, j) => ({
      id_movimiento: `BCO-${j}`, fecha: "2026-06-15", monto: 100 + (j % 50),
      referencia_banco: `SR11-${j}`, glosa: `EFECTIVO${j}`, tipo: "abono",
    })),
  });

  const correrCandidatos = (entrada: unknown) => {
    const src = readFileSync(join(DIR2, "ia_llm_01_candidatos.js"), "utf8")
      .replace("$('Webhook').first().json", "({ body: {} })");
    return new Function("$json", src)(entrada)[0].json;
  };

  const correrParsear = (deCandidatos: unknown, respuestaIa: unknown) => {
    const src = readFileSync(join(DIR2, "ia_llm_02_parsear.js"), "utf8")
      .replace("$('Candidatos IA').first().json", "__PREP__");
    return new Function("$json", "__PREP__", src)(respuestaIa, deCandidatos)[0].json;
  };

  const correrEnsamblar = (entrada: unknown) =>
    new Function("$json", readFileSync(join(DIR2, "04_ensamblar.js"), "utf8"))(entrada)[0]
      .json.resultado_update.resultado;

  it("con la IA caída, el resultado sale igual y nada queda a medias", () => {
    // Una IA que no contesta es lo más probable que puede fallar: es un
    // servicio externo. Tiene que hacer MENOS, no romper — si rompe, se pierde
    // el 99% que ya estaba resuelto.
    const cand = correrCandidatos(residuo(4382, 3204));
    const parseado = correrParsear(cand, {}); // sin `output`: el LLM no respondió
    const resultado = correrEnsamblar(parseado);

    expect(resultado.resumen.sugeridos_ia).toBe(0);
    // Ninguna partida se pierde por el camino.
    expect(resultado.resumen.sin_conciliar_internos).toBe(4382);
    expect(resultado.resumen.sin_conciliar_bancarios).toBe(3204);
    expect(resultado.no_conciliados).toHaveLength(4382 + 3204);
    expect(resultado.cuadre).toBeTruthy();
  });

  it("el prompt cabe en un modelo real", () => {
    // Con 4.382 internos el prompt llegó a pesar 4,7 MB (~1,2 millones de
    // tokens): ningún modelo lo acepta. Se acota a los casos con duda real.
    const cand = correrCandidatos(residuo(4382, 3204));
    expect(String(cand.ia_user).length).toBeLessThan(500 * 1024);
    expect(cand.shortlists.length).toBeLessThanOrEqual(150);
  });

  it("solo se adjudica lo que el modelo llegó a ver", () => {
    // Aceptar una adjudicación sobre un registro que no estaba en el prompt
    // sería aceptar una invención del modelo.
    const cand = correrCandidatos(residuo(50, 50));
    const inventado = { output: JSON.stringify([
      { id_interno: "REG-9999", id_movimiento: "BCO-0", confianza: 0.99 },
    ]) };
    const parseado = correrParsear(cand, inventado);
    expect(parseado.matches).toHaveLength(0);
  });
});
