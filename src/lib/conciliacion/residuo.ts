import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";

/**
 * El residuo: lo que la capa exacta en SQL NO pudo casar y por tanto es lo
 * único que n8n tiene que mirar (parte B, etapas 2 y 3).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Emparejar por monto + referencia es un JOIN, y Postgres lo resuelve sobre
 * medio millón de filas en medio minuto. Medido con junio completo de una
 * recaudadora: 447.795 pares de 452.177 internos y 450.999 movimientos, o sea
 * el 99,03 %. Lo que queda —4.382 + 3.204— cabe de sobra en el payload que ya
 * existía.
 *
 * Sin esto, esas 903.176 partidas eran ~175 MB de JSON contra un webhook de 64.
 *
 * ── Los ids sintéticos ─────────────────────────────────────────────────────
 *
 * El motor referencia las partidas por `id_interno` / `id_movimiento`, que son
 * posicionales ("REG-0007"). Se generan aquí a partir del orden que devuelve la
 * base, y el uuid real viaja aparte (`comprobante_id`, `movimiento_id`) para
 * poder volver del match a la fila. Sin ese puente, el resultado de n8n no se
 * podría atar a nada.
 */

export type Residuo = {
  registros_internos: RegistroInterno[];
  movimientos_bancarios: MovimientoBancario[];
  /** Pares que resolvió la capa exacta en SQL, ya en `matches_conciliacion`. */
  paresExactos: number;
  /** Totales del período, para poder informar de cuánto se cubrió. */
  totalInternos: number;
  totalMovimientos: number;
};

type FilaInterno = {
  comprobante_id: string;
  fecha: string;
  monto: number | string;
  tipo: string;
  referencia: string | null;
  contraparte: string | null;
  descripcion: string | null;
};

type FilaMovimiento = {
  movimiento_id: string;
  fecha: string;
  monto: number | string;
  tipo: string;
  glosa: string | null;
  referencia_banco: string | null;
};

/**
 * Corre la capa exacta y devuelve lo que sobró, ya en la forma del contrato.
 *
 * `admin` porque las tres funciones están concedidas solo a `service_role`: las
 * invoca el backend, nunca el navegador.
 */
export async function construirResiduo(
  admin: SupabaseClient,
  jobId: string,
  maxFilas: number,
): Promise<Residuo> {
  const pares = await correrCapaExacta(admin, jobId);

  const tot = await admin.rpc("totales_conciliacion", { p_job_id: jobId });
  if (tot.error) {
    throw new Error(`No se pudieron contar las partidas: ${tot.error.message}`);
  }
  const resumen = (tot.data as { internos: number; movimientos: number }[])?.[0];

  // ⚠️ FRENO. El residuo se calcula ANTES de pedirlo: son los totales menos lo
  // que casó, y eso ya lo devuelve `conciliar_exacta` sin coste añadido.
  //
  // Si la capa exacta no casa casi nada —pasa cuando el extracto llega sin
  // columna de referencia— el "residuo" son TODAS las partidas. Sin este freno,
  // el paginado intentaría traer 903.176 filas en 903 peticiones y el usuario
  // vería el botón en "Iniciando" durante minutos antes de que n8n rechazara un
  // payload de 175 MB. Fallar aquí, rápido y explicando por qué, es mejor.
  const faltanInt = Number(resumen?.internos ?? 0) - pares;
  const faltanMov = Number(resumen?.movimientos ?? 0) - pares;
  if (faltanInt > maxFilas || faltanMov > maxFilas) {
    throw new Error(
      `La conciliación automática solo pudo emparejar ${pares.toLocaleString("es-PE")} de ${Number(resumen?.internos ?? 0).toLocaleString("es-PE")} partidas, así que quedan ${Math.max(faltanInt, faltanMov).toLocaleString("es-PE")} para revisar y no caben en una sola corrida (el máximo es ${maxFilas.toLocaleString("es-PE")}). ` +
        `La causa más habitual es que el extracto se cargó sin la columna de referencia o nº de operación: sin ella no se puede emparejar por código de pago. Vuelve al Paso 2 y comprueba ese mapeo.`,
    );
  }

  const [internos, movimientos] = await Promise.all([
    traerRpc<FilaInterno>(admin, "residuo_internos", jobId),
    traerRpc<FilaMovimiento>(admin, "residuo_movimientos", jobId),
  ]);

  return {
    registros_internos: internos.map((c, i) => ({
      id_interno: `REG-${String(i + 1).padStart(4, "0")}`,
      fecha: String(c.fecha),
      // Postgres devuelve `numeric` como cadena para no perder precisión.
      monto: Number(c.monto),
      tipo: c.tipo === "pago" ? ("pago" as const) : ("cobranza" as const),
      referencia: c.referencia,
      contraparte: c.contraparte,
      descripcion: c.descripcion,
      comprobante_id: c.comprobante_id,
    })),
    movimientos_bancarios: movimientos.map((m, i) => ({
      id_movimiento: `BCO-${String(i + 1).padStart(4, "0")}`,
      fecha: String(m.fecha),
      monto: Number(m.monto),
      tipo: m.tipo === "cargo" ? ("cargo" as const) : ("abono" as const),
      glosa: m.glosa,
      referencia_banco: m.referencia_banco,
      movimiento_id: m.movimiento_id,
    })),
    paresExactos: pares,
    totalInternos: Number(resumen?.internos ?? 0),
    totalMovimientos: Number(resumen?.movimientos ?? 0),
  };
}


/**
 * Trae TODAS las filas de una función, paginando.
 *
 * ⚠️ **PostgREST recorta el resultado de un RPC igual que el de una tabla.** Su
 * `db-max-rows` es 1.000 y no distingue: una función que devuelve 4.382 filas
 * entrega 1.000 y un 200 OK, sin aviso.
 *
 * Costó una conciliación entera. El residuo de junio son 4.382 internos y 3.204
 * movimientos; a n8n le llegaron 1.000 y 1.000, y el resultado dijo
 * "2000 partidas, 0 pares". Los dos mil redondos eran la única pista.
 *
 * Es la MISMA lección que `lib/supabase/paginado.ts` documenta para los
 * `select`, y no se me ocurrió que aplicara a las funciones. Aplica.
 */
async function traerRpc<T>(
  admin: SupabaseClient,
  fn: string,
  jobId: string,
): Promise<T[]> {
  const PAGINA = 1000;
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await admin
      .rpc(fn, { p_job_id: jobId })
      .range(desde, desde + PAGINA - 1);
    if (error) {
      throw new Error(`No se pudo leer el residuo (${fn}): ${error.message}`);
    }
    const lote = (data ?? []) as T[];
    filas.push(...lote);
    // Una página incompleta es el final. Las funciones devuelven siempre el
    // mismo orden (lo fijan con `order by`), así que el rango es estable.
    if (lote.length < PAGINA) return filas;
  }
}


/**
 * Corre la capa exacta, troceando si la base la cancela.
 *
 * ⚠️ El rol con el que se conecta PostgREST lleva `statement_timeout = 8s`, y
 * **no se puede ampliar desde dentro**: un `set local statement_timeout` en el
 * cuerpo de la función no rearma el temporizador de la sentencia ya en marcha
 * (probado: se cancela igual, a los 8,3 s).
 *
 * Con la referencia ya normalizada en la fila (migración 0029) una sola pasada
 * basta de sobra. Los bloques quedan como red: si un cliente aún mayor vuelve
 * a rozar el techo, se reparte solo en vez de fallar.
 *
 * ⚠️ El troceo es por **hash de la referencia**, nunca por fecha. Un par
 * siempre comparte referencia, así que ningún emparejamiento queda partido;
 * trocear por días sí los parte —un asiento del 30 puede cobrarse el 28— y esa
 * es la diferencia entre el 88 % de un día y el 99 % del mes.
 */
async function correrCapaExacta(
  admin: SupabaseClient,
  jobId: string,
): Promise<number> {
  const TIMEOUT_PG = "57014";
  // Medido con junio completo (452.177 × 450.999) y la referencia ya
  // normalizada en la fila (0029):
  //
  //     1 bloque  → CANCELADO a los 8,1 s
  //     4 bloques → 447.795 pares, pero el peor tarda 7,6 s. Cabe por poco, y
  //                 "por poco" con un cliente que crece es no caber.
  //     8 bloques → margen holgado, y para una PyME son ocho viajes de 50 ms.
  //
  // El coste que se reparte es el ORDEN: los dos `row_number()` sobre 450.000
  // filas cada uno. Normalizar la referencia dejó de pesar al guardarla ya
  // normalizada, pero ordenar no se puede evitar — solo trocear.
  for (const bloques of [8, 32]) {
    let total = 0;
    let cancelado = false;
    for (let b = 0; b < bloques; b++) {
      const { data, error } = await admin.rpc("conciliar_exacta", {
        p_job_id: jobId,
        p_bloque: b,
        p_bloques: bloques,
      });
      if (error) {
        if (error.code === TIMEOUT_PG) {
          cancelado = true;
          break;
        }
        throw new Error(`No se pudo correr la capa exacta: ${error.message}`);
      }
      total += Number(data ?? 0);
    }
    if (!cancelado) return total;

    // Los bloques que sí entraron dejaron pares escritos: se retiran antes de
    // reintentar con más trozos, o el segundo intento los duplicaría.
    const { error } = await admin
      .from("matches_conciliacion")
      .delete()
      .eq("job_id", jobId)
      .eq("metodo", "exacta");
    if (error) {
      throw new Error(`No se pudo reintentar la capa exacta: ${error.message}`);
    }
  }
  throw new Error(
    "La capa exacta no pudo completarse ni troceada en 32 partes. El período es demasiado grande para procesarlo de una vez: prueba con un rango más corto.",
  );
}
