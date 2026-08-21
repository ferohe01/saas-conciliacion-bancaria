import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { restarMeses } from "@/lib/periodo";
import {
  desgloseDeRegistros,
  exclusionesDelPeriodo,
} from "@/lib/exclusionesPeriodo";
import { cascadaPartidas, type OrigenPartidas } from "@/lib/origenPartidas";
import {
  ConfigConciliacion,
  CONFIG_CONCILIACION_DEFAULT,
} from "@/lib/contract/config";

/**
 * El arrastre de pendientes (migración 0054).
 *
 * ── Qué se arregla ─────────────────────────────────────────────────────────
 *
 * Los comprobantes entraban a una conciliación por FECHA DE EMISIÓN dentro del
 * período. Una factura del 25/06 con crédito a 30 días se cobra el 28/07: en
 * junio el abono todavía no existe y en julio la factura ya no entra, así que
 * **el par no se concilia en ningún período**. El comprobante conserva saldo
 * para siempre y el cuadre arrastra la diferencia, que crece cada mes.
 *
 * ── Qué puede y qué no puede comprobar este archivo ────────────────────────
 *
 * El emparejamiento vive en SQL (`pares_exactos`) y no se ejecuta aquí; eso se
 * verifica end-to-end con el juego de `ops/generar-pruebas-arrastre.mjs`, donde
 * julio pasa de 66 movimientos sueltos a 4. Lo que sí se puede fijar en el repo
 * son las dos cosas que ya se han roto antes por su cuenta:
 *
 *   1. que la ventana de TypeScript y la de Postgres den la misma fecha, y
 *   2. que **los siete sitios** donde vive el filtro sigan diciendo lo mismo.
 *
 * Lo segundo es el riesgo real: si solo cambiara el del motor, la pantalla
 * dejaría de contar lo que se concilia — que es justo lo que el Paso 1 promete.
 */

// ───────────────────────────────────────────────────────────────────────────
// La ventana
// ───────────────────────────────────────────────────────────────────────────

describe("restarMeses · la misma fecha que `date - interval 'N months'`", () => {
  it("resta meses corrientes", () => {
    expect(restarMeses("2026-07-01", 12)).toBe("2025-07-01");
    expect(restarMeses("2026-07-15", 1)).toBe("2026-06-15");
  });

  it("cruza el año hacia atrás", () => {
    expect(restarMeses("2026-01-31", 1)).toBe("2025-12-31");
    expect(restarMeses("2026-02-10", 14)).toBe("2024-12-10");
  });

  it("⚠️ topa el día que no existe, como Postgres (31/03 − 1 mes = 28/02)", () => {
    // `Date.UTC(2026, 1, 31)` desbordaría al 03/03 y la ventana se abriría tres
    // días MENOS de lo que abre el motor. Tres días de diferencia bastan para
    // que una factura entre en SQL y no en la pantalla, o al revés.
    expect(restarMeses("2026-03-31", 1)).toBe("2026-02-28");
    expect(restarMeses("2024-03-31", 1)).toBe("2024-02-29"); // bisiesto
    expect(restarMeses("2026-05-31", 3)).toBe("2026-02-28");
  });

  it("⚠️ con 0 meses NO se mueve: es el comportamiento anterior al arrastre", () => {
    // Cero desactiva el arrastre, y esa es la salida de emergencia del cambio:
    // se revierte desde /configuracion, sin desplegar nada.
    expect(restarMeses("2026-07-01", 0)).toBe("2026-07-01");
    expect(restarMeses("2026-07-01", -3)).toBe("2026-07-01");
    expect(restarMeses("2026-07-01", Number.NaN)).toBe("2026-07-01");
  });
});

describe("arrastre_meses en el contrato", () => {
  it("por defecto son 12 meses", () => {
    expect(CONFIG_CONCILIACION_DEFAULT.arrastre_meses).toBe(12);
  });

  it("admite 0 (desactivado) y rechaza lo que no es un número de meses", () => {
    const base = CONFIG_CONCILIACION_DEFAULT;
    expect(ConfigConciliacion.safeParse({ ...base, arrastre_meses: 0 }).success)
      .toBe(true);
    expect(ConfigConciliacion.safeParse({ ...base, arrastre_meses: -1 }).success)
      .toBe(false);
    expect(ConfigConciliacion.safeParse({ ...base, arrastre_meses: 1.5 }).success)
      .toBe(false);
    // El tope existe para que la ventana de falsos positivos no sea infinita.
    expect(ConfigConciliacion.safeParse({ ...base, arrastre_meses: 999 }).success)
      .toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Lo que ve el usuario
// ───────────────────────────────────────────────────────────────────────────

describe("Paso 1 · el arrastre se dice, no se cuela", () => {
  const julio = {
    registros: 281,
    totalCargados: 305,
    yaCobrados: 20,
    otrasMonedas: 0,
    fueraPeriodo: 4,
    anulados: 0,
    arrastrados: 48,
  };

  it("desglosa los que entran: cuántos son de este período y cuántos vienen de antes", () => {
    // ⚠️ El archivo de julio trae 233 facturas y la tarjeta pone 281. Sin esta
    // línea lo primero que piensa el usuario es que el sistema duplicó algo, y
    // la reacción natural —recargar, o «empezar de cero»— es la peor posible.
    expect(desgloseDeRegistros(julio)).toBe(
      "233 emitidos en este período · 48 pendientes de meses anteriores",
    );
  });

  it("no dice nada cuando no se arrastró nada", () => {
    // Una empresa que cobra al contado, o la primera conciliación de
    // cualquiera. «233 de este período · 0 arrastrados» es ruido.
    expect(desgloseDeRegistros({ ...julio, arrastrados: 0 })).toBeNull();
    expect(desgloseDeRegistros({ ...julio, arrastrados: undefined })).toBeNull();
  });

  it("singular cuando es uno solo", () => {
    expect(desgloseDeRegistros({ ...julio, registros: 234, arrastrados: 1 }))
      .toBe("233 emitidos en este período · 1 pendiente de meses anteriores");
  });

  it("⚠️ los arrastrados NO son una exclusión: la cuenta sigue cerrando", () => {
    // Están DENTRO de `registros`. Si contaran como exclusión, la cuenta
    // saldría con 48 de más y aparecería una línea «sin explicar» que no
    // existe — el fallo que la 0053 vino a corregir, reintroducido.
    const e = exclusionesDelPeriodo(julio, "PEN");
    const explicados = e.reduce((s, x) => s + x.cantidad, 0);
    expect(explicados).toBe(julio.totalCargados - julio.registros);
    expect(e.some((x) => x.clave === "sin_explicar")).toBe(false);
  });
});

describe("cascada de partidas · el arrastre se nombra en el total", () => {
  const base: OrigenPartidas = {
    alcance: "cargas",
    cargas: 2,
    archivoFilas: 305,
    archivoRepetidas: 0,
    archivoInvalidas: 0,
    archivoExistentes: 0,
    archivoInsertados: 305,
    cargados: 305,
    fueraPeriodo: 4,
    yaCobrados: 20,
    otraMoneda: 0,
    internos: 281,
    arrastrados: 48,
  };

  const bloqueSeleccion = (o: OrigenPartidas) =>
    cascadaPartidas(o, { internos: 281, conciliados: 269 }).find(
      (b) => b.clave === "seleccion",
    )!;

  it("la cuenta cierra sin línea «sin explicar»", () => {
    const b = bloqueSeleccion(base);
    const restas = b.lineas
      .filter((l) => l.tipo === "resta")
      .reduce((s, l) => s + l.cantidad, 0);
    expect(base.cargados - restas).toBe(base.internos);
    expect(b.lineas.some((l) => l.sinExplicar)).toBe(false);
  });

  it("dice cuántos vienen de meses anteriores y por qué entran", () => {
    const total = bloqueSeleccion(base).lineas.find((l) => l.tipo === "total")!;
    expect(total.cantidad).toBe(281);
    expect(total.explicacion).toContain("48");
    expect(total.explicacion).toContain("meses anteriores");
  });

  it("sin arrastre, la explicación es la de siempre", () => {
    const total = bloqueSeleccion({ ...base, arrastrados: 0 }).lineas.find(
      (l) => l.tipo === "total",
    )!;
    expect(total.explicacion).toBe("Lo que el motor recibió de tu lado.");
  });

  it("⚠️ «fuera del período» solo menciona el arrastre cuando lo hubo", () => {
    // Si no se arrastró nada, decir «y también fuera de los meses que se
    // arrastran» describiría una ventana que no se aplicó.
    const con = bloqueSeleccion(base).lineas.find((l) => l.clave === "fuera")!;
    const sin = bloqueSeleccion({ ...base, arrastrados: 0 }).lineas.find(
      (l) => l.clave === "fuera",
    )!;
    expect(con.explicacion).toContain("arrastran");
    expect(sin.explicacion).not.toContain("arrastran");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// La guarda: los siete sitios siguen diciendo lo mismo
// ───────────────────────────────────────────────────────────────────────────

/**
 * Las funciones que eligen QUÉ COMPROBANTES entran, y que por tanto tienen que
 * abrir la misma ventana. Con una sola que se quede atrás, la pantalla contaría
 * un conjunto y el motor conciliaría otro — y desde fuera no habría cómo
 * saberlo, que es exactamente cómo se llegó a este agujero.
 *
 * `pares_exactos` no está en la lista a propósito: recibe la ventana ya
 * calculada por quien la llama, para seguir siendo la sentencia ÚNICA que
 * comparten el motor y la estimación del Paso 3 (0037).
 */
const CON_VENTANA = [
  "conciliar_exacta",
  "residuo_internos",
  "resumen_comprobantes_periodo",
  "origen_partidas",
  "diagnostico_previo",
  "residuo_explicado",
  "residuo_series",
];

const DIR = join(process.cwd(), "supabase", "migrations");
const ARCHIVOS = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** El cuerpo de la ÚLTIMA definición de una función: la que rige. */
function ultimaDefinicion(nombre: string): { archivo: string; cuerpo: string } | null {
  let encontrada: { archivo: string; cuerpo: string } | null = null;
  for (const archivo of ARCHIVOS) {
    const sql = readFileSync(join(DIR, archivo), "utf8");
    const re = new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${nombre}\\s*\\(([\\s\\S]*?)\\n\\$\\$;`,
      "gi",
    );
    for (const m of sql.matchAll(re)) encontrada = { archivo, cuerpo: m[0]! };
  }
  return encontrada;
}

describe("⚠️ el filtro de período está en siete sitios y tienen que decir lo mismo", () => {
  for (const nombre of CON_VENTANA) {
    it(`${nombre} abre la ventana con arrastre_desde`, () => {
      const def = ultimaDefinicion(nombre);
      expect(def, `no se encontró ninguna definición de ${nombre}`).not.toBeNull();
      expect(
        def!.cuerpo,
        `La última definición de ${nombre} (${def!.archivo}) no llama a ` +
          "public.arrastre_desde(). Si se cambia la ventana en un sitio y no en " +
          "los otros, la pantalla cuenta un conjunto y el motor concilia otro.",
      ).toContain("public.arrastre_desde(");
    });
  }

  it("`arrastre_desde` existe y tiene una sola definición vigente", () => {
    const def = ultimaDefinicion("arrastre_desde");
    expect(def).not.toBeNull();
    // Cero devuelve la fecha tal cual: la salida de emergencia sin desplegar.
    expect(def!.cuerpo).toContain("return p_desde;");
  });

  it("⚠️ el límite SUPERIOR de `pares_exactos` sigue siendo p_hasta", () => {
    // Solo baja el inferior. Un comprobante posterior al período no puede
    // haberse cobrado antes de existir, así que ensanchar por arriba no
    // encontraría pares: inventaría emparejamientos imposibles.
    const def = ultimaDefinicion("pares_exactos");
    expect(def).not.toBeNull();
    expect(def!.cuerpo).toContain("c.fecha between p_desde and p_hasta");
  });
});
