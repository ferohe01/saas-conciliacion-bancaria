import { describe, it, expect } from "vitest";
import { detectarColumnasConDudas } from "@/lib/parsing/deteccion";
import { normalizarBancarios } from "@/lib/normalizacion/canonico";
import type { MovimientoBancario, RegistroInterno } from "@/lib/contract/payload";
import { capaExacta } from "@/lib/motor/exacta";

/**
 * El caso completo, con los dos archivos reales de un cliente: por qué una
 * conciliación perfectamente emparejable terminó en CERO pares.
 *
 * Los datos casaban al céntimo —REF-1001 a REF-1007, mismo importe, misma
 * fecha, mismo nombre— y el motor no encontró nada. La causa no estaba en el
 * motor sino dos pasos antes, en qué columna se eligió como referencia:
 *
 *     Nro Operacion   OP-500001 …   ← el código interno del banco
 *     Nro Referencia  REF-1001  …   ← lo que casa con los comprobantes
 *
 * Con la columna equivocada, las cinco capas se apagan en cadena: la exacta
 * compara `REF-1002` contra `OP-500002`; el respaldo por monto+fecha lo bloquea
 * la guarda de contradicción de referencias (haciendo bien su trabajo, ver
 * `src/lib/motor/exacta.ts`); y la difusa, la agrupación y la IA exigen todas
 * identidad compartida, que tampoco hay.
 *
 * Este test recorre el camino entero —detección → normalización → capa
 * exacta— porque el fallo solo es visible al final: cada pieza por separado
 * hacía exactamente lo que debía.
 */

const correrExacta = (entrada: {
  registros_internos: RegistroInterno[];
  movimientos_bancarios: MovimientoBancario[];
}) => {
  const e = capaExacta(entrada.registros_internos, entrada.movimientos_bancarios);
  return {
    matches: e.matches,
    pendientes_internos: e.pendientesInternos,
    pendientes_bancarios: e.pendientesBancarios,
  };
};

// ── El extracto del banco, tal cual lo entrega ────────────────────────────
const HEADERS = [
  "Nro Operacion",
  "Nro Referencia",
  "Fecha de Pago",
  "Concepto / Cliente",
  "Monto Abonado (S/)",
];
const EXTRACTO = [
  ["OP-500001", "REF-1001", "2026-08-27", "Pago Empresa Alfa SAC", "1,500.00"],
  ["OP-500002", "REF-1002", "2026-08-27", "Pago Comercial Beta EIRL", "2,300.50"],
  ["OP-500003", "REF-1003", "2026-08-28", "Pago Industrias Gamma SA", "980.00"],
  ["OP-500004", "REF-1004", "2026-08-29", "Pago Distribuidora Delta SRL", "4,200.00"],
  ["OP-500005", "REF-1005", "2026-08-29", "Pago Servicios Epsilon SAC", "650.75"],
  ["OP-500006", "REF-1006", "2026-08-30", "Pago Corporacion Zeta SA", "3,100.00"],
  ["OP-500007", "REF-1007", "2026-08-30", "Pago Grupo Eta SAC", "1,780.25"],
  ["OP-500008", "REF-2001", "2026-08-27", "Pago Cliente Externo Lambda", "750.00"],
  ["OP-500009", "REF-2002", "2026-08-28", "Pago Cliente Externo Mu", "1,200.00"],
  ["OP-500010", "REF-2003", "2026-08-29", "Pago Cliente Externo Nu", "3,400.00"],
  ["OP-500011", "REF-2004", "2026-08-30", "Pago Cliente Externo Xi", "560.00"],
  ["OP-500012", "REF-2005", "2026-08-31", "Pago Cliente Externo Omicron", "920.00"],
  ["OP-500013", "REF-1008", "2026-08-31", "Pago parcial Inversiones Theta SRL", "445.00"],
  ["OP-500014", "REF-1001", "2026-08-31", "Pago Empresa Alfa SAC (duplicado)", "1,500.00"],
  ["OP-500015", "REF-1006", "2026-08-31", "Pago Corporacion Zeta SA (dif. monto)", "3,105.00"],
].map((r) => Object.fromEntries(HEADERS.map((h, i) => [h, r[i]])));

// ── Los comprobantes, como salen de la plantilla ──────────────────────────
const INTERNOS: RegistroInterno[] = [
  ["2026-08-27", 1500.0, "REF-1001", "Empresa Alfa SAC"],
  ["2026-08-27", 2300.5, "REF-1002", "Comercial Beta EIRL"],
  ["2026-08-28", 980.0, "REF-1003", "Industrias Gamma SA"],
  ["2026-08-28", 4200.0, "REF-1004", "Distribuidora Delta SRL"],
  ["2026-08-29", 650.75, "REF-1005", "Servicios Epsilon SAC"],
  ["2026-08-29", 3100.0, "REF-1006", "Corporacion Zeta SA"],
  ["2026-08-30", 1780.25, "REF-1007", "Grupo Eta SAC"],
  ["2026-08-30", 890.0, "REF-1008", "Inversiones Theta SRL"],
  ["2026-08-31", 2500.0, "REF-1009", "Comercializadora Iota EIRL"],
  ["2026-08-31", 1150.5, "REF-1010", "Textiles Kappa SAC"],
].map(([fecha, monto, referencia, contraparte], i) => ({
  id_interno: `REG-${String(i + 1).padStart(4, "0")}`,
  fecha: fecha as string,
  monto: monto as number,
  tipo: "cobranza" as const,
  referencia: referencia as string,
  contraparte: contraparte as string,
}));

const payload = (mapeo: Parameters<typeof normalizarBancarios>[1]) => ({
  job_id: "rec-2026-08-test",
  metadata: {},
  config: {},
  registros_internos: INTERNOS,
  movimientos_bancarios: normalizarBancarios(EXTRACTO, mapeo).filas,
});

describe("el caso real: 0 pares con dos archivos que casaban", () => {
  const { mapeo, alternativas } = detectarColumnasConDudas(HEADERS, EXTRACTO);

  it("elige la columna con la que el banco y el cliente se entienden", () => {
    expect(mapeo.referencia).toBe("Nro Referencia");
    expect(mapeo.descripcion).toBe("Concepto / Cliente");
  });

  it("y nombra la que descartó, porque elegir mal aquí no da un error", () => {
    expect(alternativas.referencia).toContain("Nro Operacion");
  });

  it("con la columna correcta, la capa exacta empareja los siete", () => {
    const r = correrExacta(payload(mapeo));
    expect(r.matches).toHaveLength(7);
    for (const m of r.matches) {
      expect(m.metodo).toBe("exacta");
      expect(m.diferencia_monto).toBe(0);
    }
  });

  /**
   * ⚠️ La reproducción del fallo. No es una curiosidad: es lo que impide que
   * alguien "simplifique" el desempate y vuelva a dejar ganar a la columna
   * equivocada sin que ningún test se entere.
   */
  it("con la columna equivocada no casa NI UNO, y así se veía en pantalla", () => {
    const malo = { ...mapeo, referencia: "Nro Operacion" };
    const r = correrExacta(payload(malo));
    expect(r.matches).toHaveLength(0);
    expect(r.pendientes_internos).toHaveLength(10);
    expect(r.pendientes_bancarios).toHaveLength(15);
  });

  /**
   * El respaldo por monto + fecha SÍ tenía pares disponibles (27/08 · 1.500,00
   * está en los dos lados) y aun así no emparejó: las dos referencias existían
   * y se contradecían. La guarda es correcta —evitó los 541 pares falsos de una
   * recaudadora— y por eso el fallo era invisible: el motor hacía lo correcto
   * con un dato equivocado.
   */
  it("la guarda de contradicción es la que lo bloquea, no una carencia de datos", () => {
    const sinRefBanco = { ...mapeo, referencia: undefined };
    const r = correrExacta(payload(sinRefBanco));
    expect(r.matches.length).toBeGreaterThan(0);
  });

  /**
   * La glosa se construye SOLO desde `mapeo.descripcion`. Sin ella los
   * movimientos llegan sin nombre y la capa difusa —que exige una palabra en
   * común con la contraparte— no puede emparejar nada. En pantalla eran filas
   * «BCO-0001» sin más, que no parece un error de mapeo.
   */
  it("los movimientos llegan al motor con su glosa", () => {
    const { filas } = normalizarBancarios(EXTRACTO, mapeo);
    expect(filas[0]!.glosa).toBe("Pago Empresa Alfa SAC");
    expect(filas.every((m) => (m.glosa ?? "") !== "")).toBe(true);
  });
});
