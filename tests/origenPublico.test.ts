import { describe, it, expect } from "vitest";
import { origenPublico } from "@/lib/origenPublico";

const h = (o: Record<string, string>) => new Headers(o);

describe("origenPublico", () => {
  it("usa el host y el esquema que deja el proxy, no el del contenedor", () => {
    expect(
      origenPublico(
        h({ host: "0.0.0.0:3000", "x-forwarded-host": "conciliacion.fernandorh.com", "x-forwarded-proto": "https" }),
        "https://0.0.0.0:3000",
      ),
    ).toBe("https://conciliacion.fernandorh.com");
  });

  it("sin proxy, un dominio va por https y localhost por http", () => {
    expect(origenPublico(h({ host: "app.ejemplo.pe" }), "x")).toBe("https://app.ejemplo.pe");
    expect(origenPublico(h({ host: "localhost:3000" }), "x")).toBe("http://localhost:3000");
  });

  it("con varios proxies encadenados se queda con el primero", () => {
    expect(
      origenPublico(h({ "x-forwarded-host": "a.pe, b.pe", "x-forwarded-proto": "https, http" }), "x"),
    ).toBe("https://a.pe");
  });

  it("sin cabeceras usa el respaldo", () => {
    expect(origenPublico(h({}), "http://localhost:3000")).toBe("http://localhost:3000");
  });
});
