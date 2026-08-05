import { describe, it, expect } from "vitest";
import {
  MOTIVOS_RECHAZO,
  buscarMotivo,
  etiquetaMotivo,
  contarMotivos,
} from "@/lib/motivosRechazo";

describe("catálogo de motivos", () => {
  it("tiene ids únicos", () => {
    const ids = MOTIVOS_RECHAZO.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("incluye una escapatoria honesta", () => {
    // Sin "otro", quien no sabe que poner elige cualquiera con tal de seguir, y
    // eso envenena el aprendizaje con datos inventados.
    expect(buscarMotivo("otro")).toBeDefined();
  });

  it("cada motivo trae su frase para el prompt", () => {
    for (const m of MOTIVOS_RECHAZO) {
      expect(m.paraIa.length).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(0);
    }
  });
});

describe("etiquetaMotivo", () => {
  it("nunca deja el hueco en blanco", () => {
    expect(etiquetaMotivo(null)).toBe("Sin motivo indicado");
    expect(etiquetaMotivo(undefined)).toBe("Sin motivo indicado");
  });

  it("un código retirado se muestra tal cual en vez de desaparecer", () => {
    // Las decisiones ya guardadas seguiran trayendo codigos viejos.
    expect(etiquetaMotivo("codigo_antiguo")).toBe("codigo_antiguo");
  });
});

describe("contarMotivos", () => {
  it("ordena de más a menos frecuente", () => {
    const { filas } = contarMotivos([
      "fecha_no_cuadra",
      "otra_contraparte",
      "otra_contraparte",
    ]);
    expect(filas[0]!.id).toBe("otra_contraparte");
    expect(filas[0]!.n).toBe(2);
  });

  it("los rechazos sin motivo se cuentan aparte, no se pierden", () => {
    // Si desaparecieran, el total no cuadraria con el de rechazos y el panel
    // pareceria estar perdiendo datos.
    const { filas, sinMotivo } = contarMotivos([null, "otro", undefined]);
    expect(sinMotivo).toBe(2);
    expect(filas).toHaveLength(1);
  });

  it("sin datos no revienta", () => {
    expect(contarMotivos([])).toEqual({ filas: [], sinMotivo: 0 });
  });
});
