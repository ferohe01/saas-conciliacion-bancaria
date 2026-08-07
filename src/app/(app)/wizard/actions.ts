"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { traerTodo, enLotes } from "@/lib/supabase/paginado";
import { getEmpresaActual } from "@/lib/auth";
import {
  claveComprobante,
  dedupEnArchivo,
  separarExistentes,
  mensajeImportacion,
  CONFIRMACION_VACIAR,
} from "@/lib/importacion";
import { FechaISO } from "@/lib/contract/primitives";
import type { MapeoColumnas } from "@/lib/parsing/deteccion";
import type { RegistroInterno } from "@/lib/contract/payload";

/**
 * Importación de comprobantes desde la plantilla Excel (§6.4). El cliente ya
 * parseó y normalizó las filas; aquí se validan e insertan en `comprobantes`
 * con origen 'plantilla'. RLS garantiza el aislamiento por empresa.
 */

const ComprobanteImport = z.object({
  fecha: FechaISO,
  fecha_vencimiento: FechaISO.optional().nullable(),
  monto: z.number().finite(),
  tipo: z.enum(["cobranza", "pago"]),
  referencia: z.string().trim().optional().nullable(),
  /**
   * Con qué casarlo en el extracto, cuando no es el propio número de documento
   * (código de operación, número de depósito). Se repite a propósito: varios
   * comprobantes pagados juntos comparten referencia. Ver `0020`.
   */
  referencia_externa: z.string().trim().optional().nullable(),
  ruc_contraparte: z.string().trim().optional().nullable(),
  razon_social: z.string().trim().optional().nullable(),
  descripcion: z.string().trim().optional().nullable(),
});

const ImportPayload = z.array(ComprobanteImport).min(1).max(5000);

export type ImportResultado = {
  ok: boolean;
  error?: string;
  insertados?: number;
  /** Ya estaban en la base (misma serie y tipo). */
  yaExistian?: number;
  /** Venían dos veces dentro del propio archivo. */
  repetidasEnArchivo?: number;
  /** Lote de esta carga, para poder deshacerla. */
  lote?: string;
  mensaje?: string;
};

/**
 * Importa la plantilla SIN duplicar lo que ya está cargado.
 *
 * Tres filtros, en este orden: filas repetidas dentro del archivo → filas cuya
 * serie ya existe en la base → índice único de `0018` como red final. Los dos
 * primeros existen para poder decir "20 ya estaban" en vez de soltar un error
 * de Postgres; el tercero es el que de verdad impide el duplicado, y sigue ahí
 * aunque alguien escriba por otra vía.
 *
 * Lo que ya existe NO se actualiza. Un comprobante puede tener cobros aplicados
 * y su `saldo` se calcula desde `monto`: reescribirle el monto desde una
 * plantilla dejaría el saldo mintiendo, sin que nadie lo pidiera.
 */
export async function importarComprobantes(
  filas: unknown,
  invalidas = 0,
): Promise<ImportResultado> {
  const parsed = ImportPayload.safeParse(filas);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Hay filas con datos inválidos en la plantilla.",
    };
  }

  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };

  const supabase = await createClient();

  // 1) Repetidas dentro del propio archivo.
  const { filas: unicas, repetidas } = dedupEnArchivo(parsed.data);

  // 2) Las que ya están en la base. Se piden solo las series del archivo, no
  //    la tabla entera: con miles de comprobantes cargados, traerlos todos para
  //    comparar sería un derroche que crece con el tiempo.
  const seriesArchivo = [
    ...new Set(
      unicas
        .map((f) => (f.referencia ?? "").trim())
        .filter((s) => s !== ""),
    ),
  ];

  // ⚠️ TROCEADO. Con 5.000 series de ~13 caracteres, un solo `.in()` genera una
  // URL de ~80.000 caracteres: el proxy la rechaza y `fetch` revienta con una
  // excepción de servidor, no con un error manejable. 300 por lote deja la URL
  // en ~5.000 caracteres.
  const clavesExistentes: string[] = [];
  for (const lote of enLotes(seriesArchivo, 300)) {
    const { data: yaHay } = await supabase
      .from("comprobantes")
      .select("tipo, serie_numero")
      .in("serie_numero", lote);
    for (const c of yaHay ?? []) {
      const k = claveComprobante({ tipo: String(c.tipo), referencia: c.serie_numero });
      if (k !== null) clavesExistentes.push(k);
    }
  }

  const { nuevas, yaExistian } = separarExistentes(unicas, clavesExistentes);

  const lote = randomUUID();
  const registros = nuevas.map((c) => ({
    empresa_id: empresa.empresa_id,
    fecha: c.fecha,
    fecha_vencimiento: c.fecha_vencimiento ?? null,
    monto: c.monto,
    tipo: c.tipo,
    serie_numero: c.referencia ?? null,
    referencia_externa: c.referencia_externa ?? null,
    ruc_contraparte: c.ruc_contraparte ?? null,
    razon_social_contraparte: c.razon_social ?? null,
    descripcion: c.descripcion ?? null,
    origen: "plantilla" as const,
    lote_importacion: lote,
  }));

  if (registros.length > 0) {
    const { error } = await supabase.from("comprobantes").insert(registros);
    if (error) {
      // 23505 = el índice único de 0018. Solo se llega aquí en una carrera
      // (dos importaciones a la vez); el mensaje lo dice sin culpar al usuario.
      const duplicado = error.code === "23505";
      return {
        ok: false,
        error: duplicado
          ? "Algunos comprobantes se cargaron desde otra pestaña mientras subías este archivo. Vuelve a intentarlo: los que ya estén se omitirán."
          : "No se pudieron guardar los comprobantes.",
      };
    }
  }

  const resumen = {
    insertados: registros.length,
    yaExistian,
    repetidasEnArchivo: repetidas,
    invalidas,
  };

  revalidatePath("/comprobantes");
  return {
    ok: true,
    ...resumen,
    lote: registros.length > 0 ? lote : undefined,
    mensaje: mensajeImportacion(resumen),
  };
}

export type BorradoResultado = {
  ok: boolean;
  error?: string;
  borrados?: number;
  /** No se borraron porque ya tienen cobros aplicados. */
  protegidos?: number;
};

/**
 * Comprobantes de la empresa que NO se pueden borrar porque una conciliación ya
 * les aplicó un cobro.
 *
 * Borrarlos dejaría un agujero en una conciliación aprobada: la
 * `aplicaciones_cobro` se iría en cascada y el resultado del job seguiría
 * diciendo que esa factura se cobró. Lo conciliado no se limpia; se anula.
 */
async function idsConCobros(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[]> {
  // Se parte de las APLICACIONES, no de los comprobantes: son órdenes de
  // magnitud menos. Enumerar los comprobantes para preguntar cuáles están
  // protegidos costaba una petición por cada mil — con 100.000 comprobantes
  // eran cien viajes antes de borrar una sola fila, y "Deshacer" tardaba
  // cuatro minutos.
  const filas = await traerTodo<{ comprobante_id: string }>((d, h) =>
    supabase
      .from("aplicaciones_cobro")
      .select("comprobante_id")
      .order("id", { ascending: true })
      .range(d, h),
  );
  return [...new Set(filas.map((a) => String(a.comprobante_id)))];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Borra comprobantes que cumplan un filtro, respetando los que ya tienen cobros
 * aplicados.
 *
 * ⚠️ El coste NO depende de cuántos se borren: se cuenta con `count`, se piden
 * los protegidos (que son pocos) y se lanza UN delete con el filtro. Borrar
 * 100.000 cuesta lo mismo que borrar 10. La versión anterior enumeraba los ids
 * de todo lo que iba a borrar —cien peticiones para 100.000— y ni siquiera los
 * usaba cuando no había nada protegido.
 */
async function borrarComprobantes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filtrar: (q: any) => any,
  errorMsg: string,
): Promise<BorradoResultado> {
  const { count: total } = await filtrar(
    supabase.from("comprobantes").select("id", { count: "exact", head: true }),
  );
  if (!total) return { ok: true, borrados: 0, protegidos: 0 };

  // ¿Cuáles de los protegidos caen dentro de este filtro? Se pregunta con un
  // `.in()` sobre los pocos protegidos, nunca sobre los miles a borrar.
  const protegidosAqui: string[] = [];
  for (const parte of enLotes(await idsConCobros(supabase))) {
    const { data } = await filtrar(
      supabase.from("comprobantes").select("id").in("id", parte),
    );
    for (const c of (data ?? []) as { id: string }[]) protegidosAqui.push(String(c.id));
  }

  let borrado = filtrar(supabase.from("comprobantes").delete());
  if (protegidosAqui.length > 0) {
    borrado = borrado.not("id", "in", `(${protegidosAqui.join(",")})`);
  }
  const { error } = await borrado;
  if (error) return { ok: false, error: errorMsg };

  return {
    ok: true,
    borrados: total - protegidosAqui.length,
    protegidos: protegidosAqui.length,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Deshace una carga de plantilla: borra los comprobantes intactos de ese lote. */
export async function deshacerImportacion(
  lote: string,
): Promise<BorradoResultado> {
  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };
  if (!lote) return { ok: false, error: "Falta indicar qué importación deshacer." };

  const supabase = await createClient(); // RLS acota a la empresa
  const res = await borrarComprobantes(
    supabase,
    (q) => q.eq("lote_importacion", lote),
    "No se pudo deshacer la importación.",
  );
  if (res.ok) revalidatePath("/comprobantes");
  return res;
}

/**
 * Vacía los comprobantes de la empresa. Solo los intactos: lo que ya entró en
 * una conciliación se conserva y se informa.
 *
 * Pide la palabra escrita porque es la única acción del producto que borra
 * datos en masa, y un clic de más no debería poder disparar eso.
 */
export async function vaciarComprobantes(
  confirmacion: string,
): Promise<BorradoResultado> {
  if (confirmacion.trim().toUpperCase() !== CONFIRMACION_VACIAR) {
    return {
      ok: false,
      error: `Escribe ${CONFIRMACION_VACIAR} para confirmar que quieres borrarlos.`,
    };
  }

  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };

  const supabase = await createClient(); // RLS acota a la empresa
  const res = await borrarComprobantes(
    supabase,
    // "Todos los de la empresa": RLS ya acota, el filtro solo evita un delete
    // sin condición, que PostgREST rechaza.
    (q) => q.not("id", "is", null),
    "No se pudieron borrar los comprobantes.",
  );
  if (res.ok) revalidatePath("/comprobantes");
  return res;
}

/**
 * Memoria de formatos: guarda el mapeo de columnas confirmado en
 * `cuentas_bancarias.mapeo_columnas` bajo la clave `extracto`, para
 * autoaplicarlo la próxima vez con los mismos encabezados. (La clave `internos`
 * quedó huérfana al retirarse la fuente "Subir archivo"; el merge conserva lo
 * que hubiera guardado antes, simplemente ya no se lee ni se escribe.)
 */
export async function guardarMapeoCuenta(
  cuentaId: string,
  mapeos: { extracto?: MapeoColumnas },
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  // Merge con lo existente (RLS asegura que la cuenta sea de la empresa).
  const { data: actual } = await supabase
    .from("cuentas_bancarias")
    .select("mapeo_columnas")
    .eq("id", cuentaId)
    .maybeSingle();

  const previo = (actual?.mapeo_columnas ?? {}) as Record<string, unknown>;
  const nuevo = {
    ...previo,
    ...(mapeos.extracto ? { extracto: mapeos.extracto } : {}),
  };

  const { error } = await supabase
    .from("cuentas_bancarias")
    .update({ mapeo_columnas: nuevo })
    .eq("id", cuentaId);

  return { ok: !error };
}

/**
 * Registros internos desde la tabla `comprobantes` para el período, ya en forma
 * canónica RegistroInterno (fuente "Usar mis comprobantes registrados").
 *
 * ⚠️ Deja fuera lo que ya está cobrado y lo anulado. Un comprobante saldado no
 * es materia de conciliación: volver a ofrecerlo lleva a conciliarlo por
 * segunda vez desde otra cuenta bancaria del mismo período —algo que el sistema
 * permite a propósito, porque son extractos distintos— y a descontar su importe
 * dos veces. Lo que ya se cobró no vuelve a la mesa.
 */
export async function getComprobantesCanonicos(
  desde: string,
  hasta: string,
): Promise<RegistroInterno[]> {
  const supabase = await createClient();
  // ⚠️ PAGINADO OBLIGATORIO. Sin esto PostgREST devolvía 1.000 filas y un 200
  // OK: con 20.000 comprobantes en el período, el motor recibía el 5% del mes
  // y nadie se enteraba. Ver `lib/supabase/paginado.ts`.
  const filas = await traerTodo<{
    id: string; fecha: string; monto: number; saldo: number | null;
    tipo: string; estado: string; serie_numero: string | null;
    referencia_externa: string | null; ruc_contraparte: string | null;
    razon_social_contraparte: string | null; descripcion: string | null;
  }>((d, h) =>
    supabase
      .from("comprobantes")
      .select(
        "id, fecha, monto, saldo, tipo, estado, serie_numero, referencia_externa, ruc_contraparte, razon_social_contraparte, descripcion",
      )
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .not("estado", "in", "(cobrado,anulado)")
      .order("fecha", { ascending: true })
      // Desempate obligatorio: sin él el paginado duplica y pierde filas.
      .order("id", { ascending: true })
      .range(d, h),
  );
  return filas.map((c, i) => {
    const tipo = c.tipo === "pago" ? "pago" : "cobranza";
    const monto = Math.abs(Number(c.monto ?? 0));
    return {
      // Se conserva el id legible para la pantalla de revisión —un UUID en una
      // tabla de dos mil filas no hay quien lo lea— y el vínculo real al
      // comprobante viaja aparte, en `comprobante_id`.
      id_interno: `REG-${String(i + 1).padStart(4, "0")}`,
      fecha: String(c.fecha),
      monto: tipo === "pago" ? -monto : monto,
      tipo,
      // El motor casa por aquí. `referencia_externa` manda cuando existe; si
      // no, se cae al número de documento, que es lo que hacía antes de la
      // `0020` y sigue siendo lo correcto para quien factura y cobra 1:1.
      referencia: c.referencia_externa ?? c.serie_numero ?? null,
      contraparte: c.razon_social_contraparte ?? null,
      descripcion: c.descripcion ?? null,
      comprobante_id: c.id,
    };
  });
}
