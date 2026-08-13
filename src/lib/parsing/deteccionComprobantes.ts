import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";
import { detectarConDetalle, type DeteccionDetallada } from "./deteccion";
import {
  CAMPOS_COMPROBANTE,
  normalizarTipo,
  normalizarMoneda,
  type CampoComprobante,
  type MapeoComprobantes,
} from "./mapeoComprobantes";

/**
 * Detección de columnas para el archivo de comprobantes del cliente.
 *
 * Comparte maquinaria con la del extracto (`detectarCon`) y cambia solo el
 * vocabulario: son dos idiomas, no dos algoritmos. Un libro de ventas peruano
 * dice "F. EMISIÓN", "RAZÓN SOCIAL" y "TOTAL"; un extracto dice "GLOSA" y
 * "OPERACIÓN".
 *
 * ⚠️ El usuario siempre puede corregirla. La detección ahorra trabajo, no
 * decide: acertar nueve columnas de diez y equivocarse en una sin que se vea
 * sería peor que no detectar nada — es exactamente cómo se llegó a la
 * conciliación al 0 %.
 */

const KEYWORDS: Record<CampoComprobante, string[]> = {
  fecha: [
    "fecha", "f. emision", "f emision", "fecha emision", "fecha de emision",
    "emision", "date", "dia",
  ],
  fecha_vencimiento: [
    "vencimiento", "f. vencimiento", "fecha vencimiento", "vence",
    "fecha de pago", "due",
  ],
  // ⚠️ `debito`/`credito`/`debe`/`haber` están aquí porque el export de un ERP
  // contable NO se llama "importe": un libro mayor trae `Débito` y `Crédito`, y
  // sin estas palabras la única candidata reconocible era `Importe Moneda Base`
  // —la columna con signo, que es justo la que no se debe usar—.
  monto: [
    "monto", "importe", "total", "amount", "valor", "precio",
    "total comprobante", "importe total", "soles", "mto",
    "debito", "credito", "debe", "haber",
  ],
  tipo: ["tipo", "tipo documento", "tipo comprobante", "clase", "type"],
  // El número del documento: identifica la factura y no se repite.
  serie_numero: [
    "serie", "numero", "nro", "n documento", "nro documento", "num documento",
    "documento", "comprobante", "serie numero", "serie-numero", "correlativo",
    "factura",
  ],
  // Con qué casarlo en el banco: SE REPITE a propósito (ver migración 0020).
  //
  // ⚠️ Las formas de "id de pago" van AQUÍ y no en `serie_numero`, aunque en
  // algunos sistemas sean lo mismo. Un archivo real de cobros escolares traía
  // «ID DE PAGO» junto a «ID DE ESTUDIANTE» y ninguna se detectaba: la primera
  // es la operación con la que el banco identifica el cobro —la que decide el
  // resultado de la conciliación— y la segunda no es un documento.
  //
  // "id" a secas NO entra: casaría igual con «ID DE ESTUDIANTE» y la asignación
  // greedy elegiría una de las dos por azar. Las formas compuestas son
  // específicas y no colisionan.
  referencia_externa: [
    "referencia", "ref", "operacion", "nro operacion", "n operacion",
    "codigo operacion", "recibo", "recibos", "deposito", "voucher",
    "id de pago", "id pago", "idpago", "codigo de pago", "cod pago",
    "nro de pago", "numero de pago", "n de pago", "payment id",
  ],
  ruc_contraparte: ["ruc", "documento identidad", "dni", "nro documento cliente"],
  razon_social: [
    "razon social", "razon", "cliente", "proveedor", "nombre", "contraparte",
    "beneficiario", "denominacion",
  ],
  moneda: ["moneda", "currency", "divisa", "mon", "tipo moneda"],
  descripcion: [
    "descripcion", "detalle", "concepto", "glosa", "observacion",
    "observaciones", "nota",
  ],
};

function fraccion<T>(items: T[], pred: (x: T) => boolean): number {
  if (items.length === 0) return 0;
  return items.filter(pred).length / items.length;
}

/**
 * Fracción mínima de valores RECONOCIBLES para que una columna se proponga.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * El nombre del encabezado pesa mucho, y con razón: casi siempre acierta. Pero
 * con un libro mayor real la columna `Tipo de Transacción` ganaba el campo
 * `tipo` solo por llamarse así, y sus valores son *Asiento* y *Pago*: ni uno
 * solo significa "cobranza". El resultado habría sido cargar 452.461 cobranzas
 * **como pagos** —el dinero entero del lado contrario— y descartar el resto por
 * "sin tipo". Nada de eso falla en pantalla: la importación dice "452.461
 * comprobantes agregados" y se ve perfecta.
 *
 * Así que el contenido puede VETAR al nombre. No al revés: si la columna está
 * vacía en la muestra no se veta nada, porque ausencia de evidencia no es
 * evidencia de contradicción.
 *
 * ── Por qué dos umbrales ───────────────────────────────────────────────────
 *
 * `fecha`, `monto` y `tipo` son mortales de necesidad: sin cualquiera de los
 * tres la fila **entera** se descarta, así que una columna que no clasifique el
 * 90 % está tirando datos en silencio. `moneda` va con ellas porque un valor no
 * reconocido cae a PEN sin decir nada. El resto se ve en la vista previa y
 * admite más ruido.
 */
const MINIMO_RECONOCIDO: Partial<Record<CampoComprobante, number>> = {
  fecha: 0.9,
  monto: 0.9,
  tipo: 0.9,
  moneda: 0.9,
  fecha_vencimiento: 0.5,
  ruc_contraparte: 0.5,
};

/** Veto: la columna contradice al campo, no se propone ni llamándose igual. */
const VETO = Number.NEGATIVE_INFINITY;

function conVeto(campo: CampoComprobante, valida: number, peso: number): number {
  const minimo = MINIMO_RECONOCIDO[campo];
  if (minimo != null && valida < minimo) return VETO;
  return valida * peso;
}

/**
 * Puntaje por lo que hay DENTRO de la columna.
 *
 * Vale más que el nombre en los casos ambiguos: un export puede llamar "DOC" a
 * la columna de fechas, y el contenido no engaña.
 */
function puntajeContenido(campo: CampoComprobante, valores: unknown[]): number {
  const noVacios = valores.filter((v) => v != null && String(v).trim() !== "");
  if (noVacios.length === 0) return 0;

  switch (campo) {
    case "fecha":
    case "fecha_vencimiento":
      return conVeto(
        campo,
        fraccion(noVacios, (v) => normalizarFecha(v) != null),
        2.5,
      );
    case "monto": {
      // Numérico pero NO fecha: un serial o una fecha en número se leen como
      // importe y arruinarían el mapeo sin que nada lo delate.
      const montos = noVacios
        .map((v) => (normalizarFecha(v) == null ? normalizarMonto(v) : null))
        .filter((n): n is number => n != null);
      const valida = montos.length / noVacios.length;

      // ⚠️ COBERTURA: `Débito` está lleno en el 99,97 % de un libro de
      // recaudación y `Crédito` en el 0,03 %, pero los dos son numéricos al
      // 100 % de sus filas. Sin este factor la heurística no las distingue, y
      // elegir `Crédito` deja el archivo casi entero sin importe — o sea,
      // descartado por "datos incompletos".
      const cobertura = noVacios.length / valores.length;

      // ⚠️ SIGNOS MEZCLADOS: una columna con positivos y negativos no es el
      // importe de un comprobante, es el movimiento firmado de un mayor. En
      // este sistema el signo lo pone el TIPO (cobranza + / pago −), y un monto
      // negativo produce un saldo negativo que la base rechaza: la carga entera
      // falla. Se penaliza en vez de vetar porque una nota de crédito puede
      // venir en negativo legítimamente.
      const mezcla =
        montos.some((n) => n > 0) && montos.some((n) => n < 0) ? 0.5 : 1;

      const base = conVeto(campo, valida, 2);
      return base === VETO ? VETO : base * cobertura * mezcla;
    }
    case "tipo":
      return conVeto(
        campo,
        fraccion(noVacios, (v) => normalizarTipo(v) != null),
        2.5,
      );
    case "moneda":
      return conVeto(
        campo,
        fraccion(noVacios, (v) => normalizarMoneda(v) != null),
        2.5,
      );
    case "ruc_contraparte":
      // RUC peruano: 11 dígitos empezando por 10, 15, 17 o 20.
      return conVeto(
        campo,
        fraccion(noVacios, (v) => /^(10|15|17|20)\d{9}$/.test(String(v).trim())),
        2.5,
      );
    case "serie_numero": {
      // ⚠️ UNICIDAD. `serie_numero` es la IDENTIDAD del documento: lleva índice
      // único y es lo que impide cargar dos veces la misma factura. Entre dos
      // columnas que se llaman parecido, la que repite valores es peor
      // candidata — y en un mayor real esa diferencia es la que decide todo:
      // `Nro. Documento` es el asiento (se repite en cada línea del mismo
      // asiento) y `WIN - Nro. Documento` es el recibo, que es lo que el banco
      // conoce. Elegir el primero da una conciliación al 0 %.
      //
      // Sin veto: un archivo puede traer legítimamente números repetidos (la
      // 0018 lo contempla y el índice es parcial). Solo inclina la balanza.
      const distintos = new Set(noVacios.map((v) => String(v).trim())).size;
      return (distintos / noVacios.length) * 1.5;
    }
    default:
      return 0;
  }
}

export function detectarColumnasComprobante(
  headers: string[],
  muestras: Record<string, unknown>[],
): MapeoComprobantes {
  return detectarComprobantesConDudas(headers, muestras).mapeo;
}

/**
 * La detección y, además, **con qué dudó**.
 *
 * ⚠️ Las alternativas no son un adorno de la interfaz: son el único aviso de
 * que la heurística eligió entre varias candidatas parecidas. En un mayor
 * contable hay tres columnas que podrían ser el importe y tres que podrían ser
 * el número de documento, y la que decide el resultado de la conciliación es
 * una sola. Elegir mal no da un error — da un 0 % media hora después.
 */
export function detectarComprobantesConDudas(
  headers: string[],
  muestras: Record<string, unknown>[],
): DeteccionDetallada<CampoComprobante> {
  return detectarConDetalle(
    CAMPOS_COMPROBANTE,
    KEYWORDS,
    puntajeContenido,
    headers,
    muestras,
  );
}
