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
import { maxFilasConciliacion } from "@/lib/limites";
import { evaluarDiagnostico } from "@/lib/diagnosticoPrevio";
import { asistenteDisponible, preguntarAlModelo } from "@/lib/ia/cliente";
import {
  promptRevisionPrevia,
  promptSeguimiento,
  type Mensaje,
} from "@/lib/ia/prompts";
import { verificarCifras } from "@/lib/ia/verificacion";
import type { MapeoColumnas } from "@/lib/parsing/deteccion";
import type { RegistroInterno } from "@/lib/contract/payload";
import type { ContadoresPrevios } from "@/lib/diagnosticoPrevio";

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
  lote: string | null,
  errorMsg: string,
  rango?: { desde: string; hasta: string },
): Promise<BorradoResultado> {
  // ⚠️ Cliente de SESIÓN, no `admin`: `borrar_comprobantes` resuelve la empresa
  // desde `auth.uid()`. Con `admin` no hay usuario y no borraría nada, sin
  // error — el mismo fallo silencioso que ocultó "Cargas realizadas".
  const supabase = await createClient();

  // Lo protegido se cuenta ANTES: después de borrar ya no se distingue de lo
  // que nunca estuvo.
  const { data: prot } = await supabase.rpc("comprobantes_protegidos", {
    p_lote: lote,
    p_desde: rango?.desde ?? null,
    p_hasta: rango?.hasta ?? null,
  });
  const protegidos = Number(prot ?? 0);

  // ⚠️ POR LOTES. Borrar 452.309 comprobantes en una sentencia tarda ~13 s y el
  // `statement_timeout` es de 8: se cancelaba entera y no borraba nada, con un
  // escueto "No se pudo deshacer la importación" como toda pista.
  let borrados = 0;
  for (let vuelta = 0; vuelta < 500; vuelta++) {
    const { data, error } = await supabase.rpc("borrar_comprobantes", {
      p_lote: lote,
      p_limite: 20000,
      p_desde: rango?.desde ?? null,
      p_hasta: rango?.hasta ?? null,
    });
    if (error) {
      console.error("[comprobantes] fallo al borrar:", error);
      // Se informa de lo que SÍ se borró: dejarlo en "no se pudo" cuando ya
      // desaparecieron 300.000 filas sería mentir sobre el estado.
      return borrados > 0
        ? { ok: false, borrados, protegidos, error: `${errorMsg} Se quitaron ${borrados.toLocaleString("es-PE")} antes de interrumpirse.` }
        : { ok: false, error: errorMsg };
    }
    const n = Number(data ?? 0);
    if (n === 0) break;
    borrados += n;
  }

  return { ok: true, borrados, protegidos };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Deshace una carga de plantilla: borra los comprobantes intactos de ese lote. */
export async function deshacerImportacion(
  lote: string,
): Promise<BorradoResultado> {
  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };
  if (!lote) return { ok: false, error: "Falta indicar qué importación deshacer." };

  const res = await borrarComprobantes(lote, "No se pudo deshacer la importación.");
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

  // Sin lote = todos los de la empresa. El acotado lo hace la función con
  // `auth.uid()`, así que no hay forma de pedir los de otra.
  const res = await borrarComprobantes(null, "No se pudieron borrar los comprobantes.");
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


/** Lo que el Paso 1 necesita saber de los comprobantes del período. */
export type ResumenComprobantes = {
  registros: number;
  suma: number;
  /** Ya no lo es nunca: la suma la calcula la base sobre TODAS las filas. */
  sumaParcial: boolean;
  /** Total cargado en la empresa, sin filtrar por período. */
  totalCargados: number;
  /** Del período, pero ya saldados: no entran a conciliar. */
  yaCobrados: number;
};

/**
 * Conteo y suma de los comprobantes de un período (migración 0027).
 *
 * ⚠️ Lo cuenta Postgres. Hacerlo desde el navegador con el cliente de RLS
 * —tres consultas sin filtro de empresa— no termina con medio millón de
 * comprobantes: la política `es_miembro(empresa_id)` se evalúa fila a fila, se
 * pasa del `statement_timeout` de 8 s, y la pantalla acababa diciendo "No hay
 * comprobantes en este período" sobre los que sí estaban.
 */
export async function resumenComprobantesPeriodo(
  desde: string,
  hasta: string,
): Promise<ResumenComprobantes> {
  const vacio: ResumenComprobantes = {
    registros: 0,
    suma: 0,
    sumaParcial: false,
    totalCargados: 0,
    yaCobrados: 0,
  };
  const supabase = await createClient(); // la función acota por auth.uid()
  const { data, error } = await supabase.rpc("resumen_comprobantes_periodo", {
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) {
    // Devolver ceros diría "no hay comprobantes", que es una afirmación falsa
    // sobre datos que sí existen — exactamente el fallo que esto viene a
    // corregir. Mejor que la pantalla falle a que tranquilice.
    throw new Error(
      `No se pudo contar los comprobantes del período: ${error.message}`,
    );
  }
  const f = (data as ResumenFila[] | null)?.[0];
  if (!f) return vacio;
  return {
    registros: Number(f.registros ?? 0),
    suma: Number(f.suma ?? 0),
    sumaParcial: false,
    totalCargados: Number(f.total_cargados ?? 0),
    yaCobrados: Number(f.ya_cobrados ?? 0),
  };
}

type ResumenFila = {
  registros: number | string;
  suma: number | string;
  total_cargados: number | string;
  ya_cobrados: number | string;
};


/**
 * Quita los comprobantes de un período, desde el propio wizard.
 *
 * ⚠️ Por PERÍODO y no "la última carga", aunque suene menos natural: la tarjeta
 * del Paso 1 enseña un número concreto, y si el botón quitara el último lote
 * podría llevarse otra cosa —o solo una parte— y dejar ahí un número que el
 * usuario no esperaba. Lo que se ve es lo que se quita.
 *
 * Existe para no tener que abandonar el flujo a medias: si alguien subió el
 * archivo equivocado, lo corrige donde lo descubre.
 */
export async function quitarComprobantesDelPeriodo(
  desde: string,
  hasta: string,
): Promise<BorradoResultado> {
  const empresa = await getEmpresaActual();
  if (!empresa) return { ok: false, error: "Sesión no válida." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return { ok: false, error: "El período no es válido." };
  }

  const res = await borrarComprobantes(
    null,
    "No se pudieron quitar los comprobantes del período.",
    { desde, hasta },
  );
  if (res.ok) revalidatePath("/comprobantes");
  return res;
}

/**
 * Diagnóstico previo del Paso 3: qué va a pasar si se concilia con estos datos.
 *
 * Los dos lados ya están en la base cuando se llega aquí (el Paso 2 importa el
 * extracto y devuelve `lote_id`), así que esto no es una heurística sobre lo
 * que se ve en pantalla: es la comprobación real, hecha antes de gastar la
 * corrida. Ver `lib/diagnosticoPrevio.ts`.
 *
 * ⚠️ Cliente de SESIÓN, no `admin`: `diagnostico_previo` es `security definer`
 * y resuelve la empresa desde `auth.uid()`. Con `admin` no hay usuario y
 * devolvería CERO FILAS SIN ERROR — el mismo fallo silencioso que escondió las
 * "Cargas realizadas" en /comprobantes.
 *
 * Si algo falla no se interrumpe nada: se devuelve `null` y el Paso 3 sigue
 * funcionando como antes. Un diagnóstico es una ayuda, no un requisito.
 */
export async function diagnosticarAntesDeConciliar(
  loteId: string,
  desde: string,
  hasta: string,
): Promise<{ contadores: ContadoresPrevios; maxFilas: number } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("diagnostico_previo", {
      p_lote_id: loteId,
      p_desde: desde,
      p_hasta: hasta,
    })
    .maybeSingle();

  if (error || !data) return null;

  const c = data as Record<string, number | null>;
  const n = (k: string) => Number(c[k] ?? 0);

  return {
    contadores: {
      internos: n("internos"),
      internos_con_ref: n("internos_con_ref"),
      internos_ref_repetida: n("internos_ref_repetida"),
      movimientos: n("movimientos"),
      movimientos_con_ref: n("movimientos_con_ref"),
      movimientos_ref_repetida: n("movimientos_ref_repetida"),
      movimientos_abono: n("movimientos_abono"),
      movimientos_cargo: n("movimientos_cargo"),
      movimientos_fuera: n("movimientos_fuera"),
      movimientos_dia_bajo: n("movimientos_dia_bajo"),
      refs_compartidas: n("refs_compartidas"),
      // null significa "no se estimó por volumen", que NO es lo mismo que cero.
      pares_estimados:
        c["pares_estimados"] == null ? null : Number(c["pares_estimados"]),
    },
    maxFilas: maxFilasConciliacion(),
  };
}

/**
 * El asistente explica la revisión previa del Paso 3, y responde repreguntas.
 *
 * ⚠️⚠️ **El contexto se reconstruye aquí, en el servidor.** El cliente manda el
 * lote y las fechas, nunca los hallazgos: si el navegador pudiera enviar el
 * texto contra el que se verifica, controlaría qué cifras se admiten y
 * `verificarCifras` dejaría de comprobar nada.
 */
export async function explicarRevisionPrevia(
  loteId: string,
  desde: string,
  hasta: string,
  historial: Mensaje[] = [],
  pregunta?: string,
): Promise<{ ok: true; texto: string } | { ok: false; error: string }> {
  if (!asistenteDisponible()) {
    return { ok: false, error: "El asistente no está disponible." };
  }

  const datos = await diagnosticarAntesDeConciliar(loteId, desde, hasta);
  if (!datos) {
    return { ok: false, error: "No se pudo revisar tus datos." };
  }

  const hallazgos = evaluarDiagnostico(datos.contadores, datos.maxFilas);
  if (hallazgos.length === 0) {
    return { ok: false, error: "No hay nada que explicar todavía." };
  }

  const { mensajes, contexto } = promptRevisionPrevia(hallazgos);
  const conversacion = pregunta
    ? promptSeguimiento(mensajes, historial, pregunta)
    : mensajes;

  const r = await preguntarAlModelo(conversacion);
  if (!r.ok) return r;

  // ⚠️ Ninguna cifra que no se le haya dado. Ver `lib/ia/verificacion.ts`.
  const v = verificarCifras(
    r.texto,
    contexto + "\n" + historial.map((m) => m.content).join("\n"),
  );
  if (!v.ok) {
    console.error("[asistente] cifras no verificadas", v.intrusas);
    return {
      ok: false,
      error:
        "El asistente dio una respuesta con cifras que no cuadran, así que no " +
        "se muestra. La revisión de arriba sí es correcta.",
    };
  }

  return { ok: true, texto: r.texto };
}
