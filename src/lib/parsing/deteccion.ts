import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";

/**
 * Detección automática de columnas por heurística (nombre de encabezado +
 * contenido de las primeras filas). Devuelve, para cada campo canónico, el
 * encabezado que mejor lo representa. La interfaz queda preparada para mejorar
 * esta detección con IA más adelante; el usuario siempre puede corregirla en el
 * Paso 2.
 */

export type CampoCanonico =
  | "fecha"
  | "monto"
  | "tipo"
  | "referencia"
  | "contraparte"
  | "descripcion";

export type MapeoColumnas = Partial<Record<CampoCanonico, string>>;

export const CAMPOS: CampoCanonico[] = [
  "fecha",
  "monto",
  "tipo",
  "referencia",
  "contraparte",
  "descripcion",
];

export const ETIQUETA_CAMPO: Record<CampoCanonico, string> = {
  fecha: "Fecha",
  monto: "Monto",
  tipo: "Tipo",
  referencia: "Referencia / Nº operación",
  contraparte: "Contraparte",
  descripcion: "Descripción / Glosa",
};

function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * ── Vocabulario del EXTRACTO, por fuerza de la señal ────────────────────────
 *
 * Una palabra puede nombrar un campo sin ambigüedad («referencia») o solo
 * sugerirlo («nro», «documento»). Antes eso no se distinguía: el peso salía de
 * si el encabezado *coincidía entero* con la palabra (3) o solo la *contenía*
 * (2), que mide una casualidad tipográfica en vez del significado.
 *
 * ⚠️⚠️ El caso que lo destapó. Un extracto trae DOS columnas candidatas:
 *
 *     Nro Operacion   OP-500001 …   ← el código interno del banco
 *     Nro Referencia  REF-1001  …   ← lo que casa con los comprobantes
 *
 * `nro operacion` estaba en la lista y coincidía ENTERA con su encabezado (3),
 * mientras que `Nro Referencia` solo contenía `referencia` (2). Ganaba la
 * columna equivocada, y encima el desempate por unicidad la reforzaba: los
 * códigos del banco no se repiten nunca y las referencias sí (un cliente paga
 * dos recibos con la misma). Resultado medido con datos reales: la capa exacta
 * comparó `REF-1002` contra `OP-500002`, el pass 2 por monto+fecha lo bloqueó
 * la guarda de contradicción de referencias —haciendo bien su trabajo— y la
 * conciliación terminó en **0 pares de 25 partidas**, con los dos archivos
 * perfectamente emparejables.
 *
 * Ahora el peso lo da la PALABRA, no la forma del encabezado.
 */
const FUERTE = 4;
const MEDIO = 2.5;
const DEBIL = 1;

/**
 * La palabra nombra el campo y no se la disputa nadie. Si aparece, es esa
 * columna.
 */
const FUERTES: Record<CampoCanonico, string[]> = {
  fecha: ["fecha", "fec", "date", "f emision", "f. emision", "f operacion"],
  monto: ["monto", "importe", "amount"],
  tipo: ["tipo", "type", "clase", "naturaleza"],
  // ⚠️ `referencia`, `ref` y `recibo` mandan sobre CUALQUIER forma de
  // «operación»: es la columna que el banco comparte con el cliente, y es la
  // única con la que la capa exacta puede emparejar.
  referencia: ["referencia", "ref", "recibo", "recibos", "voucher", "constancia"],
  contraparte: ["contraparte", "razon social", "beneficiario", "ruc"],
  descripcion: [
    "descripcion",
    "glosa",
    "detalle",
    "concepto",
    "observacion",
    "observaciones",
  ],
};

/**
 * Nombre habitual del campo, pero compartido con otros. Gana a no mapear nada
 * y pierde contra una palabra fuerte.
 */
const MEDIOS: Record<CampoCanonico, string[]> = {
  fecha: ["dia", "periodo", "valuta", "proceso"],
  monto: [
    "cargo",
    "abono",
    "abonado",
    "debe",
    "haber",
    "debito",
    "credito",
    "deposito",
    "depositado",
    "pagado",
    "total",
    "valor",
    "neto",
    "soles",
    "dolares",
  ],
  tipo: ["movimiento"],
  referencia: [
    "nro operacion",
    "n operacion",
    "num operacion",
    "numero operacion",
    "cod operacion",
    "codigo operacion",
    "operacion",
    "codigo",
    "cod",
    "correlativo",
    "transaccion",
    "numero",
    "num",
    "nro",
    "serie",
    "documento",
    "comprobante",
    "id",
  ],
  contraparte: [
    "cliente",
    "proveedor",
    "razon",
    "nombre",
    "titular",
    "ordenante",
    "girador",
  ],
  descripcion: ["motivo", "asunto", "leyenda", "referencia adicional"],
};

/**
 * Señales DÉBILES: valen si nadie mejor las reclama.
 *
 * ⚠️ `operacion` vivía aquí para que no compitiera con «nro operación». El
 * remedio salió peor que la enfermedad: seguía en las palabras de `tipo`, así
 * que un extracto con una columna llamada «Operación» —lo más normal del mundo
 * en un banco peruano— se la asignaba a *tipo*, donde sus valores no significan
 * nada, y dejaba **referencia sin mapear**. Hoy `operacion` es MEDIA para
 * `referencia` y DÉBIL para `tipo`, que es lo que de verdad se quería decir:
 * no «no vale», sino «vale menos».
 */
const DEBILES: Partial<Record<CampoCanonico, string[]>> = {
  tipo: ["operacion"],
};

/**
 * Palabras cortas que solo cuentan como TOKEN COMPLETO.
 *
 * `id` dentro de «Ciudad», «Salida» o «Unidad» no significa nada, y con
 * coincidencia por subcadena esas columnas puntuaban como referencia. La
 * flexibilidad de reconocer más nombres solo sirve si no arrastra falsos: se
 * gana amplitud con la separación en palabras, no bajando el listón.
 */
const LONGITUD_TOKEN_EXACTO = 3;

/**
 * Normalización FLEXIBLE del encabezado: sin acentos, sin puntuación y con las
 * palabras separadas.
 *
 * Es lo que hace que `Nro. Referencia`, `REFERENCIA_BANCO`, `N° Operación` y
 * `Referencia/Operación` se reconozcan igual. Antes solo se bajaba a
 * minúsculas, así que un punto o un guion bajo en medio bastaba para que una
 * palabra clave de dos términos no coincidiera.
 */
function palabrasDeHeader(header: string): { texto: string; tokens: string[] } {
  const texto = normalizarTexto(header)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { texto, tokens: texto.split(" ").filter(Boolean) };
}

/** ¿El encabezado contiene esta palabra clave? */
function contiene(
  kw: string,
  texto: string,
  tokens: string[],
): boolean {
  const k = kw
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!k) return false;
  // Palabra corta: solo como token completo (ver LONGITUD_TOKEN_EXACTO).
  if (!k.includes(" ") && k.length <= LONGITUD_TOKEN_EXACTO) {
    return tokens.includes(k);
  }
  return texto.includes(k);
}

/**
 * Puntaje por NOMBRE del encabezado para el extracto: se queda con el peso del
 * nivel más alto que coincida.
 */
function puntajeNombreExtracto(campo: CampoCanonico, header: string): number {
  const { texto, tokens } = palabrasDeHeader(header);
  if (!texto) return 0;
  const hay = (lista: string[] | undefined) =>
    (lista ?? []).some((kw) => contiene(kw, texto, tokens));
  if (hay(FUERTES[campo])) return FUERTE;
  if (hay(MEDIOS[campo])) return MEDIO;
  if (hay(DEBILES[campo])) return DEBIL;
  return 0;
}

const VALORES_TIPO = new Set([
  "cobranza",
  "pago",
  "abono",
  "cargo",
  "deposito",
  "retiro",
  "ingreso",
  "egreso",
]);

function fraccion<T>(items: T[], pred: (x: T) => boolean): number {
  if (items.length === 0) return 0;
  return items.filter(pred).length / items.length;
}

function puntajeConLista(lista: string[], header: string): number {
  const h = normalizarTexto(header);
  if (!h) return 0;
  let mejor = 0;
  for (const kw of lista) {
    if (h === kw) mejor = Math.max(mejor, 3);
    else if (h.includes(kw)) mejor = Math.max(mejor, 2);
  }
  return mejor;
}

/**
 * Fracción mínima de valores reconocibles para PROPONER una columna, por campo.
 *
 * ⚠️ El contenido VETA al nombre. Un extracto del BCP trae una columna
 * «Operación» con códigos numéricos: por nombre encajaba en `tipo`, y ninguno de
 * sus valores significa nada como tipo de movimiento. El resultado era el peor
 * posible — `tipo` mal puesto y `referencia` sin mapear, que es la columna de la
 * que depende TODO el emparejamiento.
 *
 * Sin evidencia no se veta: una columna vacía en la muestra no contradice nada
 * (y para eso ya está el filtro de columnas vacías).
 */
const MINIMO_RECONOCIDO: Partial<Record<CampoCanonico, number>> = {
  fecha: 0.9,
  monto: 0.9,
  tipo: 0.9,
};

const VETO = Number.NEGATIVE_INFINITY;

function conVeto(campo: CampoCanonico, valida: number, peso: number): number {
  const minimo = MINIMO_RECONOCIDO[campo];
  if (minimo != null && valida < minimo) return VETO;
  return valida * peso;
}

function puntajeContenido(
  campo: CampoCanonico,
  valores: unknown[],
): number {
  const noVacios = valores.filter((v) => v != null && String(v).trim() !== "");
  if (noVacios.length === 0) return 0;

  switch (campo) {
    case "fecha":
      return conVeto(campo, fraccion(noVacios, (v) => normalizarFecha(v) != null), 2.5);
    case "monto": {
      // Numérico pero NO fecha (evita confundir seriales/fechas con montos).
      const numerico = fraccion(
        noVacios,
        (v) => normalizarMonto(v) != null && normalizarFecha(v) == null,
      );
      return conVeto(campo, numerico, 2);
    }
    case "tipo":
      return conVeto(
        campo,
        fraccion(noVacios, (v) => VALORES_TIPO.has(normalizarTexto(String(v)))),
        2.5,
      );
    case "referencia": {
      // ⚠️ Una referencia IDENTIFICA: cuanto menos se repite, mejor candidata.
      // Es lo que permite que «Operación» —señal débil por nombre— gane a una
      // columna que se llame parecido pero repita valores. Y nunca es un número
      // con decimales: eso es un importe.
      const codigos = noVacios.filter((v) => !/^-?\d+[.,]\d{1,2}$/.test(String(v).trim()));
      if (codigos.length === 0) return VETO;
      const distintos = new Set(codigos.map((v) => String(v).trim())).size;
      return (distintos / codigos.length) * 1.5;
    }
    default:
      return 0;
  }
}

/**
 * Núcleo de la detección, reutilizable con cualquier juego de campos.
 *
 * El extracto y los comprobantes se detectan con la MISMA maquinaria y
 * distintas listas de palabras: son dos vocabularios, no dos algoritmos. Antes
 * esto estaba pegado a los campos del extracto, y al mapear comprobantes habría
 * salido un segundo detector que se separa del primero con el tiempo.
 */
/**
 * Cómo se puntúa un encabezado por su nombre, para un campo dado.
 *
 * Existe para que el extracto pueda pesar por SIGNIFICADO (ver `FUERTES` /
 * `MEDIOS` / `DEBILES`) sin cambiarle el criterio a la detección de
 * comprobantes, que comparte esta misma maquinaria.
 */
export type PuntajeNombre<C extends string> = (campo: C, header: string) => number;

export function detectarCon<C extends string>(
  campos: readonly C[],
  keywords: Record<C, string[]>,
  contenido: (campo: C, valores: unknown[]) => number,
  headers: string[],
  muestras: Record<string, unknown>[],
  debiles?: Partial<Record<C, string[]>>,
  porNombre?: PuntajeNombre<C>,
): Partial<Record<C, string>> {
  return detectarConDetalle(
    campos,
    keywords,
    contenido,
    headers,
    muestras,
    debiles,
    porNombre,
  ).mapeo;
}

/**
 * Cuánto tiene que acercarse otro encabezado al elegido para que se considere
 * un empate y se avise.
 *
 * ⚠️ El aviso no es cosmético. Un mayor contable trae TRES columnas que podrían
 * ser el importe (`Importe Moneda Base`, `Débito`, `Crédito`) y tres que podrían
 * ser el número de documento. La heurística elige una en silencio, y elegir mal
 * no da un error: da una conciliación al 0 % media hora después, o el dinero del
 * lado contrario. Cuando hay duda real, lo honesto es decirlo y que mire la
 * vista previa.
 */
const UMBRAL_EMPATE = 0.6;

/** Cuántas alternativas se nombran. Más de dos es ruido, no ayuda. */
const MAX_ALTERNATIVAS = 2;

export type DeteccionDetallada<C extends string> = {
  mapeo: Partial<Record<C, string>>;
  /** Otros encabezados que casi empataron con el elegido, por campo. */
  alternativas: Partial<Record<C, string[]>>;
};

/**
 * La detección, además de qué eligió, con qué dudó.
 *
 * `detectarCon` es esta misma función tirando las alternativas: el extracto no
 * las usa (su Paso 2 ya enseña la vista previa columna a columna) y no hacía
 * falta tocarlo.
 */
export function detectarConDetalle<C extends string>(
  campos: readonly C[],
  keywords: Record<C, string[]>,
  contenido: (campo: C, valores: unknown[]) => number,
  headers: string[],
  muestras: Record<string, unknown>[],
  /** Palabras que valen si nadie mejor las reclama. Ver `DEBILES`. */
  debiles?: Partial<Record<C, string[]>>,
  /**
   * Puntaje por nombre a medida. Sin esto se usa el de siempre —coincidencia
   * exacta 3, parcial 2, débil 1—, que es lo que sigue usando la detección de
   * comprobantes: su vocabulario está calibrado contra un mayor contable real y
   * no tiene por qué moverse porque el extracto necesite otra cosa.
   */
  porNombre?: PuntajeNombre<C>,
): DeteccionDetallada<C> {
  type Celda = { campo: C; header: string; score: number };
  const celdas: Celda[] = [];

  // ⚠️ Una columna VACÍA en toda la muestra no se propone para nada, aunque se
  // llame igual que el campo. Un mayor contable trae `Documento Relacionado`
  // sin un solo valor, y ganaba por nombre a la columna que sí lleva el número:
  // mapear una columna vacía es mapear a la nada, y el usuario descubre que no
  // se cargó ninguna fila. Elegirla a mano sigue siendo posible.
  const conDatos = headers.filter((h) =>
    muestras.some((f) => f[h] != null && String(f[h]).trim() !== ""),
  );
  // Si la muestra viene vacía entera (archivo sin filas previas), se detecta
  // solo por nombre, como antes: no hay evidencia que contradiga nada.
  const candidatos = conDatos.length > 0 ? conDatos : headers;

  for (const campo of campos) {
    for (const header of candidatos) {
      const valores = muestras.map((f) => f[header]);
      // Una señal débil vale 1: pierde contra cualquier palabra específica
      // (que valen 2 o 3) pero gana a no mapear nada.
      const nombre = porNombre
        ? porNombre(campo, header)
        : Math.max(
            puntajeConLista(keywords[campo], header),
            puntajeConLista(debiles?.[campo] ?? [], header) > 0 ? 1 : 0,
          );
      const score = nombre + contenido(campo, valores);
      // Un score no positivo incluye el VETO por contenido (`-Infinity`): una
      // columna cuyos valores contradicen al campo no se propone ni aunque se
      // llame como él.
      if (score > 0) celdas.push({ campo, header, score });
    }
  }

  // Asignación greedy por puntaje descendente, sin reutilizar header ni campo.
  celdas.sort((a, b) => b.score - a.score);
  const mapeo: Partial<Record<C, string>> = {};
  const elegido: Partial<Record<C, number>> = {};
  const headersUsados = new Set<string>();

  for (const c of celdas) {
    if (mapeo[c.campo] != null) continue;
    if (headersUsados.has(c.header)) continue;
    mapeo[c.campo] = c.header;
    elegido[c.campo] = c.score;
    headersUsados.add(c.header);
  }

  const alternativas: Partial<Record<C, string[]>> = {};
  for (const campo of campos) {
    const ganador = mapeo[campo];
    const suScore = elegido[campo];
    if (ganador == null || suScore == null) continue;
    const cerca = celdas
      .filter(
        (c) =>
          c.campo === campo &&
          c.header !== ganador &&
          c.score >= suScore * UMBRAL_EMPATE,
      )
      .slice(0, MAX_ALTERNATIVAS)
      .map((c) => c.header);
    if (cerca.length > 0) alternativas[campo] = cerca;
  }

  return { mapeo, alternativas };
}

/**
 * Los campos que un extracto bancario SÍ usa.
 *
 * ⚠️⚠️ Que `contraparte` no esté no es un detalle de pantalla: la asignación es
 * greedy y **consume el encabezado**, así que un campo que el extracto no
 * emplea puede quitarle su columna a uno que sí. Pasó con datos reales: la
 * columna «Concepto / Cliente» se la llevaba `contraparte` —que
 * `MovimientoBancario` ni siquiera tiene— y `descripcion` se quedaba sin
 * mapear. Como `normalizarMovimiento` construye la `glosa` SOLO desde
 * `mapeo.descripcion`, los movimientos llegaban al motor sin glosa, y la capa
 * difusa —que exige una palabra en común entre la contraparte del comprobante y
 * la glosa del banco— no podía emparejar nada. En pantalla se veía como filas
 * «BCO-0001» sin nombre, que no parece un error de mapeo.
 *
 * Esta lista es la MISMA que pinta el Paso 2 (`MapeoDataset`), y por eso vive
 * aquí: con dos copias, la pantalla ofrecería un campo que la detección no
 * reserva, o al revés.
 */
export const CAMPOS_EXTRACTO: CampoCanonico[] = [
  "fecha",
  "monto",
  "tipo",
  "referencia",
  "descripcion",
];

/**
 * Detección para el extracto bancario, con las alternativas que casi empataron.
 *
 * ⚠️ El aviso no es cosmético. Un extracto puede traer dos columnas que se
 * parecen —«Nro Operacion» y «Nro Referencia»— y elegir mal no da un error: da
 * una conciliación al 0 % un rato después. Cuando hay duda real, lo honesto es
 * nombrar la otra candidata y que el usuario la contraste con la vista previa.
 */
export function detectarColumnasConDudas(
  headers: string[],
  muestras: Record<string, unknown>[],
): DeteccionDetallada<CampoCanonico> {
  return detectarConDetalle(
    CAMPOS_EXTRACTO,
    // ⚠️ Las listas por niveles las lee `puntajeNombreExtracto`, el último
    // argumento. Éste queda porque lo exige la firma que comparte con la
    // detección de comprobantes, y no se consulta: quien pasa un puntaje propio
    // decide él solo cómo pesa cada nombre.
    FUERTES,
    puntajeContenido,
    headers,
    muestras,
    DEBILES,
    puntajeNombreExtracto,
  );
}

export function detectarColumnas(
  headers: string[],
  muestras: Record<string, unknown>[],
): MapeoColumnas {
  return detectarColumnasConDudas(headers, muestras).mapeo;
}
