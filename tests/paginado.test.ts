import { describe, it, expect } from "vitest";
import { traerTodo, enLotes } from "@/lib/supabase/paginado";

/** Simula PostgREST: nunca devuelve más de `tope` filas por petición. */
function fakePostgrest(total: number, tope = 1000) {
  const llamadas: [number, number][] = [];
  const consulta = async (desde: number, hasta: number) => {
    llamadas.push([desde, hasta]);
    const fin = Math.min(hasta + 1, desde + tope, total);
    const data = Array.from({ length: Math.max(0, fin - desde) }, (_, i) => ({
      id: desde + i,
    }));
    return { data, error: null };
  };
  return { consulta, llamadas };
}

describe("traerTodo", () => {
  it("trae más de 1.000 filas, que es el fallo que motivó esto", () => {
    // 20.000 comprobantes devolvían 1.000 y un 200 OK: el motor conciliaba el
    // 5% del mes sin que nada lo dijera.
    return traerTodo(fakePostgrest(20000).consulta).then((filas) => {
      expect(filas).toHaveLength(20000);
    });
  });

  it("para en cuanto una página vuelve incompleta", async () => {
    const f = fakePostgrest(1500);
    await traerTodo(f.consulta);
    expect(f.llamadas).toHaveLength(2); // 0-999 y 1000-1999
  });

  it("no hace una petición de más cuando el total es múltiplo exacto", async () => {
    const f = fakePostgrest(2000);
    const filas = await traerTodo(f.consulta);
    expect(filas).toHaveLength(2000);
    expect(f.llamadas).toHaveLength(3); // la tercera confirma que no hay más
  });

  it("con menos de una página hace una sola petición", async () => {
    const f = fakePostgrest(10);
    expect(await traerTodo(f.consulta)).toHaveLength(10);
    expect(f.llamadas).toHaveLength(1);
  });

  it("sin filas devuelve lista vacía", async () => {
    expect(await traerTodo(fakePostgrest(0).consulta)).toEqual([]);
  });

  it("un error corta en vez de girar sin fin", async () => {
    const consulta = async () => ({ data: null, error: new Error("boom") });
    expect(await traerTodo(consulta)).toEqual([]);
  });

  it("respeta el tope de seguridad", async () => {
    const filas = await traerTodo(fakePostgrest(999999).consulta, 3000);
    expect(filas).toHaveLength(3000);
  });

  it("aguanta que el servidor tenga una página más pequeña", async () => {
    // Si `db-max-rows` fuera 500, la primera página vuelve incompleta y para.
    const filas = await traerTodo(fakePostgrest(20000, 500).consulta);
    expect(filas).toHaveLength(500);
  });
});

describe("enLotes", () => {
  it("trocea para que el .in() no reviente por longitud de URL", () => {
    expect(enLotes(Array.from({ length: 250 }, (_, i) => i)).map((l) => l.length))
      .toEqual([100, 100, 50]);
  });

  it("una lista vacía no genera lotes", () => {
    expect(enLotes([])).toEqual([]);
  });

  it("menos que el tamaño de lote va en uno solo", () => {
    expect(enLotes([1, 2, 3])).toEqual([[1, 2, 3]]);
  });

  it("respeta un tamaño explícito", () => {
    expect(enLotes([1, 2, 3, 4, 5], 2).map((l) => l.length)).toEqual([2, 2, 1]);
  });
});

describe("tamaño de lote y longitud de URL", () => {
  it("100 UUIDs caben de sobra en una URL; 500 no", () => {
    // El fallo real: "Empezar de cero" con 20.000 comprobantes troceaba en
    // lotes de 500 → ~19.500 caracteres de query string, muy por encima del
    // límite de nginx/kong (8.192), y el borrado fallaba sin explicar por qué.
    const UUID = 36 + 3; // el id más comillas y coma en el filtro `in.(...)`
    const lotes = enLotes(Array.from({ length: 20000 }, (_, i) => i));
    expect(lotes[0]!.length * UUID).toBeLessThan(8192);
    expect(500 * UUID).toBeGreaterThan(8192);
  });
});

describe("orden total en las consultas paginadas", () => {
  it("toda consulta con .range() ordena por una columna única", () => {
    // Sin desempate, cada página re-ejecuta la consulta y Postgres puede
    // devolver las filas empatadas en otro orden: unas salen dos veces y otras
    // no salen nunca. Le pasó a getComprobantesCanonicos ordenando solo por
    // `fecha`: mandó 852 comprobantes duplicados al motor y se dejó otros 852
    // sin enviar, con el total cuadrando — invisible desde fuera.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");

    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) recorrer(p);
        else if (/\.tsx?$/.test(e.name)) archivos.push(p);
      }
    };
    recorrer("src");

    const sinDesempate: string[] = [];
    for (const f of archivos) {
      const src = fs.readFileSync(f, "utf8");
      // Cada bloque que llega a `.range(d, h)`: mirar hacia atrás su consulta.
      let i = src.indexOf(".range(d, h)");
      while (i !== -1) {
        const bloque = src.slice(Math.max(0, i - 700), i);
        const desde = bloque.lastIndexOf(".from(");
        if (desde !== -1 && !/\.order\(\s*"id"/.test(bloque.slice(desde))) {
          sinDesempate.push(`${f}: ${bloque.slice(desde, desde + 60).replace(/\s+/g, " ")}`);
        }
        i = src.indexOf(".range(d, h)", i + 1);
      }
    }
    expect(sinDesempate).toEqual([]);
  });
});
