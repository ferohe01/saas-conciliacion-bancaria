import type { CampoComprobante, Config } from "./mapeoComprobantes";

/**
 * Formatos de export que la app reconoce sin preguntar nada.
 *
 * El formulario «¿qué columna es cada cosa?» existe para el archivo que no se
 * conoce. Pero un cliente que exporta SIEMPRE el mismo informe de su ERP no
 * tiene nada que decidir: preguntarle diez campos cada vez es trabajo sin
 * motivo, y cada pregunta es una ocasión de elegir mal la columna —que no da
 * un error, da una conciliación al 0 %—.
 *
 * Un formato conocido fija de antemano qué columna es cada campo, así que:
 *
 * - **Las columnas de más se ignoran**: el mapeo solo nombra las suyas.
 * - **Solo se avisa de lo que hace falta para conciliar.** Si al export le
 *   falta la descripción, se carga igual; si le falta el importe, se dice cuál
 *   y para qué sirve, en vez de abrir un formulario que no lo explicaría.
 *
 * ⚠️ Se reconoce por la MAYORÍA de sus columnas, no por todas: el caso que hay
 * que poder explicar es justamente el export al que le falta una. Exigirlas
 * todas haría que ese archivo cayera al formulario genérico, que es lo que
 * este módulo viene a quitar.
 */

export type ColumnaNecesaria = {
  columna: string;
  /** Para qué hace falta, en palabras del usuario. */
  para: string;
};

export type FormatoConocido = {
  id: string;
  nombre: string;
  /** La estructura base del export, tal como la escribe el sistema. */
  columnas: string[];
  /** Sin estas no se puede conciliar: si faltan, no se importa y se dice. */
  necesarias: ColumnaNecesaria[];
  /** Qué columna base es cada campo. Las ausentes opcionales se omiten. */
  mapeo: Partial<Record<CampoComprobante, string>>;
  tipoFijo: Config["tipoFijo"];
  /**
   * Columna con el saldo ACUMULADO de la cuenta, si el export la trae. El de
   * la línea más reciente es el saldo según libros (ver `saldoMasReciente`).
   */
  saldo?: string;
};

/**
 * Libro mayor de la cuenta recaudadora de WIN, exportado de su ERP.
 *
 * - **`Débito` es el importe**: en el mayor de una cuenta de banco el débito es
 *   lo que entra. Las líneas de crédito (salidas) traen `Débito` vacío y se
 *   omiten solas, igual que con el mapeo manual.
 * - **Todo son cobranzas**, por lo mismo: lo que entra a la cuenta recaudadora
 *   es lo que cobraron. `Tipo de Transacción` (Pago / Asiento) no dice eso.
 * - **`WIN - Nro. Documento` es el recibo**, lo que el banco conoce.
 *   `Nro. Documento` es el asiento y se repite en cada línea.
 * - **Sin referencia aparte**: el recibo hace de referencia, que es como se
 *   verificaron los 447.795 pares de junio.
 *
 * Es el mismo resultado que la detección propone para este archivo (6 de 6,
 * ver CLAUDE.md), fijado para no tener que volver a confirmarlo.
 */
const WIN_LIBRO_MAYOR: FormatoConocido = {
  id: "win_libro_mayor",
  nombre: "Libro mayor de WIN",
  columnas: [
    "Cuenta",
    "Tipo de Transacción",
    "Periodo Contable",
    "Fecha",
    "ID de transacción",
    "Nro. Documento",
    "Documento Relacionado",
    "WIN - Nro. Documento",
    "Entidad",
    "Entidad - Asientos",
    "Nota - Cabecera",
    "Nota - Línea",
    "Tipo de Cambio",
    "Moneda",
    "Importe Moneda Base",
    "Débito",
    "Crédito",
    "Saldo",
  ],
  necesarias: [
    { columna: "Fecha", para: "la fecha del cobro" },
    { columna: "Débito", para: "el importe cobrado" },
    {
      columna: "WIN - Nro. Documento",
      para: "el número de recibo, con el que se empareja con el banco",
    },
  ],
  mapeo: {
    fecha: "Fecha",
    monto: "Débito",
    serie_numero: "WIN - Nro. Documento",
    moneda: "Moneda",
    descripcion: "Nota - Cabecera",
  },
  tipoFijo: "cobranza",
  saldo: "Saldo",
};

export const FORMATOS_CONOCIDOS: FormatoConocido[] = [WIN_LIBRO_MAYOR];

/** Proporción de columnas base que tiene que traer un archivo para reconocerlo. */
const UMBRAL_RECONOCIMIENTO = 0.6;

/** Mayúsculas, acentos y espacios no distinguen una columna de otra. */
function clave(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type Reconocimiento = {
  formato: FormatoConocido;
  /** Columnas necesarias que no están. Vacío = se puede importar. */
  faltan: ColumnaNecesaria[];
  /** La config lista para importar, con las cabeceras TAL COMO vienen. */
  config: Config;
  /** Cabecera real de la columna de saldo acumulado, o null si no viene. */
  columnaSaldo: string | null;
};

/** Un saldo acumulado y la fecha de la línea de la que sale. */
export type SaldoEnFecha = { saldo: number; fecha: string };

/**
 * Se queda con el saldo de la línea más reciente POR FECHA.
 *
 * ⚠️ No con la última línea del archivo: el mayor de WIN empieza con líneas del
 * 26/05 (asientos del mes anterior) y nada garantiza que el export venga
 * ordenado. Dentro del mismo día gana la que aparece DESPUÉS, porque el saldo
 * es acumulado: la última línea del día ya incluye a las anteriores.
 */
export function saldoMasReciente(
  previo: SaldoEnFecha | null,
  candidato: SaldoEnFecha,
): SaldoEnFecha {
  return previo === null || candidato.fecha >= previo.fecha ? candidato : previo;
}

/**
 * ¿Es este archivo un formato conocido? `null` si no se parece a ninguno, y
 * entonces sigue el camino de siempre (formato guardado o formulario).
 */
export function reconocerFormato(headers: string[]): Reconocimiento | null {
  // Cabecera normalizada → cabecera real. `aplicarMapeo` lee la fila por el
  // nombre exacto, así que el mapeo tiene que llevar la del archivo.
  const reales = new Map<string, string>();
  for (const h of headers) {
    const k = clave(h);
    if (k && !reales.has(k)) reales.set(k, h);
  }

  for (const formato of FORMATOS_CONOCIDOS) {
    const presentes = formato.columnas.filter((c) => reales.has(clave(c)));
    if (presentes.length / formato.columnas.length < UMBRAL_RECONOCIMIENTO) {
      continue;
    }

    const faltan = formato.necesarias.filter((n) => !reales.has(clave(n.columna)));

    const mapeo: Config["mapeo"] = {};
    for (const [campo, columna] of Object.entries(formato.mapeo) as [
      CampoComprobante,
      string,
    ][]) {
      // Una opcional ausente simplemente no se mapea: sin moneda se carga en
      // soles, sin descripción no pasa nada.
      const real = reales.get(clave(columna));
      if (real) mapeo[campo] = real;
    }

    return {
      formato,
      faltan,
      config: { mapeo, tipoFijo: formato.tipoFijo, monedaFija: null },
      columnaSaldo: formato.saldo ? (reales.get(clave(formato.saldo)) ?? null) : null,
    };
  }
  return null;
}
