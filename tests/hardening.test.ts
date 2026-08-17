import { describe, it, expect } from "vitest";
import { detectarSaldoFinal, columnaSaldo } from "@/lib/parsing/saldo";
import { CAMPOS } from "@/lib/parsing/deteccion";
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

describe("columnaSaldo · el saldo NO viene del mapeo", () => {
  /**
   * ⚠️⚠️ La regla que este bloque protege, y que se aprendió en producción:
   *
   * El saldo **no es uno de los campos que el Paso 2 pregunta**, así que
   * `mapeo.saldo` no llega nunca relleno. La ingesta en servidor lo daba por
   * hecho —`if (mapeo.saldo)`— y por eso `movimientos_extracto.saldo` y
   * `extractos_cargados.saldo_declarado` salían siempre nulos: el camino
   * principal del saldo vivo («lo declara el banco») era código inalcanzable, y
   * la caja rotulaba «calculado» sobre extractos del BCP que traían su columna
   * `Saldo` perfectamente.
   *
   * Si algún día el saldo entra en `CAMPOS`, este test falla y hay que decidir
   * a conciencia si la detección sigue haciendo falta.
   */
  it("`saldo` no está entre los campos del mapeo, así que hay que detectarlo", () => {
    expect(CAMPOS).not.toContain("saldo");
  });

  it("encuentra la columna de un extracto real del BCP", () => {
    expect(
      columnaSaldo(["Fecha", "Descripción", "Monto", "Saldo", "Operación", "Sucursal"]),
    ).toBe("Saldo");
  });

  it("no confunde el saldo inicial con el corriente", () => {
    expect(columnaSaldo(["Fecha", "Saldo inicial", "Monto"])).toBeNull();
  });

  it("sin columna de saldo devuelve null, y entonces el saldo se calcula", () => {
    expect(columnaSaldo(["Fecha", "Monto", "Glosa"])).toBeNull();
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
      diferencias_emparejadas: 0,
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
