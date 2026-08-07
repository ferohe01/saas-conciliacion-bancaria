import { describe, it, expect } from "vitest";
import { detectarSaldoFinal } from "@/lib/parsing/saldo";
import { construirWorkbookResultado } from "@/lib/exportar";
import type { ResultadoConciliacion } from "@/lib/contract/resultado";

describe("detectarSaldoFinal", () => {
  it("toma el último valor de la columna de saldo", () => {
    const headers = ["Fecha", "Monto", "Saldo"];
    const filas = [
      { Fecha: "01/06/2026", Monto: "100", Saldo: "1,000.00" },
      { Fecha: "02/06/2026", Monto: "200", Saldo: "1,200.00" },
      { Fecha: "03/06/2026", Monto: "-50", Saldo: "1,150.00" },
    ];
    expect(detectarSaldoFinal(headers, filas)).toBeCloseTo(1150);
  });

  it("ignora columnas de saldo inicial", () => {
    const headers = ["Fecha", "Saldo inicial"];
    const filas = [{ Fecha: "01/06/2026", "Saldo inicial": "500" }];
    expect(detectarSaldoFinal(headers, filas)).toBeNull();
  });

  it("devuelve null si no hay columna de saldo", () => {
    expect(detectarSaldoFinal(["Fecha", "Monto"], [{ Fecha: "x", Monto: "1" }])).toBeNull();
  });
});

describe("construirWorkbookResultado", () => {
  const resultado: ResultadoConciliacion = {
    resumen: {
      total_internos: 2,
      total_bancarios: 2,
      conciliados_exactos: 1,
      conciliados_difusos: 0,
      sugeridos_ia: 0,
      sin_conciliar_internos: 1,
      sin_conciliar_bancarios: 1,
    },
    matches: [
      {
        ids_internos: ["REG-0001"],
        ids_movimientos: ["BCO-0001"],
        metodo: "exacta",
        confianza: null,
        diferencia_monto: 0,
        categoria_diferencia: null,
        justificacion: null,
        estado_revision: "auto",
      },
    ],
    no_conciliados: [
      { id: "REG-0002", lado: "interno", categoria: "requiere_investigacion", sugerencia: null },
    ],
    cuadre: {
      saldo_extracto_final: 100,
      depositos_en_transito: 0,
      cheques_no_cobrados: 0,
      abonos_no_registrados: 0,
      cargos_no_registrados: 0,
      saldo_banco_ajustado: 100,
      saldo_libros_final: 100,
      diferencia: 0,
    },
  };

  it("genera un workbook con las 3 hojas esperadas", async () => {
    const wb = await construirWorkbookResultado(resultado);
    expect(wb.SheetNames).toEqual(["Cuadre", "Matches", "Sin conciliar"]);
  });
});
