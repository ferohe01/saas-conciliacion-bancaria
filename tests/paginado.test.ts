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
    expect(enLotes(Array.from({ length: 1200 }, (_, i) => i)).map((l) => l.length))
      .toEqual([500, 500, 200]);
  });

  it("una lista vacía no genera lotes", () => {
    expect(enLotes([])).toEqual([]);
  });

  it("menos que el tamaño de lote va en uno solo", () => {
    expect(enLotes([1, 2, 3])).toEqual([[1, 2, 3]]);
  });
});
