/**
 * Lo que el asistente general SABE PREGUNTAR.
 *
 * ── Por qué es una lista cerrada y no SQL generado ─────────────────────────
 *
 * Se evaluó el text-to-SQL y se descartó por una razón que no se arregla con un
 * modelo mejor: **las reglas de negocio de este sistema no viven en el
 * esquema**. Solo cuenta lo `aprobada`; los abonos son + y los cargos −, así
 * que un `sum(monto)` a secas no significa nada; `auto` descuenta saldo pero
 * queda FUERA de la tasa de acierto de la IA; el saldo real es
 * `importe − (aplicado − revertido)`; los reportes deduplican por período y
 * cuenta quedándose con la corrida más reciente. Una consulta generada correría,
 * devolvería un número y estaría mal — que es exactamente el modo de fallo que
 * este producto no puede permitirse.
 *
 * Además el filtro de empresa tampoco está en el esquema, sino en el criterio
 * (`admin` + `.eq("empresa_id")`, o `security definer` resolviendo `auth.uid()`
 * una vez). Ya mordió sin IA de por medio: `vaciarComprobantes` tenía un
 * `not("id","is",null)` con un comentario que decía «RLS ya acota» — cierto con
 * `anon`, falso con `admin`, y esa línea pasaba a borrar los comprobantes de
 * TODAS las empresas.
 *
 * Así que el asistente no compone consultas: **elige entre funciones que ya
 * existen, ya están probadas y ya resuelven la empresa desde la sesión**.
 *
 * ⚠️ Cuando una pregunta se repita y ninguna herramienta la responda, el camino
 * es escribir esa función con tests y añadirla aquí. Es más lento y es el único
 * en el que las cifras siguen siendo ciertas.
 */

export type DefinicionHerramienta = {
  nombre: string;
  descripcion: string;
  /** JSON Schema de los parámetros, tal como lo espera la API del modelo. */
  parametros: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
};

/**
 * Cuántas contrapartes viajan en una respuesta.
 *
 * ⚠️ El tope no es estético: es lo que impide que el prompt crezca con los
 * datos del cliente. Una recaudadora tiene miles de contrapartes y meterlas
 * todas repetiría el error de `ia_llm_01_candidatos.js` — 4,7 MB y 1,2 millones
 * de tokens. Diez es lo que cabe en una respuesta que alguien va a leer.
 */
export const TOPE_CONTRAPARTES = 10;

/** Cuántas conciliaciones recientes se listan. */
export const TOPE_CONCILIACIONES = 5;

export const HERRAMIENTAS: DefinicionHerramienta[] = [
  {
    nombre: "cuentas_por_cobrar",
    descripcion:
      "Cuánto te deben tus clientes HOY: total, cuánto está vencido, el " +
      "desglose por antigüedad y los clientes que más deben. Úsala para " +
      "preguntas como «¿cuánto me deben?», «¿quién me debe más?», «¿qué " +
      "tengo vencido?». Es una foto de hoy, no de un período.",
    parametros: {
      type: "object",
      properties: {
        busca: {
          type: "string",
          description:
            "Filtra por nombre o RUC del cliente. Vacío = todos los clientes.",
        },
        solo_vencido: {
          type: "boolean",
          description: "Solo lo que ya pasó su fecha de vencimiento.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    nombre: "cuentas_por_pagar",
    descripcion:
      "Cuánto debes tú a tus proveedores HOY, con la misma estructura que " +
      "cuentas_por_cobrar. Úsala para «¿cuánto debo?», «¿a quién le debo más?».",
    parametros: {
      type: "object",
      properties: {
        busca: {
          type: "string",
          description:
            "Filtra por nombre o RUC del proveedor. Vacío = todos.",
        },
        solo_vencido: { type: "boolean", description: "Solo lo vencido." },
      },
      additionalProperties: false,
    },
  },
  {
    nombre: "situacion_general",
    descripcion:
      "Resumen de un período: cuánto se cobró y se pagó según las " +
      "conciliaciones APROBADAS, cuántas conciliaciones hubo, cuántas están " +
      "terminadas sin aprobar, y qué quedó sin explicar en los cuadres. " +
      "Úsala para «¿cómo me fue en junio?», «¿cuánto cobré este mes?».",
    parametros: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha inicial, YYYY-MM-DD." },
        hasta: { type: "string", description: "Fecha final, YYYY-MM-DD." },
      },
      required: ["desde", "hasta"],
      additionalProperties: false,
    },
  },
  {
    nombre: "ultimas_conciliaciones",
    descripcion:
      "Las conciliaciones más recientes con su estado de proceso, su estado " +
      "contable (borrador, aprobada, anulada…) y su período. Úsala para " +
      "«¿cómo va mi última conciliación?», «¿tengo algo sin aprobar?».",
    parametros: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    nombre: "estado_de_cuenta",
    descripcion:
      "En qué plan está la empresa y, si está en prueba gratuita, cuántos " +
      "días le quedan. Úsala para «¿cuándo se acaba mi prueba?».",
    parametros: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

/** ¿Existe esa herramienta? El modelo puede inventarse un nombre. */
export function herramientaValida(nombre: string): boolean {
  return HERRAMIENTAS.some((h) => h.nombre === nombre);
}

/**
 * Lo que el asistente sabe de la app sin consultar nada.
 *
 * Va en el system prompt porque son preguntas frecuentes de un usuario que no
 * es contador («¿por qué mi conciliación salió en cero?») y responderlas no
 * necesita datos, solo saber cómo funciona esto. Es corto a propósito: cada
 * línea que se añade se paga en todas las conversaciones.
 */
export const COMO_FUNCIONA = [
  "CÓMO FUNCIONA EL SISTEMA (para responder dudas de uso):",
  "- Para conciliar: Nueva conciliación → eliges período y cuenta, subes el",
  "  extracto del banco (Excel o CSV), confirmas qué columna es cada cosa, y",
  "  antes de lanzar el sistema te dice cuánto va a casar.",
  "- Tus facturas y boletas se cargan en Comprobantes, con la plantilla que",
  "  puedes descargar ahí mismo.",
  "- La columna de REFERENCIA (número de operación / recibo) es la que más",
  "  decide el resultado: sin ella solo se puede casar por importe y fecha.",
  "  Si una conciliación sale muy baja, casi siempre es esa columna.",
  "- Una conciliación no mueve el saldo de tus comprobantes hasta que la",
  "  APRUEBAS. Hasta entonces es un borrador, aunque esté terminada.",
  "- Por cobrar y Por pagar son la foto de HOY; los Reportes son de un período.",
  "- El asistente de cada partida sin conciliar (el «¿Por qué?») explica caso",
  "  por caso por qué una factura concreta no encontró pareja.",
].join("\n");
