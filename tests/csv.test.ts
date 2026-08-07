import { describe, it, expect } from "vitest";
import { LectorCsv, detectarSeparador, partirLinea } from "@/lib/parsing/csv";

const leerTodo = (texto: string, tamTrozo = 7) => {
  const l = new LectorCsv();
  const filas = [];
  for (let i = 0; i < texto.length; i += tamTrozo) {
    filas.push(...l.trozo(texto.slice(i, i + tamTrozo)));
  }
  filas.push(...l.fin());
  return { filas, headers: l.encabezados };
};

describe("detectarSeparador", () => {
  it("reconoce el punto y coma de los Excel en español", () => {
    expect(detectarSeparador("fecha;monto;tipo")).toBe(";");
    expect(detectarSeparador("fecha,monto,tipo")).toBe(",");
  });

  it("no cuenta separadores dentro de comillas", () => {
    expect(detectarSeparador('"Lima, Perú";monto')).toBe(";");
  });
});

describe("partirLinea", () => {
  it("respeta las comillas", () => {
    expect(partirLinea('a,"b,c",d', ",")).toEqual(["a", "b,c", "d"]);
  });

  it("convierte las comillas escapadas", () => {
    expect(partirLinea('a,"di ""hola""",b', ",")).toEqual(["a", 'di "hola"', "b"]);
  });

  it("conserva los campos vacíos", () => {
    expect(partirLinea("a,,c", ",")).toEqual(["a", "", "c"]);
  });
});

describe("LectorCsv — lectura incremental", () => {
  it("da las mismas filas venga el texto de una pieza o a trozos", () => {
    // Es el punto entero del lector: el resultado no puede depender de por
    // dónde parta la red el archivo.
    const csv = "fecha,monto\n01/06/2026,99.00\n02/06/2026,159.00\n";
    const enteroU = leerTodo(csv, csv.length);
    const troceado = leerTodo(csv, 3);
    expect(troceado.filas).toEqual(enteroU.filas);
    expect(troceado.filas).toHaveLength(2);
    expect(troceado.filas[0]).toEqual({ fecha: "01/06/2026", monto: "99.00" });
  });

  it("un salto de línea dentro de comillas NO parte la fila", () => {
    const { filas } = leerTodo('a,b\n"linea\ncontinua",2\n');
    expect(filas).toHaveLength(1);
    expect(filas[0]!.a).toBe("linea\ncontinua");
  });

  it("aguanta CRLF", () => {
    const { filas } = leerTodo("a,b\r\n1,2\r\n");
    expect(filas).toEqual([{ a: "1", b: "2" }]);
  });

  it("recoge la última línea aunque no acabe en salto", () => {
    const { filas } = leerTodo("a,b\n1,2");
    expect(filas).toEqual([{ a: "1", b: "2" }]);
  });

  it("quita el BOM del primer encabezado", () => {
    // Sin esto, la primera columna se llama "\ufefffecha" y nada coincide.
    const { headers } = leerTodo("\ufefffecha,monto\n01/06/2026,99\n");
    expect(headers[0]).toBe("fecha");
  });

  it("ignora líneas en blanco", () => {
    const { filas } = leerTodo("a,b\n\n1,2\n\n3,4\n");
    expect(filas).toHaveLength(2);
  });

  it("rellena las columnas que falten en una fila corta", () => {
    const { filas } = leerTodo("a,b,c\n1,2\n");
    expect(filas[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  it("con separador ;", () => {
    const { filas } = leerTodo("fecha;monto\n01/06/2026;99,00\n");
    expect(filas[0]).toEqual({ fecha: "01/06/2026", monto: "99,00" });
  });
});
