import { describe, it, expect } from "vitest";
import {
  SISTEMAS_ERP,
  FRECUENCIAS,
  buscarSistema,
  estadoConexion,
  nombreSistema,
} from "@/lib/conexiones";
import { ConexionErpInput } from "@/lib/conexiones-schema";

describe("catálogo de sistemas", () => {
  it("tiene ids únicos", () => {
    const ids = SISTEMAS_ERP.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("incluye 'otro' como salida para quien no está en la lista", () => {
    expect(buscarSistema("otro")).toBeDefined();
  });

  it("devuelve undefined para un id que no existe", () => {
    expect(buscarSistema("sistema_inventado")).toBeUndefined();
  });

  it("las frecuencias coinciden con las que acepta el esquema", () => {
    expect(FRECUENCIAS.map((f) => f.id).sort()).toEqual([
      "diaria",
      "manual",
      "semanal",
    ]);
  });
});

describe("estadoConexion", () => {
  // Lo que de verdad importa de esta función: que solo 'activa' se cuente como
  // que algo se está trayendo. Cualquier otro estado —incluido uno desconocido
  // llegado de la BD— tiene que caer del lado de "todavía no".
  it("solo 'activa' sincroniza", () => {
    expect(estadoConexion("activa").sincroniza).toBe(true);
    for (const e of ["registrada", "en_preparacion", "pausada", "vaya_usted_a_saber"]) {
      expect(estadoConexion(e).sincroniza).toBe(false);
    }
  });

  it("un estado desconocido se degrada a 'registrada', no a activa", () => {
    expect(estadoConexion("").id).toBe("registrada");
    expect(estadoConexion("cualquier_cosa").id).toBe("registrada");
  });

  it("cada estado se explica con palabras, no solo con color", () => {
    for (const e of ["registrada", "en_preparacion", "activa", "pausada"]) {
      const r = estadoConexion(e);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.descripcion.length).toBeGreaterThan(0);
    }
  });
});

describe("nombreSistema", () => {
  it("usa el nombre del catálogo", () => {
    expect(nombreSistema({ sistema: "nubefact" })).toBe("Nubefact");
  });

  it("con 'otro' usa lo que escribió el usuario", () => {
    expect(
      nombreSistema({ sistema: "otro", nombre_sistema: "  Mi Facturador SAC " }),
    ).toBe("Mi Facturador SAC");
  });

  it("con 'otro' sin nombre no se queda en blanco", () => {
    expect(nombreSistema({ sistema: "otro", nombre_sistema: null })).toBe(
      "Otro sistema",
    );
  });

  it("un sistema que ya no está en el catálogo no desaparece de la pantalla", () => {
    // Si mañana se retira un id del catálogo, las fichas existentes tienen que
    // seguir mostrando algo legible en vez de una tarjeta sin título.
    expect(nombreSistema({ sistema: "erp_retirado" })).toBe("erp_retirado");
  });
});

describe("ConexionErpInput", () => {
  const base = { sistema: "nubefact", frecuencia: "diaria" as const };

  it("acepta lo mínimo: sistema y frecuencia", () => {
    const r = ConexionErpInput.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("exige elegir un sistema", () => {
    expect(ConexionErpInput.safeParse({ ...base, sistema: "" }).success).toBe(
      false,
    );
  });

  it("'otro' sin nombre se rechaza, y el error apunta al campo", () => {
    const r = ConexionErpInput.safeParse({ ...base, sistema: "otro" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path[0]).toBe("nombre_sistema");
  });

  it("'otro' con nombre se acepta", () => {
    expect(
      ConexionErpInput.safeParse({
        ...base,
        sistema: "otro",
        nombre_sistema: "Mi Facturador",
      }).success,
    ).toBe(true);
  });

  it("los vacíos se guardan como null, no como cadena vacía", () => {
    const r = ConexionErpInput.parse({
      ...base,
      url_base: "",
      identificador: "  ",
      contacto: "",
      notas: "",
    });
    expect(r.url_base).toBeNull();
    expect(r.identificador).toBeNull();
    expect(r.contacto).toBeNull();
    expect(r.notas).toBeNull();
  });

  it("acepta una URL https", () => {
    const r = ConexionErpInput.parse({
      ...base,
      url_base: " https://api.tusistema.com ",
    });
    expect(r.url_base).toBe("https://api.tusistema.com");
  });

  it("rechaza http: no vamos a consumir facturación en claro", () => {
    expect(
      ConexionErpInput.safeParse({ ...base, url_base: "http://api.tusistema.com" })
        .success,
    ).toBe(false);
  });

  it("rechaza algo que no es una URL", () => {
    expect(
      ConexionErpInput.safeParse({ ...base, url_base: "mi sistema" }).success,
    ).toBe(false);
  });

  it("rechaza una frecuencia fuera del check de la tabla", () => {
    expect(
      ConexionErpInput.safeParse({ ...base, frecuencia: "cada hora" }).success,
    ).toBe(false);
  });
});
