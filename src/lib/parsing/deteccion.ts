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

// Palabras clave por campo (ya sin acentos).
const KEYWORDS: Record<CampoCanonico, string[]> = {
  fecha: ["fecha", "date", "dia", "f. emision", "f emision", "periodo"],
  monto: [
    "monto",
    "importe",
    "total",
    "amount",
    "valor",
    "cargo",
    "abono",
    "debe",
    "haber",
    "soles",
    "dolares",
  ],
  tipo: ["tipo", "type", "operacion", "movimiento", "clase"],
  referencia: [
    "referencia",
    "ref",
    "nro operacion",
    "n operacion",
    "numero",
    "nro",
    "serie",
    "documento",
    "comprobante",
    "id",
    // Una recaudadora llama "recibo" a lo que el banco trae como referencia, y
    // es LA columna por la que se concilia: sin detectarla, el usuario tiene
    // que acertar a mano cuál es, y si no lo hace la conciliación da 0%.
    "recibo",
    "recibos",
    // ⚠️ "operacion" a secas va en DEBILES, no aquí: ver la nota de esa lista.
  ],
  contraparte: [
    "contraparte",
    "cliente",
    "proveedor",
    "razon social",
    "razon",
    "nombre",
    "beneficiario",
    "ruc",
  ],
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
 * Señales DÉBILES: valen si nadie mejor las reclama, y pierden contra una
 * palabra específica.
 *
 * ⚠️ `operacion` estaba EXCLUIDA de `referencia` para que no compitiera con la
 * columna buena («nro operación», «recibos»). El remedio salió peor que la
 * enfermedad: `operacion` seguía en las palabras de `tipo`, así que un extracto
 * con una columna llamada «Operación» —lo más normal del mundo en un banco
 * peruano— se la asignaba a *tipo*, donde sus valores no significan nada, y
 * dejaba **referencia sin mapear**: justo la columna de la que depende todo el
 * emparejamiento.
 *
 * Lo que se quería decir no era «esta palabra no vale», sino «vale menos». Eso
 * es un peso, no una exclusión.
 */
const DEBILES: Partial<Record<CampoCanonico, string[]>> = {
  referencia: ["operacion", "operación", "codigo", "numero operacion"],
};

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
export function detectarCon<C extends string>(
  campos: readonly C[],
  keywords: Record<C, string[]>,
  contenido: (campo: C, valores: unknown[]) => number,
  headers: string[],
  muestras: Record<string, unknown>[],
  debiles?: Partial<Record<C, string[]>>,
): Partial<Record<C, string>> {
  return detectarConDetalle(campos, keywords, contenido, headers, muestras, debiles).mapeo;
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
      const porNombre = Math.max(
        puntajeConLista(keywords[campo], header),
        puntajeConLista(debiles?.[campo] ?? [], header) > 0 ? 1 : 0,
      );
      const score = porNombre + contenido(campo, valores);
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

export function detectarColumnas(
  headers: string[],
  muestras: Record<string, unknown>[],
): MapeoColumnas {
  return detectarCon(CAMPOS, KEYWORDS, puntajeContenido, headers, muestras, DEBILES);
}
