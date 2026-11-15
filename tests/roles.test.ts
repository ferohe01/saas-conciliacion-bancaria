import { describe, it, expect } from "vitest";
import {
  ROLES,
  PERMISOS,
  dejaSinAdministrador,
  motivoSinPermiso,
  puede,
  rolDe,
  separacionAlAprobar,
} from "@/lib/roles";

describe("rolDe", () => {
  it("el 'admin' de antes de la 0057 es administrador", () => {
    expect(rolDe("admin")).toBe("administrador");
  });

  it("los cuatro roles se reconocen tal cual", () => {
    for (const r of ROLES) expect(rolDe(r)).toBe(r);
  });

  it("un valor desconocido degrada a consulta, nunca al revés", () => {
    expect(rolDe("superusuario")).toBe("consulta");
    expect(rolDe(null)).toBe("consulta");
    expect(rolDe(undefined)).toBe("consulta");
    expect(rolDe("ADMINISTRADOR")).toBe("consulta");
  });
});

describe("puede", () => {
  it("el administrador puede todo", () => {
    for (const p of PERMISOS) expect(puede("administrador", p)).toBe(true);
  });

  it("consulta no puede nada", () => {
    for (const p of PERMISOS) expect(puede("consulta", p)).toBe(false);
  });

  it("el conciliador concilia y decide, pero no aprueba", () => {
    expect(puede("conciliador", "conciliar")).toBe(true);
    expect(puede("conciliador", "decidir")).toBe(true);
    expect(puede("conciliador", "aprobar")).toBe(false);
    expect(puede("conciliador", "configurar")).toBe(false);
  });

  it("el aprobador aprueba, pero no gestiona usuarios ni configuración", () => {
    expect(puede("aprobador", "aprobar")).toBe(true);
    expect(puede("aprobador", "gestionar_usuarios")).toBe(false);
    expect(puede("aprobador", "configurar")).toBe(false);
  });

  it("el motivo nombra el rol y qué no puede hacer", () => {
    expect(motivoSinPermiso("conciliador", "aprobar")).toContain("Conciliador");
    expect(motivoSinPermiso("conciliador", "aprobar")).toContain("aprobar");
  });
});

describe("separación de funciones al aprobar", () => {
  it("quien no inició la conciliación puede aprobarla", () => {
    expect(separacionAlAprobar({ aprobadorId: "b", iniciadorId: "a", otrosAprobadores: 1 }).ok).toBe(true);
  });

  it("quien la inició no puede aprobarla si hay otro aprobador", () => {
    const r = separacionAlAprobar({ aprobadorId: "a", iniciadorId: "a", otrosAprobadores: 1 });
    expect(r.ok).toBe(false);
  });

  it("una empresa de un solo aprobador no queda bloqueada", () => {
    expect(separacionAlAprobar({ aprobadorId: "a", iniciadorId: "a", otrosAprobadores: 0 }).ok).toBe(true);
  });

  it("una conciliación sin iniciador registrado no bloquea", () => {
    expect(separacionAlAprobar({ aprobadorId: "a", iniciadorId: null, otrosAprobadores: 3 }).ok).toBe(true);
  });
});

describe("la empresa nunca se queda sin administrador", () => {
  const equipo = [
    { usuarioId: "a", rol: "administrador" as const },
    { usuarioId: "b", rol: "conciliador" as const },
  ];

  it("bajar de rol al único administrador se impide", () => {
    expect(dejaSinAdministrador(equipo, { usuarioId: "a", nuevoRol: "aprobador" })).toBe(true);
  });

  it("quitar al único administrador se impide", () => {
    expect(dejaSinAdministrador(equipo, { usuarioId: "a", nuevoRol: null })).toBe(true);
  });

  it("con otro administrador, sí se puede", () => {
    expect(
      dejaSinAdministrador(
        [...equipo, { usuarioId: "c", rol: "administrador" }],
        { usuarioId: "a", nuevoRol: "consulta" },
      ),
    ).toBe(false);
  });

  it("cambiar a otro miembro no afecta", () => {
    expect(dejaSinAdministrador(equipo, { usuarioId: "b", nuevoRol: "aprobador" })).toBe(false);
  });
});
