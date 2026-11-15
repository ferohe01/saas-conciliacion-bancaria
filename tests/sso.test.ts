import { describe, it, expect } from "vitest";
import { altaPorSso, datosParaElProveedor, dominioDe, normalizarDominio } from "@/lib/sso";

describe("dominioDe", () => {
  it("saca el dominio en minúsculas", () => {
    expect(dominioDe("Ana.Perez@WIN.pe")).toBe("win.pe");
  });

  it("rechaza lo que no es un correo", () => {
    expect(dominioDe("ana")).toBeNull();
    expect(dominioDe("ana@")).toBeNull();
    expect(dominioDe("@win.pe")).toBeNull();
    expect(dominioDe(null)).toBeNull();
  });
});

describe("normalizarDominio", () => {
  it("acepta lo que suele escribir un administrador", () => {
    expect(normalizarDominio("  @WIN.pe ")).toBe("win.pe");
    expect(normalizarDominio("https://win.pe/")).toBe("win.pe");
  });

  it("rechaza lo que no es un dominio", () => {
    expect(normalizarDominio("win")).toBeNull();
    expect(normalizarDominio("")).toBeNull();
  });
});

describe("altaPorSso", () => {
  const proveedores = [
    { empresaId: "E1", providerId: "p-win", dominio: "win.pe", rolPorDefecto: "conciliador" },
  ];

  it("da de alta con el rol por defecto a quien entró por el SSO de su empresa", () => {
    expect(
      altaPorSso({ email: "ana@win.pe", proveedorDeLaSesion: "sso:p-win", proveedores }),
    ).toEqual({ empresaId: "E1", rol: "conciliador" });
  });

  it("NO da de alta a quien solo tiene el dominio pero entró con contraseña", () => {
    // Sin esto, registrarse con alguien@win.pe abriría la empresa a cualquiera.
    expect(
      altaPorSso({ email: "ana@win.pe", proveedorDeLaSesion: "email", proveedores }),
    ).toBeNull();
  });

  it("NO da de alta si el SSO es de otro proveedor", () => {
    expect(
      altaPorSso({ email: "ana@win.pe", proveedorDeLaSesion: "sso:otro", proveedores }),
    ).toBeNull();
  });

  it("un dominio sin proveedor no da de alta a nadie", () => {
    expect(
      altaPorSso({ email: "ana@otra.pe", proveedorDeLaSesion: "sso:p-win", proveedores }),
    ).toBeNull();
  });

  it("un rol por defecto desconocido degrada a consulta", () => {
    expect(
      altaPorSso({
        email: "ana@win.pe",
        proveedorDeLaSesion: "sso:p-win",
        proveedores: [{ ...proveedores[0]!, rolPorDefecto: "jefe" }],
      })?.rol,
    ).toBe("consulta");
  });
});

describe("datosParaElProveedor", () => {
  it("arma las URLs SAML de Supabase sin barras dobles", () => {
    const d = datosParaElProveedor("https://supabase.fernandorh.com/");
    expect(d.acsUrl).toBe("https://supabase.fernandorh.com/auth/v1/sso/saml/acs");
    expect(d.entityId).toBe("https://supabase.fernandorh.com/auth/v1/sso/saml/metadata");
  });
});
