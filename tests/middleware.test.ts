import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * El matcher del middleware es de seguridad de datos, no de rendimiento.
 *
 * Con middleware activo, Next clona el cuerpo de la petición para pasárselo, y
 * ese clon tiene un tope de 10 MB que al superarse **trunca en silencio**: ni
 * error ni 413, un cuerpo cortado. Ver el comentario largo en
 * `src/middleware.ts`.
 *
 * Estos tests existen porque el arreglo vive en una regex y no se parece a un
 * arreglo: quien la vea puede "simplificarla" sin saber qué sostiene.
 */

const RAIZ = join(__dirname, "..", "src");

function matcherDelMiddleware(): RegExp {
  const fuente = readFileSync(join(RAIZ, "middleware.ts"), "utf8");
  const m = fuente.match(/matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  if (!m?.[1]) throw new Error("No se pudo leer el matcher de src/middleware.ts");
  // El literal del archivo trae los escapes de TypeScript; JSON.parse los
  // resuelve igual que lo haría el compilador.
  return new RegExp(`^${JSON.parse(`"${m[1]}"`)}$`);
}

/** Todas las rutas de API del repo, como el path por el que se las llama. */
function rutasApi(): { path: string; fuente: string }[] {
  const salida: { path: string; fuente: string }[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const completo = join(dir, entrada);
      if (statSync(completo).isDirectory()) recorrer(completo);
      else if (entrada === "route.ts") {
        const rel = completo
          .slice(join(RAIZ, "app").length)
          .replace(/\\/g, "/")
          .replace(/\/route\.ts$/, "");
        salida.push({ path: rel, fuente: readFileSync(completo, "utf8") });
      }
    }
  };
  recorrer(join(RAIZ, "app", "api"));
  return salida;
}

describe("matcher del middleware", () => {
  const matcher = matcherDelMiddleware();

  it("sigue protegiendo las páginas", () => {
    expect(matcher.test("/dashboard")).toBe(true);
    expect(matcher.test("/wizard")).toBe(true);
    expect(matcher.test("/comprobantes")).toBe(true);
  });

  it("deja fuera las rutas de cuerpo grande", () => {
    // Si alguna vuelve a entrar, su cuerpo se trunca a los 10 MB sin avisar.
    expect(matcher.test("/api/conciliacion/iniciar")).toBe(false);
    expect(matcher.test("/api/comprobantes/importar")).toBe(false);
    expect(matcher.test("/api/webhooks/resultado-conciliacion")).toBe(false);
  });

  it("excluye TODA ruta que reciba un archivo", () => {
    // Un `formData()` en una API es una subida: crece con los datos del
    // cliente por definición, así que no puede pasar por el clonado.
    const conArchivo = rutasApi().filter((r) => /request\.formData\(/.test(r.fuente));
    expect(conArchivo.length).toBeGreaterThan(0); // que el escáner sirva de algo
    for (const r of conArchivo) {
      expect(matcher.test(r.path), `${r.path} recibe un archivo y el middleware la intercepta: su cuerpo se truncará a los 10 MB en silencio. Añádela al matcher de src/middleware.ts.`).toBe(false);
    }
  });
});
