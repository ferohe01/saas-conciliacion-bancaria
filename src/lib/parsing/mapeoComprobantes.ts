import { z } from "zod";
import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";

/**
 * Subir los comprobantes CON EL FORMATO DEL CLIENTE.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * El sistema trataba los dos lados con criterios opuestos: al extracto del
 * banco se adapta él (mapeo de columnas, detección y memoria por cuenta), y a
 * los comprobantes se tenía que adaptar el cliente, transponiendo su export a
 * la plantilla columna por columna.
 *
 * Y es al revés de lo que conviene: el archivo del banco es el que nadie puede
 * cambiar, pero el export de un ERP tampoco lo elige el usuario. Con 450.000
 * filas al mes, transponer no es "un esfuerzo inicial": es trabajo recurrente
 * que nadie hace el segundo mes. Peor, una columna corrida un puesto produce
 * una conciliación al 0 % y el cliente no piensa que se equivocó copiando:
 * piensa que el sistema no funciona.
 *
 * ⚠️ **La plantilla no desaparece: pasa a ser un atajo del mismo mecanismo.**
 * Sus cabeceras son la identidad, así que cuando coinciden no se pregunta nada
 * y la experiencia es la de siempre. Es menos maquinaria, no más.
 *
 * ⚠️ **Y esto NO resucita el "Subir archivo" del wizard**, que se retiró porque
 * aquellos registros no tenían `comprobante_id`: conciliaban bien, se veían
 * bien, y ningún comprobante quedaba cobrado — el error silencioso más caro del
 * producto. Aquí la flexibilidad de formato produce filas reales en
 * `comprobantes`, con su id y su saldo. Se parece; no es lo mismo.
 */

/** Campos de un comprobante que se pueden mapear desde una columna. */
export type CampoComprobante =
  | "fecha"
  | "fecha_vencimiento"
  | "monto"
  | "tipo"
  | "serie_numero"
  | "referencia_externa"
  | "ruc_contraparte"
  | "razon_social"
  | "moneda"
  | "descripcion";

export type MapeoComprobantes = Partial<Record<CampoComprobante, string>>;

export const CAMPOS_COMPROBANTE: CampoComprobante[] = [
  "fecha",
  "monto",
  "tipo",
  "serie_numero",
  "referencia_externa",
  "razon_social",
  "ruc_contraparte",
  "fecha_vencimiento",
  "moneda",
  "descripcion",
];

/** Sin estos tres no hay comprobante que insertar. */
export const OBLIGATORIOS: CampoComprobante[] = ["fecha", "monto", "tipo"];

export const ETIQUETA_COMPROBANTE: Record<CampoComprobante, string> = {
  fecha: "Fecha de emisión",
  fecha_vencimiento: "Fecha de vencimiento",
  monto: "Importe",
  tipo: "Tipo (cobranza o pago)",
  serie_numero: "Número de documento",
  referencia_externa: "Referencia / Nº de operación",
  ruc_contraparte: "RUC del cliente o proveedor",
  razon_social: "Nombre del cliente o proveedor",
  moneda: "Moneda",
  descripcion: "Descripción",
};

/**
 * Qué es cada campo, en el idioma del usuario.
 *
 * ⚠️ La distinción entre "número de documento" y "referencia" es la que más se
 * confunde y la que más cuesta: son datos distintos y el motor los usa para
 * cosas distintas (ver la nota de la migración 0020). Explicarla aquí evita que
 * el cliente mapee la columna equivocada y descubra el problema al ver un 0 %.
 */
export const AYUDA_COMPROBANTE: Partial<Record<CampoComprobante, string>> = {
  serie_numero:
    "El número de TU documento (F001-123). Identifica la factura y no se repite.",
  referencia_externa:
    "El código con el que ese cobro aparece en el banco (nº de operación, de depósito). SE REPITE cuando el cliente paga varias facturas juntas, y es con el que se empareja.",
  tipo:
    "Si la columna no existe, puedes declarar que todo el archivo es de un solo tipo.",
  moneda:
    "Solo se concilian comprobantes de la MISMA moneda que la cuenta bancaria. Si tu archivo no la trae, decláralo abajo.",
};

/** Un archivo entero de un solo tipo, cuando no hay columna que lo diga. */
export type TipoFijo = "cobranza" | "pago";

export type Config = {
  mapeo: MapeoComprobantes;
  /** Se aplica a todas las filas. Manda sobre la columna `tipo` si ambas hay. */
  tipoFijo?: TipoFijo | null;
  /**
   * Moneda para todo el archivo, cuando no hay columna que la diga.
   * Manda sobre la columna, igual que `tipoFijo`.
   */
  monedaFija?: string | null;
};

/**
 * Sinónimos de tipo que aparecen en los exports reales.
 *
 * Un libro de ventas trae "FACTURA" o "VENTA"; uno de compras, "COMPRA". Nadie
 * exporta la palabra "cobranza" salvo desde nuestra plantilla.
 */
const COBRANZA = new Set([
  "cobranza", "cobro", "venta", "ventas", "factura", "boleta", "ingreso",
  "ingresos", "abono", "recibo", "nota de credito", "01", "03",
]);
const PAGO = new Set([
  "pago", "pagos", "compra", "compras", "egreso", "egresos", "cargo",
  "gasto", "gastos", "proveedor",
]);

function limpiar(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Moneda cuando no se sabe otra cosa. Perú, soles.
 *
 * ⚠️ Que exista un valor por defecto NO significa que dé igual: un comprobante
 * en dólares cargado como soles se empareja contra depósitos que no le
 * corresponden. El defecto está para que el caso normal —una PyME peruana que
 * factura en soles— no tenga que declarar nada.
 */
export const MONEDA_DEFECTO = "PEN";

/**
 * Cómo escribe la gente la moneda en un export real.
 *
 * El símbolo "$" es ambiguo a propósito y se deja fuera: en Perú se usa tanto
 * para dólares como, mal, para soles. Adivinarlo sería elegir por el usuario
 * justo donde el error no se ve.
 */
const MONEDAS: Record<string, string> = {
  pen: "PEN", "s/": "PEN", "s/.": "PEN", soles: "PEN", sol: "PEN",
  "nuevo sol": "PEN", "nuevos soles": "PEN", pe: "PEN",
  usd: "USD", "us$": "USD", dolares: "USD", dolar: "USD",
  "dolares americanos": "USD", us: "USD",
  eur: "EUR", euros: "EUR", euro: "EUR",
};

/** Traduce el valor de la columna de moneda. `null` si no se reconoce. */
export function normalizarMoneda(v: unknown): string | null {
  const s = limpiar(v);
  if (s === "") return null;
  const conocida = MONEDAS[s];
  if (conocida) return conocida;
  // Un código ISO que no esté en la lista vale igual: la base acepta cualquier
  // trío de letras, y rechazar "CLP" por no haberlo previsto sería absurdo.
  return /^[a-z]{3}$/.test(s) ? s.toUpperCase() : null;
}

/** Traduce el valor de la columna de tipo. `null` si no se reconoce. */
export function normalizarTipo(v: unknown): TipoFijo | null {
  const s = limpiar(v);
  if (s === "") return null;
  if (COBRANZA.has(s)) return "cobranza";
  if (PAGO.has(s)) return "pago";
  return null;
}

const texto = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** Una fila ya en la forma canónica de `comprobantes`. */
export type FilaComprobante = {
  fecha: string;
  fecha_vencimiento: string | null;
  monto: number;
  tipo: TipoFijo;
  serie_numero: string | null;
  referencia_externa: string | null;
  ruc_contraparte: string | null;
  razon_social: string | null;
  moneda: string;
  descripcion: string | null;
};

/**
 * Convierte una fila cruda a la forma canónica aplicando el mapeo.
 *
 * Devuelve `null` cuando falta algo obligatorio; quien llama cuenta esas filas
 * y las informa. No se inventa un valor por defecto: un comprobante sin importe
 * o sin fecha no es un comprobante incompleto, es una fila que no lo es.
 */
export function aplicarMapeo(
  fila: Record<string, unknown>,
  config: Config,
): FilaComprobante | null {
  const col = (campo: CampoComprobante): unknown => {
    const header = config.mapeo[campo];
    return header == null ? undefined : fila[header];
  };

  const fecha = normalizarFecha(col("fecha"));
  const monto = normalizarMonto(col("monto"));
  // El tipo declarado para todo el archivo manda: si el usuario dijo que son
  // todas cobranzas, una columna con valores raros no debe convertir algunas
  // en pagos sin que se entere.
  const tipo = config.tipoFijo ?? normalizarTipo(col("tipo"));

  if (!fecha || monto == null || !tipo) return null;

  return {
    fecha,
    fecha_vencimiento: normalizarFecha(col("fecha_vencimiento")) ?? null,
    monto,
    tipo,
    serie_numero: texto(col("serie_numero")),
    referencia_externa: texto(col("referencia_externa")),
    ruc_contraparte: texto(col("ruc_contraparte")),
    razon_social: texto(col("razon_social")),
    moneda: config.monedaFija ?? normalizarMoneda(col("moneda")) ?? MONEDA_DEFECTO,
    descripcion: texto(col("descripcion")),
  };
}

/**
 * Por qué se omitiría ESTA fila, campo a campo.
 *
 * ⚠️ `aplicarMapeo` solo dice sí o no, y la vista previa mostraba «falta fecha,
 * importe o tipo» en todas las filas — incluso con la fecha y el importe ya
 * mapeados y correctos. Un mensaje que enumera lo que podría fallar manda a
 * revisar lo que está bien; el usuario mira la fecha, la ve puesta, y no
 * entiende nada.
 *
 * Devuelve lista vacía cuando la fila entra.
 */
export function motivoOmision(
  fila: Record<string, unknown>,
  config: Config,
): string[] {
  const col = (campo: CampoComprobante): unknown => {
    const header = config.mapeo[campo];
    return header == null ? undefined : fila[header];
  };

  const falta: string[] = [];
  if (!normalizarFecha(col("fecha"))) falta.push("la fecha");
  if (normalizarMonto(col("monto")) == null) falta.push("el importe");
  if (config.tipoFijo == null && normalizarTipo(col("tipo")) == null) {
    falta.push("el tipo");
  }
  return falta;
}

/**
 * El mapeo de la plantilla: cada campo en la columna que lleva su nombre.
 *
 * Es lo que se usa cuando nadie ha configurado nada, así que **el camino de
 * siempre sigue funcionando exactamente igual** aunque no exista mapeo
 * guardado.
 */
export const MAPEO_PLANTILLA: MapeoComprobantes = {
  fecha: "fecha",
  fecha_vencimiento: "fecha_vencimiento",
  monto: "monto",
  tipo: "tipo",
  serie_numero: "referencia",
  referencia_externa: "referencia_externa",
  ruc_contraparte: "ruc_contraparte",
  razon_social: "razon_social",
  moneda: "moneda",
  descripcion: "descripcion",
};

/** ¿El archivo ya viene con las columnas de la plantilla? */
export function esPlantilla(headers: string[]): boolean {
  return columnasFaltantes(headers).length === 0;
}

/**
 * Qué columnas de la plantilla le faltan al archivo.
 *
 * ⚠️ Se devuelven POR NOMBRE, no un sí/no. Cuando la plantilla es obligatoria,
 * «este archivo no sirve» deja al usuario comparando dos ficheros columna por
 * columna; «le faltan las columnas monto y tipo» se arregla en diez segundos.
 *
 * Solo se exigen las tres imprescindibles: un archivo al que le sobren o le
 * falten columnas opcionales sigue siendo la plantilla, y rechazarlo por eso
 * sería puro rigor sin motivo.
 */
export function columnasFaltantes(headers: string[]): string[] {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  return OBLIGATORIOS.map((c) => MAPEO_PLANTILLA[c]!).filter((n) => !h.has(n));
}

/** ¿Se puede importar con esta configuración? */
export function configCompleta(config: Config): boolean {
  const tieneTipo = config.tipoFijo != null || config.mapeo.tipo != null;
  return (
    config.mapeo.fecha != null && config.mapeo.monto != null && tieneTipo
  );
}

/** Qué falta, en palabras, para poder continuar. */
export function faltaEnConfig(config: Config): string[] {
  const falta: string[] = [];
  if (!config.mapeo.fecha) falta.push("la fecha");
  if (!config.mapeo.monto) falta.push("el importe");
  if (config.tipoFijo == null && !config.mapeo.tipo) {
    falta.push("el tipo (una columna, o declararlo para todo el archivo)");
  }
  return falta;
}

/**
 * El ÚNICO esquema del mapeo. Valida las tres puertas por las que entra:
 * lo que manda el navegador, lo que guarda la empresa y lo que se lee de vuelta.
 *
 * ⚠️ Una copia por sitio es lo que se separa con el tiempo, y aquí separarse
 * significaría que el navegador puede mandar una forma que el guardado rechaza
 * —o al revés—. Se valida también AL LEER porque la columna es JSONB y pudo
 * quedar de una versión anterior: un mapeo corrupto se ignora y se vuelve a
 * detectar, que es el peor caso aceptable.
 *
 * ⚠️ `.strict()` no es decorativo: este valor elige QUÉ COLUMNA se lee para
 * cada dato, así que una clave inesperada no puede colarse hasta el `insert`.
 */
export const ConfigMapeoGuardado = z.object({
  mapeo: z
    .object(
      Object.fromEntries(
        CAMPOS_COMPROBANTE.map((c) => [c, z.string().min(1).optional()]),
      ) as Record<CampoComprobante, z.ZodOptional<z.ZodString>>,
    )
    .strict(),
  tipoFijo: z.enum(["cobranza", "pago"]).nullable().optional(),
  monedaFija: z
    .string()
    .regex(/^[A-Z]{3}$/, "La moneda es un código de tres letras (PEN, USD…).")
    .nullable()
    .optional(),
});
