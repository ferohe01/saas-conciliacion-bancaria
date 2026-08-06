"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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

  let clavesExistentes: string[] = [];
  if (seriesArchivo.length > 0) {
    const { data: yaHay } = await supabase
      .from("comprobantes")
      .select("tipo, serie_numero")
      .in("serie_numero", seriesArchivo);
    clavesExistentes = (yaHay ?? [])
      .map((c) => claveComprobante({ tipo: String(c.tipo), referencia: c.serie_numero }))
      .filter((k): k is string => k !== null);
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
 * Cuenta cuántos comprobantes de un conjunto NO se pueden borrar porque una
 * conciliación ya les aplicó un cobro.
 *
 * Borrarlos dejaría un agujero en una conciliación aprobada: la
 * `aplicaciones_cobro` se iría en cascada y el resultado del job seguiría
 * diciendo que esa factura se cobró. Lo conciliado no se limpia; se anula.
 */
async function idsConCobros(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase
    .from("aplicaciones_cobro")
    .select("comprobante_id")
    .in("comprobante_id", ids);
  return new Set((data ?? []).map((a) => String(a.comprobante_id)));
}

/** Deshace una carga de plantilla: borra los comprobantes intactos de ese lote. */
export async function deshacerImportacion(
  lote: string,
): Promise<BorradoResultado> {
  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };
  if (!lote) return { ok: false, error: "Falta indicar qué importación deshacer." };

  const supabase = await createClient(); // RLS acota a la empresa
  const { data } = await supabase
    .from("comprobantes")
    .select("id")
    .eq("lote_importacion", lote);

  const ids = (data ?? []).map((c) => String(c.id));
  if (ids.length === 0) return { ok: true, borrados: 0, protegidos: 0 };

  const conCobros = await idsConCobros(supabase, ids);
  const borrables = ids.filter((id) => !conCobros.has(id));

  if (borrables.length > 0) {
    const { error } = await supabase
      .from("comprobantes")
      .delete()
      .in("id", borrables);
    if (error) return { ok: false, error: "No se pudo deshacer la importación." };
  }

  revalidatePath("/comprobantes");
  return { ok: true, borrados: borrables.length, protegidos: conCobros.size };
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
  const { data } = await supabase.from("comprobantes").select("id");
  const ids = (data ?? []).map((c) => String(c.id));
  if (ids.length === 0) return { ok: true, borrados: 0, protegidos: 0 };

  const conCobros = await idsConCobros(supabase, ids);
  const borrables = ids.filter((id) => !conCobros.has(id));

  if (borrables.length > 0) {
    const { error } = await supabase
      .from("comprobantes")
      .delete()
      .in("id", borrables);
    if (error) return { ok: false, error: "No se pudieron borrar los comprobantes." };
  }

  revalidatePath("/comprobantes");
  return { ok: true, borrados: borrables.length, protegidos: conCobros.size };
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
  const { data } = await supabase
    .from("comprobantes")
    .select(
      "id, fecha, monto, saldo, tipo, estado, serie_numero, referencia_externa, ruc_contraparte, razon_social_contraparte, descripcion",
    )
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .not("estado", "in", "(cobrado,anulado)")
    .order("fecha", { ascending: true });

  const filas = data ?? [];
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
