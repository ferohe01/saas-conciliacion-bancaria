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
