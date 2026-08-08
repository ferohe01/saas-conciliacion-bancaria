import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmpresaActual } from "@/lib/auth";
import { enLotes } from "@/lib/supabase/paginado";
import { LectorCsv, type FilaCsv } from "@/lib/parsing/csv";
import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";
import {
  claveComprobante,
  mensajeImportacion,
  type ResumenImportacion,
} from "@/lib/importacion";

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
  descripcion: string | null;
  origen: "plantilla";
  lote_importacion: string;
};

const texto = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** Aplica a una fila cruda las mismas reglas que usaba el cliente. */
function preparar(
  f: Record<string, unknown>,
  empresaId: string,
  lote: string,
): Preparada | null {
  const fecha = normalizarFecha(f["fecha"]);
  const monto = normalizarMonto(f["monto"]);
  const tipoRaw = String(f["tipo"] ?? "").trim().toLowerCase();
  const tipo = tipoRaw === "cobranza" || tipoRaw === "pago" ? tipoRaw : null;
  if (!fecha || monto == null || !tipo) return null;

  return {
    empresa_id: empresaId,
    fecha,
    fecha_vencimiento: normalizarFecha(f["fecha_vencimiento"]) ?? null,
    monto,
    tipo,
    serie_numero: texto(f["referencia"]),
    referencia_externa: texto(f["referencia_externa"]),
    ruc_contraparte: texto(f["ruc_contraparte"]),
    razon_social_contraparte: texto(f["razon_social"]),
    descripcion: texto(f["descripcion"]),
    origen: "plantilla",
    lote_importacion: lote,
  };
}

export async function POST(request: Request) {
  const empresa = await getEmpresaActual();
  if (!empresa) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json(
      { error: "No llegó ningún archivo." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const lote = randomUUID();
  const resumen: ResumenImportacion = {
    insertados: 0,
    yaExistian: 0,
    repetidasEnArchivo: 0,
    invalidas: 0,
  };

  // Series ya presentes en la empresa. Se piden UNA vez y se llevan en memoria:
  // preguntar por cada lote serían cientos de viajes, y un Set de 500.000
  // cadenas cortas cabe de sobra.
  //
  // ⚠️ CON `admin` Y FILTRANDO POR EMPRESA, no con el cliente de RLS.
  //
  // La política de `comprobantes` es `es_miembro(empresa_id)`: una función
  // sobre una COLUMNA, que Postgres evalúa fila a fila. Sobre 452.309
  // comprobantes eso pasa de los 8 s de `statement_timeout` y la consulta
  // muere. Y como `traerTodo` se traga el error, el conjunto salía VACÍO: la
  // ruta creía que ninguna serie existía, intentaba insertarlas todas y
  // chocaba con el índice único.
  //
  // El síntoma era desconcertante — "se intentó cargar un comprobante que ya
  // existe" sobre una carga que no había insertado nada— y apuntaba al archivo
  // en vez de a la consulta.
  const { filas: existentes, error: errExistentes } = await traerSeries(
    admin,
    empresa.empresa_id,
  );
  if (errExistentes) {
    return NextResponse.json(
      {
        error:
          "No se pudo comprobar qué comprobantes ya tienes cargados, así que no se importó nada para no duplicarlos. Vuelve a intentarlo en un momento.",
      },
      { status: 503 },
    );
  }
  const yaEnBase = new Set(
    existentes
      .map((c) => claveComprobante({ tipo: c.tipo, referencia: c.serie_numero }))
      .filter((k): k is string => k !== null),
  );

  // Claves vistas en ESTE archivo, para no insertar dos veces la misma.
  const vistas = new Set<string>();
  let pendientes: Preparada[] = [];

  const descargar = async (): Promise<string | null> => {
    if (pendientes.length === 0) return null;
    for (const parte of enLotes(pendientes, LOTE)) {
      const { error } = await admin.from("comprobantes").insert(parte);
      if (error) {
        // El 23505 no debería ocurrir: los repetidos se filtran antes. Si
        // llega aquí es que el filtro no vio la base, y decir "vuelve a
        // intentarlo, los repetidos se omiten" manda a repetir algo que va a
        // fallar igual.
        console.error(`[comprobantes] fallo al insertar el lote ${lote}:`, error);
        return error.code === "23505"
          ? "Algunos comprobantes de este archivo ya estaban cargados y no se pudo distinguirlos. No se importó nada; revisa la lista antes de volver a subirlo."
          : "No se pudieron guardar los comprobantes.";
      }
      resumen.insertados += parte.length;
    }
    pendientes = [];
    return null;
  };

  const admitir = (cruda: Record<string, unknown>) => {
    const p = preparar(cruda, empresa.empresa_id, lote);
    if (!p) {
      resumen.invalidas++;
      return;
    }
    const k = claveComprobante({ tipo: p.tipo, referencia: p.serie_numero });
    if (k !== null) {
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

  const esCsv = archivo.name.toLowerCase().endsWith(".csv");

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
        for (const f of lector.trozo(decoder.decode(value, { stream: true }))) {
          admitir(f as unknown as Record<string, unknown>);
        }
        if (pendientes.length >= LOTE) {
          const err = await descargar();
          if (err) return NextResponse.json({ error: err }, { status: 400 });
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
        return NextResponse.json({ error: "El archivo no tiene hojas." }, { status: 400 });
      }
      const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets[hoja]!,
        { defval: null, raw: false },
      );
      if (filas.length > MAX_FILAS_XLSX) {
        return NextResponse.json(
          {
            error: `Este Excel trae ${filas.length.toLocaleString("es-PE")} filas y el máximo es ${MAX_FILAS_XLSX.toLocaleString("es-PE")}. Guárdalo como CSV: ese formato no tiene tope porque se lee por partes.`,
          },
          { status: 413 },
        );
      }
      for (const f of filas) admitir(f);
    }

    const err = await descargar();
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  } catch {
    return NextResponse.json(
      { error: `No pudimos leer "${archivo.name}". Revisa que sea un Excel o CSV sin contraseña.` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    ...resumen,
    lote: resumen.insertados > 0 ? lote : undefined,
    mensaje: mensajeImportacion(resumen),
  });
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
