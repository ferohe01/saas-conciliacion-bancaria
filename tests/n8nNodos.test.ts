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
