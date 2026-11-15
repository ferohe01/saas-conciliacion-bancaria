import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { exigir } from "@/lib/roles-servidor";
import { enLotes } from "@/lib/supabase/paginado";
import { LectorCsv, type FilaCsv } from "@/lib/parsing/csv";
import {
  claveComprobante,
  mensajeImportacion,
  type ProgresoImportacion,
  type ResumenImportacion,
} from "@/lib/importacion";
import {
  aplicarMapeo,
  esPlantilla,
  MAPEO_PLANTILLA,
  ConfigMapeoGuardado,
  type Config,
} from "@/lib/parsing/mapeoComprobantes";
import { permiteArchivoPropio } from "@/lib/modoCarga";
import {
  reconocerFormato,
  saldoMasReciente,
  type SaldoEnFecha,
} from "@/lib/parsing/formatosConocidos";
import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";
import { registrarImportacion } from "@/lib/importacion-servidor";

/**
 * Ingesta de comprobantes EN SERVIDOR, por lotes.
 *
 * ── Qué problema resuelve ──────────────────────────────────────────────────
 *
 * Antes el navegador parseaba el archivo y mandaba las filas ya normalizadas a
 * una server action. Eso topaba tres veces: la memoria del navegador (450.000
 * filas son 1–3 GB), el límite de body de las server actions, y el tope de
 * 5.000 filas por llamada. Aquí sube el ARCHIVO y el servidor hace el resto.
 *
 * ── CSV se lee a trozos; XLSX no puede ─────────────────────────────────────
 *
 * El CSV se consume del stream de la petición con memoria constante: se leen
 * unos miles de filas, se insertan, y se sueltan. Un XLSX hay que
 * descomprimirlo entero antes de ver la primera fila, así que para ese formato
 * se mantiene un tope prudente y se recomienda CSV. No es pereza: es que el
 * pico de memoria del XLSX ocurre ANTES de que exista lote alguno que insertar.
 */

export const runtime = "nodejs";
// El trabajo es largo por definición: cientos de miles de filas en tandas.
export const maxDuration = 300;

/** Filas por INSERT. Ni tan pocas que sean mil viajes, ni tanto que la petición pese. */
const LOTE = 1000;

/** Bytes del CSV que se procesan de cada vez: ~1.200 filas de un mayor contable. */
const TROZO_CSV = 256 * 1024;

/** Tope para XLSX, que se lee entero en memoria. El CSV no tiene tope. */
const MAX_FILAS_XLSX = 50_000;

type Preparada = {
  empresa_id: string;
  fecha: string;
  fecha_vencimiento: string | null;
  monto: number;
  tipo: "cobranza" | "pago";
  serie_numero: string | null;
  referencia_externa: string | null;
  ruc_contraparte: string | null;
  razon_social_contraparte: string | null;
  moneda: string;
  descripcion: string | null;
  origen: "plantilla";
  lote_importacion: string;
};

/**
 * Aplica a una fila cruda el mapeo que corresponda.
 *
 * ⚠️ Sin `config` explícita se usa el de la plantilla, así que **el camino de
 * siempre no cambia**: quien sube la plantilla no nota nada, ni siquiera si
 * nunca configuró un mapeo.
 */
function preparar(
  f: Record<string, unknown>,
  empresaId: string,
  lote: string,
  config: Config,
): Preparada | null {
  const fila = aplicarMapeo(f, config);
  if (!fila) return null;

  return {
    empresa_id: empresaId,
    fecha: fila.fecha,
    fecha_vencimiento: fila.fecha_vencimiento,
    monto: fila.monto,
    tipo: fila.tipo,
    serie_numero: fila.serie_numero,
    referencia_externa: fila.referencia_externa,
    ruc_contraparte: fila.ruc_contraparte,
    razon_social_contraparte: fila.razon_social,
    moneda: fila.moneda,
    descripcion: fila.descripcion,
    origen: "plantilla",
    lote_importacion: lote,
  };
}

/**
 * De dónde sale el mapeo, en orden: lo que manda esta petición, lo que la
 * empresa dejó configurado, y si no, la plantilla.
 *
 * El segundo escalón es el que hace que la carga rápida del wizard funcione con
 * el formato del cliente sin volver a preguntar nada.
 */
function resolverConfig(crudo: unknown, guardado: unknown): Config {
  const parsed = ConfigMapeoGuardado.safeParse(crudo);
  if (parsed.success) return parsed.data;
  const previo = ConfigMapeoGuardado.safeParse(guardado);
  if (previo.success) return previo.data;
  return { mapeo: MAPEO_PLANTILLA, tipoFijo: null };
}

export async function POST(request: Request) {
  const acceso = await exigir("cargar");
  if (!acceso.ok) {
    return NextResponse.json({ error: acceso.error }, { status: acceso.status });
  }
  const { empresa } = acceso;

  const form = await request.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json(
      { error: "No llegó ningún archivo." },
      { status: 400 },
    );
  }

  // El mapeo puede venir en esta petición (primera vez, o corregido) o estar
  // guardado en la empresa. Sin ninguno de los dos, la plantilla.
  let mapeoPeticion: unknown = undefined;
  const crudoMapeo = form?.get("mapeo");
  if (typeof crudoMapeo === "string" && crudoMapeo.trim() !== "") {
    try {
      mapeoPeticion = JSON.parse(crudoMapeo);
    } catch {
      return NextResponse.json(
        { error: "El mapeo de columnas no se pudo leer." },
        { status: 400 },
      );
    }
  }
  // ⚠️ El modo se hace cumplir AQUÍ, no solo en la pantalla.
  //
  // En modo `plantilla` se ignora cualquier mapeo —venga en la petición o
  // guardado de antes— y se lee con las columnas de la plantilla. Ocultar la
  // opción en la interfaz orienta; esto es lo que impide que un POST directo
  // cargue un archivo con columnas elegidas a mano. Misma lección que el
  // período de prueba: un botón escondido no es un control.
  const archivoPropio = permiteArchivoPropio(empresa.modo_carga);
  const config = archivoPropio
    ? resolverConfig(mapeoPeticion, empresa.mapeo_comprobantes)
    : { mapeo: MAPEO_PLANTILLA, tipoFijo: null };

  // `procesar` es una declaración (se eleva), y TypeScript no lleva dentro el
  // estrechamiento de `empresa` y `archivo`: se fijan aquí, ya comprobados.
  const empresaActual = empresa;
  const archivoSubido = archivo;

  // ── Con progreso, si el navegador lo pide ─────────────────────────────────
  //
  // ⚠️ Medio millón de filas son ~20 minutos, y con un «Importando…» fijo eso
  // es indistinguible de un cuelgue: lo natural es recargar o volver a subir.
  // Si la petición acepta NDJSON, la respuesta es un stream con una línea de
  // avance cada poco y una línea final con el resultado de siempre. Sin esa
  // cabecera, la ruta responde exactamente como antes.
  const quiereProgreso = (request.headers.get("accept") ?? "").includes(
    "application/x-ndjson",
  );
  if (!quiereProgreso) {
    const r = await procesar(() => {});
    return NextResponse.json(r.body, { status: r.status });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      // ⚠️ Si el usuario cierra la pestaña el stream se cancela y `enqueue`
      // lanza. La importación NO se interrumpe por eso: cortarla a mitad
      // dejaría media carga sin registrar. Solo se deja de avisar.
      let abierto = true;
      const enviar = (o: Record<string, unknown>) => {
        if (!abierto) return;
        try {
          ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          abierto = false;
        }
      };
      const r = await procesar((p) => enviar({ tipo: "progreso", ...p }));
      enviar({ tipo: "fin", status: r.status, ...r.body });
      if (abierto) ctrl.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      // Que ningún proxy lo acumule hasta el final: eso anularía el avance.
      "x-accel-buffering": "no",
    },
  });

  async function procesar(
    avisar: (p: ProgresoImportacion) => void,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
  const empresa = empresaActual;
  const archivo = archivoSubido;
  const admin = createAdminClient();
  const lote = randomUUID();
  const resumen: ResumenImportacion = {
    insertados: 0,
    yaExistian: 0,
    repetidasEnArchivo: 0,
    invalidas: 0,
  };
  // Rango de fechas de lo que entra. Es lo que después permite saber QUÉ CARGAS
  // alimentan un período sin recorrer medio millón de comprobantes (0043).
  let fechaMin: string | null = null;
  let fechaMax: string | null = null;

  // ── Qué comprobantes YA están cargados ────────────────────────────────────
  //
  // ⚠️⚠️ Esto se preguntaba SIEMPRE por todo, y era el coste dominante de
  // cualquier carga: traer las 452.309 series de la empresa son ~453 peticiones
  // paginadas, se suban 200 filas o 450.000. El síntoma lo delataba —**subir
  // 200 comprobantes tardaba casi lo mismo que subir el mes entero**— y la
  // causa no estaba en el archivo sino en lo que ya había en la base.
  //
  // Ahora se pregunta por LO QUE TRAE EL ARCHIVO, lote a lote, y solo se
  // precarga todo cuando el archivo demuestra ser grande: a partir de ahí
  // preguntar por partes serían más viajes que traerlo entero. Con 200 filas es
  // UNA consulta.
  //
  // ⚠️ CON `admin` Y FILTRANDO POR EMPRESA, no con el cliente de RLS. La
  // política de `comprobantes` es `es_miembro(empresa_id)`: una función sobre
  // una COLUMNA que Postgres evalúa fila a fila, y sobre medio millón se pasa
  // del `statement_timeout`. Como el error se tragaba, el conjunto salía VACÍO
  // y la ruta intentaba insertarlo todo contra el índice único — con un mensaje
  // que culpaba al archivo.
  const UMBRAL_PRECARGA = 20_000;
  const yaEnBase = new Set<string>();
  let precargado = false;
  let filasProcesadas = 0;

  /** Cuáles de estas claves ya existen. Elige la estrategia por tamaño. */
  const existentesDe = async (
    claves: { clave: string; serie: string }[],
  ): Promise<{ set: Set<string>; error: boolean }> => {
    if (!precargado && filasProcesadas > UMBRAL_PRECARGA) {
      const { filas, error } = await traerSeries(admin, empresa.empresa_id);
      if (error) return { set: new Set(), error: true };
      for (const c of filas) {
        const k = claveComprobante({ tipo: c.tipo, referencia: c.serie_numero });
        if (k !== null) yaEnBase.add(k);
      }
      precargado = true;
    }

    if (precargado) {
      return {
        set: new Set(claves.filter((c) => yaEnBase.has(c.clave)).map((c) => c.clave)),
        error: false,
      };
    }

    // ⚠️ Troceado a 300: los `.in()` no fallan por número de filas sino por
    // longitud de URL, y una serie puede ser larga.
    const encontradas = new Set<string>();
    const series = [...new Set(claves.map((c) => c.serie))];
    for (const parte of enLotes(series, 300)) {
      const { data, error } = await admin
        .from("comprobantes")
        .select("tipo, serie_numero")
        .eq("empresa_id", empresa.empresa_id)
        .in("serie_numero", parte);
      if (error) {
        console.error("[comprobantes] no se pudieron leer las series:", error);
        return { set: new Set(), error: true };
      }
      for (const c of data ?? []) {
        const k = claveComprobante({
          tipo: String(c.tipo),
          referencia: c.serie_numero as string | null,
        });
        if (k !== null) encontradas.add(k);
      }
    }
    return { set: encontradas, error: false };
  };

  // Claves vistas en ESTE archivo, para no insertar dos veces la misma.
  const vistas = new Set<string>();
  let pendientes: Preparada[] = [];

  const esCsv = archivo.name.toLowerCase().endsWith(".csv");

  // Avance: en CSV, bytes leídos contra el tamaño del archivo. Es exacto desde
  // el primer trozo, mientras que el total de filas no se sabe hasta el final.
  // En XLSX no hay fracción (se lee entero de golpe) y se cuentan las filas.
  let bytesLeidos = 0;
  let ultimoAviso = 0;
  const avanzar = (fase: ProgresoImportacion["fase"], forzar = false) => {
    const ahora = Date.now();
    if (!forzar && ahora - ultimoAviso < 500) return;
    ultimoAviso = ahora;
    avisar({
      fase,
      filas: filasProcesadas,
      insertados: resumen.insertados,
      fraccion:
        esCsv && archivo.size > 0
          ? Math.min(1, bytesLeidos / archivo.size)
          : null,
    });
  };

  // ── Inserts en paralelo ───────────────────────────────────────────────────
  //
  // Uno a uno, cada lote esperaba su viaje entero a la base antes de mandar el
  // siguiente: con 453 lotes, la carga era la suma de 453 esperas. Medido desde
  // fuera del VPS, 4 a la vez tardan la mitad (12 lotes: 6,3 s → 3,3 s); más
  // apenas mejora, porque el cuello pasa a ser la base, y cada insert más es una
  // conexión más contra el mismo Postgres.
  //
  // ⚠️ El orden NO importa y la deduplicación no depende de él: las claves se
  // apartan en memoria (`vistas`, `yaEnBase`) ANTES de lanzar el insert, así que
  // dos lotes en vuelo nunca llevan el mismo comprobante.
  const EN_PARALELO = 4;
  const enVuelo = new Set<Promise<void>>();
  let errorInsert: string | null = null;

  const lanzarInsert = (parte: Preparada[]) => {
    const p = (async () => {
      try {
        const { error } = await admin.from("comprobantes").insert(parte);
        if (error) {
          // El 23505 no debería ocurrir: los repetidos se filtran antes. Si
          // llega aquí es que el filtro no vio la base, y decir "vuelve a
          // intentarlo, los repetidos se omiten" manda a repetir algo que va
          // a fallar igual.
          console.error(`[comprobantes] fallo al insertar el lote ${lote}:`, error);
          errorInsert ??=
            error.code === "23505"
              ? "Algunos comprobantes de este archivo ya estaban cargados y no se pudo distinguirlos. Revisa la lista antes de volver a subirlo."
              : "No se pudieron guardar los comprobantes.";
          return;
        }
        resumen.insertados += parte.length;
        avanzar("cargando");
      } catch (e) {
        // Un corte de red lanza en vez de devolver `error`. Sin esta captura
        // la promesa rechazaría y nadie la estaría esperando.
        console.error(`[comprobantes] fallo de red insertando el lote ${lote}:`, e);
        errorInsert ??= "Se perdió la conexión con la base mientras se guardaban los comprobantes.";
      }
    })();
    enVuelo.add(p);
    void p.then(() => enVuelo.delete(p));
  };

  const descargar = async (): Promise<string | null> => {
    if (pendientes.length === 0) return null;

    // Lo que ya está en la base se aparta ANTES de insertar. Un comprobante
    // existente NO se actualiza: puede tener cobros aplicados y su saldo se
    // calcula desde `monto`, así que reescribirlo lo dejaría mintiendo.
    const conClave = pendientes
      .map((p) => ({
        p,
        clave: claveComprobante({ tipo: p.tipo, referencia: p.serie_numero }),
        serie: p.serie_numero,
      }))
      .filter((x): x is { p: Preparada; clave: string; serie: string } =>
        x.clave !== null && x.serie !== null,
      );

    const { set: existen, error: errExistentes } = await existentesDe(conClave);
    if (errExistentes) {
      return "No se pudo comprobar qué comprobantes ya tienes cargados, así que no se importó nada para no duplicarlos. Vuelve a intentarlo en un momento.";
    }

    const aInsertar = pendientes.filter((p) => {
      const k = claveComprobante({ tipo: p.tipo, referencia: p.serie_numero });
      if (k === null) return true; // sin número no hay identidad: siempre entra
      if (existen.has(k)) {
        resumen.yaExistian++;
        return false;
      }
      // Se recuerda para los lotes siguientes del mismo archivo.
      yaEnBase.add(k);
      return true;
    });

    for (const parte of enLotes(aInsertar, LOTE)) {
      if (errorInsert) break;
      // Como mucho EN_PARALELO a la vez: se espera a que acabe alguno.
      while (enVuelo.size >= EN_PARALELO) await Promise.race(enVuelo);
      lanzarInsert(parte);
    }
    pendientes = [];
    if (errorInsert) {
      // Antes de informar del fallo se deja terminar lo que ya salió: así el
      // recuento de insertados es el real y no queda trabajo suelto.
      await Promise.all(enVuelo);
      return errorInsert;
    }
    return null;
  };

  /** Espera a que terminen todos los inserts lanzados. Devuelve el primer error. */
  const esperarInserts = async (): Promise<string | null> => {
    await Promise.all(enVuelo);
    return errorInsert;
  };

  /**
   * ⚠️ La PLANTILLA gana sobre el mapeo guardado.
   *
   * Una empresa que configuró el formato de su ERP y luego sube la plantilla
   * —para cargar cuatro facturas a mano, por ejemplo— vería fallar TODAS las
   * filas: el mapeo guardado apunta a columnas que ese archivo no tiene, y el
   * resultado sería "0 importados, 3.000 inválidos" sin ninguna pista.
   *
   * Se decide con las cabeceras reales del archivo, la primera vez que se ve
   * una fila. Los dos caminos tienen que poder convivir sin configurar nada.
   */
  let configFila: Config | null = null;

  // ── Saldo según libros, si el archivo es un libro mayor conocido ──────────
  //
  // Su columna de saldo acumulado dice el saldo en libros línea a línea; el de
  // la línea más reciente es el que el Paso 1 pedía teclear. Se mira en TODAS
  // las filas, también las que no entran como comprobante (las de crédito):
  // llevan el acumulado igual, y saltárselas daría el saldo de otra línea.
  let columnaSaldo: string | null | undefined;
  let columnaFechaSaldo: string | null = null;
  let saldoLibros: SaldoEnFecha | null = null;
  const seguirSaldo = (cruda: Record<string, unknown>) => {
    if (columnaSaldo === undefined) {
      const r = reconocerFormato(Object.keys(cruda));
      columnaSaldo = r?.columnaSaldo ?? null;
      columnaFechaSaldo = r?.config.mapeo.fecha ?? null;
    }
    if (!columnaSaldo || !columnaFechaSaldo) return;
    const fecha = normalizarFecha(cruda[columnaFechaSaldo]);
    const saldo = normalizarMonto(cruda[columnaSaldo]);
    if (fecha === null || saldo === null) return;
    // El export trae ruido de coma flotante (13886769.150010169).
    saldoLibros = saldoMasReciente(saldoLibros, {
      saldo: Math.round(saldo * 100) / 100,
      fecha,
    });
  };

  const admitir = (cruda: Record<string, unknown>) => {
    if (configFila === null) {
      configFila =
        archivoPropio && !esPlantilla(Object.keys(cruda))
          ? config
          : { mapeo: MAPEO_PLANTILLA, tipoFijo: null };
    }
    filasProcesadas++;
    seguirSaldo(cruda);
    const p = preparar(cruda, empresa.empresa_id, lote, configFila);
    if (!p) {
      resumen.invalidas++;
      return;
    }
    if (fechaMin === null || p.fecha < fechaMin) fechaMin = p.fecha;
    if (fechaMax === null || p.fecha > fechaMax) fechaMax = p.fecha;
    const k = claveComprobante({ tipo: p.tipo, referencia: p.serie_numero });
    if (k !== null) {
      // Repetida dentro del propio archivo. Lo que ya está en la BASE se mira
      // al vaciar el lote (`descargar`), que es donde se puede preguntar.
      if (vistas.has(k)) {
        resumen.repetidasEnArchivo++;
        return;
      }
      vistas.add(k);
      if (yaEnBase.has(k)) {
        resumen.yaExistian++;
        return;
      }
    }
    pendientes.push(p);
  };

  avanzar("cargando", true);

  try {
    if (esCsv && request.body !== null) {
      // ── Camino que escala: trozo → filas → insertar → soltar ──
      const lector = new LectorCsv();
      const decoder = new TextDecoder("utf-8");
      const stream = archivo.stream();
      const reader = stream.getReader();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // ⚠️ Se trocea lo que llega. El archivo ya está en memoria (lo dejó ahí
        // `formData()`), y su stream puede entregarlo en UN solo trozo de 95 MB:
        // entonces los bytes leídos marcaban 100 % al primer instante y la
        // barra se quedaba llena mientras quedaba todo el trabajo con la base.
        // Con trozos pequeños, leer e insertar avanzan juntos y el porcentaje
        // dice la verdad. El decoder en modo `stream` une los caracteres que
        // queden partidos entre dos trozos.
        for (let i = 0; i < value.byteLength; i += TROZO_CSV) {
          const parte = value.subarray(i, i + TROZO_CSV);
          for (const f of lector.trozo(decoder.decode(parte, { stream: true }))) {
            admitir(f as unknown as Record<string, unknown>);
          }
          bytesLeidos += parte.byteLength;
          // También aquí, no solo al terminar un insert: si todo el archivo ya
          // estaba cargado no se inserta nada y la barra no se movería nunca.
          avanzar("cargando");
          if (pendientes.length >= LOTE) {
            const err = await descargar();
            if (err) return { status: 400, body: { error: err } };
          }
        }
      }
      for (const f of lector.fin() as FilaCsv[]) {
        admitir(f as unknown as Record<string, unknown>);
      }
    } else {
      // ── XLSX: no hay más remedio que leerlo entero ──
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await archivo.arrayBuffer(), { cellDates: true });
      const hoja = wb.SheetNames[0];
      if (!hoja) {
        return { status: 400, body: { error: "El archivo no tiene hojas." } };
      }
      const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets[hoja]!,
        { defval: null, raw: false },
      );
      if (filas.length > MAX_FILAS_XLSX) {
        return {
          status: 413,
          body: {
            error: `Este Excel trae ${filas.length.toLocaleString("es-PE")} filas y el máximo es ${MAX_FILAS_XLSX.toLocaleString("es-PE")}. Guárdalo como CSV: ese formato no tiene tope porque se lee por partes.`,
          },
        };
      }
      for (const f of filas) admitir(f);
    }

    const err = (await descargar()) ?? (await esperarInserts());
    if (err) return { status: 400, body: { error: err } };
  } catch {
    // Lo que ya salió hacia la base se deja terminar antes de responder.
    await esperarInserts();
    return {
      status: 400,
      body: {
        error: `No pudimos leer "${archivo.name}". Revisa que sea un Excel o CSV sin contraseña.`,
      },
    };
  }

  // Las filas ya están; queda registrar la carga y refrescar estadísticas, que
  // con medio millón tarda unos segundos. Se dice, para que la barra al 100 %
  // no parezca otra vez colgada.
  avanzar("terminando", true);

  // ── Qué pasó en esta carga, para poder contarlo después ──────────────────
  //
  // Estos cuatro contadores existían solo para el mensaje de la pantalla, que
  // desaparece al recargar. Sin ellos guardados no hay forma de explicar por qué
  // un archivo de 452.605 filas produce 452.309 comprobantes — y esa pregunta
  // se hace SIEMPRE, en la primera demo, sobre datos que están bien.
  //
  // Se registra aunque no se insertara nada: "0 de 3.000, todas repetidas" es
  // justo lo que hay que poder mirar más tarde.
  await registrarImportacion({
    lote,
    empresaId: empresa.empresa_id,
    archivo: archivo.name,
    filasLeidas: filasProcesadas,
    ...resumen,
    fechaMin,
    fechaMax,
    saldoLibros,
  });

  // Mismo motivo que en la ingesta del extracto: tras meter cientos de miles
  // de filas, el planificador necesita saberlo antes de la primera
  // conciliación. Ver `0030_analizar_tras_carga.sql`.
  if (resumen.insertados > 1000) {
    const { error: errAnalisis } = await admin.rpc("analizar_tablas_conciliacion");
    if (errAnalisis) {
      console.error("[comprobantes] no se pudieron refrescar las estadísticas:", errAnalisis);
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      ...resumen,
      lote: resumen.insertados > 0 ? lote : undefined,
      mensaje: mensajeImportacion(resumen),
    },
  };
  }
}


/**
 * Todas las series ya cargadas de una empresa, paginando.
 *
 * Devuelve el error en vez de tragárselo: quedarse corto aquí no da un aviso,
 * da una carga duplicada — o, si el índice único la para, un mensaje que culpa
 * al archivo.
 */
async function traerSeries(
  admin: ReturnType<typeof createAdminClient>,
  empresaId: string,
): Promise<{ filas: { tipo: string; serie_numero: string | null }[]; error: string | null }> {
  const filas: { tipo: string; serie_numero: string | null }[] = [];
  const PAGINA = 1000;
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await admin
      .from("comprobantes")
      .select("tipo, serie_numero")
      .eq("empresa_id", empresaId)
      .not("serie_numero", "is", null)
      // Desempate obligatorio: sin columna única el paginado duplica y pierde.
      .order("id", { ascending: true })
      .range(desde, desde + PAGINA - 1);
    if (error) {
      console.error("[comprobantes] no se pudieron leer las series:", error);
      return { filas: [], error: error.message };
    }
    const lote = data ?? [];
    filas.push(...(lote as { tipo: string; serie_numero: string | null }[]));
    if (lote.length < PAGINA) return { filas, error: null };
  }
}
