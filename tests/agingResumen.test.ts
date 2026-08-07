import { describe, it, expect } from "vitest";
import { agingDesdeResumen, type FilaResumenSaldo } from "@/lib/agingResumen";
import {
  calcularAging,
  cuentaComoPendiente,
  diasVencido,
  tramoDe,
  type ComprobanteCobrar,
  type TipoSaldo,
} from "@/lib/aging";

/**
 * La suma se mudó a Postgres (`resumen_saldos`, migración 0021) porque traer
 * las 452.309 filas pendientes para sumarlas en Node costaba varios minutos.
 *
 * Lo que se prueba aquí es la **equivalencia**: pivotar lo que devuelve la base
 * tiene que dar el MISMO `ResumenAging` que salía de `calcularAging`. Si las
 * dos rutas divergen, la pantalla enseñará totales que no corresponden a sus
 * propias filas y nadie sabrá cuál creer.
 *
 * ⚠️ Esto valida el pivote, NO el SQL — eso solo puede comprobarse contra una
 * base real. Lo que hace es fijar la forma de salida para que el día que el SQL
 * cambie, el contrato con la pantalla siga escrito en alguna parte.
 */

const HOY = new Date("2026-08-07T00:00:00Z");

/** Reproduce en JS lo que hace `resumen_saldos`: agrupar por contraparte+tramo. */
function simularSql(
  comprobantes: ComprobanteCobrar[],
  tipo: TipoSaldo,
): FilaResumenSaldo[] {
  const cubos = new Map<string, FilaResumenSaldo>();
  for (const c of comprobantes) {
    if (!cuentaComoPendiente(c, tipo)) continue;
    const contraparte =
      (c.razon_social_contraparte ?? "").trim() || "Sin identificar";
    const tramo = tramoDe(diasVencido(c, HOY));
    const clave = `${contraparte}|${tramo}`;
    const previo = cubos.get(clave);
    if (previo) {
      previo.total = Number(previo.total) + Number(c.saldo ?? 0);
      previo.documentos = Number(previo.documentos) + 1;
    } else {
      cubos.set(clave, {
        contraparte,
        ruc: c.ruc_contraparte ?? null,
        tramo,
        // Postgres devuelve `numeric` como CADENA para no perder precisión, y
        // el pivote tiene que aguantarlo. Por eso viaja como string aquí.
        total: String(c.saldo ?? 0),
        documentos: String(1),
      });
    }
  }
  return [...cubos.values()];
}

const comprobante = (
  p: Partial<ComprobanteCobrar> & { id: string },
): ComprobanteCobrar => ({
  fecha: "2026-06-01",
  fecha_vencimiento: null,
  monto: 100,
  saldo: 100,
  tipo: "cobranza",
  estado: "pendiente",
  serie_numero: "F001-1",
  ruc_contraparte: null,
  razon_social_contraparte: "Comercial Ñuñez",
  ...p,
});

describe("agingDesdeResumen", () => {
  it("da el MISMO resumen que calcularAging", () => {
    const datos: ComprobanteCobrar[] = [
      comprobante({ id: "1", saldo: 100, fecha_vencimiento: "2026-08-30" }), // por vencer
      comprobante({ id: "2", saldo: 250.55, fecha_vencimiento: "2026-07-20" }), // 1-30
      comprobante({ id: "3", saldo: 80, fecha_vencimiento: "2026-06-20" }), // 31-60
      comprobante({ id: "4", saldo: 40, fecha_vencimiento: "2026-05-01" }), // +90
      comprobante({ id: "5", saldo: 33.33, razon_social_contraparte: "Otro SAC" }),
      comprobante({ id: "6", saldo: 10, razon_social_contraparte: "  " }), // sin nombre
      // Los que no cuentan: el SQL ni los devuelve, y calcularAging los salta.
      comprobante({ id: "7", tipo: "pago", saldo: 999 }),
      comprobante({ id: "8", estado: "cobrado", saldo: 999 }),
      comprobante({ id: "9", saldo: 0 }),
    ];

    expect(agingDesdeResumen(simularSql(datos, "cobranza"))).toEqual(
      calcularAging(datos, HOY, "cobranza"),
    );
  });

  it("también en el lado de los pagos", () => {
    const datos = [
      comprobante({ id: "1", tipo: "pago", saldo: 500, razon_social_contraparte: "Proveedor A" }),
      comprobante({ id: "2", tipo: "pago", saldo: 120, fecha_vencimiento: "2026-05-01" }),
      comprobante({ id: "3", tipo: "cobranza", saldo: 999 }),
    ];
    expect(agingDesdeResumen(simularSql(datos, "pago"))).toEqual(
      calcularAging(datos, HOY, "pago"),
    );
  });

  it("sin deuda, un resumen vacío (no nulo)", () => {
    // La pantalla distingue "no te deben nada" de "el filtro no encuentra
    // nada"; para eso necesita un resumen con documentos = 0, no una excepción.
    const r = agingDesdeResumen([]);
    expect(r.documentos).toBe(0);
    expect(r.total).toBe(0);
    expect(r.contrapartes).toEqual([]);
  });

  it("acepta los numeric de Postgres como cadena", () => {
    // `numeric` llega como string por el driver. Sumarlo como texto daría
    // "100200" en vez de 300, y el error pasaría por un total plausible.
    const r = agingDesdeResumen([
      { contraparte: "A", ruc: null, tramo: "d1_30", total: "100.50", documentos: "2" },
      { contraparte: "A", ruc: null, tramo: "d31_60", total: "200.25", documentos: "3" },
    ]);
    expect(r.total).toBe(300.75);
    expect(r.documentos).toBe(5);
  });

  it("un tramo desconocido se descarta en vez de romper la pantalla", () => {
    const r = agingDesdeResumen([
      { contraparte: "A", ruc: null, tramo: "d1_30", total: "10", documentos: "1" },
      { contraparte: "A", ruc: null, tramo: "inventado", total: "999", documentos: "9" },
    ]);
    expect(r.total).toBe(10);
    expect(r.documentos).toBe(1);
  });

  it("recupera el RUC aunque venga nulo en el primer tramo", () => {
    const r = agingDesdeResumen([
      { contraparte: "A", ruc: null, tramo: "d1_30", total: "10", documentos: "1" },
      { contraparte: "A", ruc: "20501234567", tramo: "d31_60", total: "20", documentos: "1" },
    ]);
    expect(r.contrapartes[0]!.ruc).toBe("20501234567");
  });

  it("ordena por lo más vencido, que es por donde se gestiona", () => {
    const r = agingDesdeResumen([
      { contraparte: "Poco", ruc: null, tramo: "d1_30", total: "50", documentos: "1" },
      { contraparte: "Mucho", ruc: null, tramo: "d90_mas", total: "500", documentos: "1" },
      { contraparte: "Nada", ruc: null, tramo: "por_vencer", total: "9999", documentos: "1" },
    ]);
    expect(r.contrapartes.map((c) => c.contraparte)).toEqual(["Mucho", "Poco", "Nada"]);
  });
});
