import { describe, it, expect } from "vitest";
import { generarCandidatos } from "@/lib/matching/candidatos";
import type {
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";

const cfg = { tolerancia_ia_monto: 10, tolerancia_dias: 3, top_k: 3 };

function interno(p: Partial<RegistroInterno>): RegistroInterno {
  return {
    id_interno: "REG-0001",
    fecha: "2026-07-03",
    monto: 4950,
    tipo: "cobranza",
    referencia: null,
    contraparte: "Ferretería Lima Norte EIRL",
    descripcion: null,
    ...p,
  };
}
function banco(p: Partial<MovimientoBancario>): MovimientoBancario {
  return {
    id_movimiento: "BCO-0001",
    fecha: "2026-07-03",
    monto: 4945,
    tipo: "abono",
    glosa: "TRANSF CCE FERRETERIA LIMA",
    referencia_banco: null,
    ...p,
  };
}

describe("generarCandidatos", () => {
  it("genera un candidato con features y score cuando hay coincidencia de nombre", () => {
    const sl = generarCandidatos([interno({})], [banco({})], cfg);
    expect(sl).toHaveLength(1);
    const c = sl[0]!.candidatos[0]!;
    expect(c.id_movimiento).toBe("BCO-0001");
    expect(c.features.palabras_comunes).toEqual(
      expect.arrayContaining(["FERRETERIA", "LIMA"]),
    );
    expect(c.features.dif_abs).toBeCloseTo(5);
    expect(c.score).toBeGreaterThan(0);
    expect(c.categoria_probable).toBe("comision_bancaria");
  });

  it("descarta candidatos sin ninguna palabra en común", () => {
    const it = interno({ contraparte: "Sofía Gamarra Mendoza" });
    const bc = banco({ glosa: "DEPOSITO X. GUTIERREZ", monto: 4948 });
    expect(generarCandidatos([it], [bc], cfg)).toHaveLength(0);
  });

  it("descarta candidatos fuera de la banda de monto de IA", () => {
    const bc = banco({ monto: 4700 }); // dif 250 > 10
    expect(generarCandidatos([interno({})], [bc], cfg)).toHaveLength(0);
  });

  it("rankea por score y respeta top-K", () => {
    const it = interno({ contraparte: "Ferretería Lima Norte" });
    const bancos = [
      banco({ id_movimiento: "BCO-A", glosa: "TRANSF FERRETERIA LIMA NORTE", monto: 4950 }), // mejor
      banco({ id_movimiento: "BCO-B", glosa: "PAGO FERRETERIA", monto: 4945 }),
      banco({ id_movimiento: "BCO-C", glosa: "ABONO LIMA", monto: 4942 }),
      banco({ id_movimiento: "BCO-D", glosa: "TRANSF LIMA", monto: 4941 }),
    ];
    const sl = generarCandidatos([it], bancos, { ...cfg, top_k: 2 });
    expect(sl[0]!.candidatos).toHaveLength(2);
    expect(sl[0]!.candidatos[0]!.id_movimiento).toBe("BCO-A");
    // ordenado por score descendente
    expect(sl[0]!.candidatos[0]!.score).toBeGreaterThanOrEqual(
      sl[0]!.candidatos[1]!.score,
    );
  });

  it("marca comparte_ref cuando la referencia coincide", () => {
    const it = interno({ referencia: "OP-778812" });
    const bc = banco({ referencia_banco: "OP778812" });
    const c = generarCandidatos([it], [bc], cfg)[0]!.candidatos[0]!;
    expect(c.features.comparte_ref).toBe(true);
  });

  it("admite candidato por referencia exacta aunque la glosa no traiga el nombre", () => {
    const it = interno({
      contraparte: "Juan Pérez Quispe",
      referencia: "OP-999",
      monto: 1000,
    });
    const bc = banco({
      glosa: "DEPOSITO EN EFECTIVO", // sin palabras del nombre
      referencia_banco: "OP999",
      monto: 1000,
    });
    const sl = generarCandidatos([it], [bc], cfg);
    expect(sl).toHaveLength(1);
    expect(sl[0]!.candidatos[0]!.features.comparte_ref).toBe(true);
    expect(sl[0]!.candidatos[0]!.features.palabras_comunes).toEqual([]);
  });
});
