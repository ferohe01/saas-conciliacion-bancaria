/**
 * "Conectar sistema": la ficha del sistema de facturación del cliente.
 *
 * ⚠️ LA SINCRONIZACIÓN TODAVÍA NO EXISTE. Esto es la pantalla y el registro de
 * la intención, no un integrador. Todo lo que hay aquí está pensado para poder
 * decir eso en voz alta: los estados nombran la espera, y no se pide (ni se
 * guarda) ninguna credencial —ver el comentario de `0017_conexiones_erp.sql`—.
 *
 * Funciones puras y sin dependencias: el mismo criterio vale en el servidor
 * (donde se valida antes de escribir) y en la interfaz (donde se explica).
 */

export type SistemaErp = {
  id: string;
  nombre: string;
  /** Cómo lo reconocería el usuario, si el nombre no basta. */
  nota?: string;
};

/**
 * Catálogo de sistemas frecuentes en empresas peruanas. Es una ayuda para
 * elegir, no una lista de integraciones disponibles: hoy no hay ninguna. Vive
 * en el código y no en la BD a propósito —cambia con el mercado, no con el
 * esquema— y por eso `0017` no le pone un check de valores a la columna.
 *
 * ⚠️ Cubre los tres tamaños a propósito. La lista llegó a tener solo
 * facturadores y ERPs de gama media, y **una empresa grande que no ve el suyo
 * concluye que el producto no es para ella** — en la primera pantalla donde
 * puede comprobar lo que promete la portada. Que falte el catálogo dice más que
 * cualquier titular.
 */
export const SISTEMAS_ERP: readonly SistemaErp[] = [
  { id: "nubefact", nombre: "Nubefact", nota: "Facturación electrónica" },
  { id: "bizlinks", nombre: "Bizlinks", nota: "Facturación electrónica" },
  { id: "efact", nombre: "eFact", nota: "Facturación electrónica" },
  { id: "sunat_sol", nombre: "SUNAT (SOL / Facturador)", nota: "Emisión directa" },
  { id: "defontana", nombre: "Defontana", nota: "ERP" },
  { id: "contasis", nombre: "Contasis", nota: "Contable" },
  { id: "siigo", nombre: "Siigo", nota: "Contable" },
  { id: "starsoft", nombre: "StarSoft", nota: "ERP" },
  { id: "ofisis", nombre: "Ofisis", nota: "ERP" },
  { id: "softland", nombre: "Softland", nota: "ERP" },
  { id: "odoo", nombre: "Odoo", nota: "ERP" },
  { id: "sap_b1", nombre: "SAP Business One", nota: "ERP" },
  { id: "sap_s4", nombre: "SAP S/4HANA · ECC", nota: "ERP corporativo" },
  { id: "dynamics", nombre: "Microsoft Dynamics 365", nota: "ERP corporativo" },
  { id: "oracle", nombre: "Oracle (NetSuite / Fusion)", nota: "ERP corporativo" },
  { id: "otro", nombre: "Otro sistema", nota: "Dinos cuál" },
] as const;

export function buscarSistema(id: string): SistemaErp | undefined {
  return SISTEMAS_ERP.find((s) => s.id === id);
}

export type FrecuenciaSync = "manual" | "diaria" | "semanal";

export const FRECUENCIAS: readonly {
  id: FrecuenciaSync;
  label: string;
  descripcion: string;
}[] = [
  {
    id: "diaria",
    label: "Una vez al día",
    descripcion: "Suficiente para conciliar: el banco tampoco publica antes.",
  },
  {
    id: "semanal",
    label: "Una vez por semana",
    descripcion: "Si emites pocos comprobantes.",
  },
  {
    id: "manual",
    label: "Solo cuando yo lo pida",
    descripcion: "Nada se trae solo; tú aprietas el botón.",
  },
] as const;

export type EstadoConexion =
  | "registrada"
  | "en_preparacion"
  | "activa"
  | "pausada";

/**
 * Cómo se cuenta cada estado.
 *
 * `registrada` es el único que el usuario puede provocar, y su texto es
 * deliberadamente explícito: alguien que rellena un formulario titulado
 * "conectar" da por hecho que algo empezó a traerse. No ha empezado.
 */
export function estadoConexion(estado: string): {
  id: EstadoConexion;
  label: string;
  descripcion: string;
  /** Si la conexión trae comprobantes por su cuenta. Hoy: nunca. */
  sincroniza: boolean;
  tono: "espera" | "exito" | "neutro";
} {
  switch (estado) {
    case "activa":
      return {
        id: "activa",
        label: "Activa",
        descripcion: "Tus comprobantes se traen solos desde tu sistema.",
        sincroniza: true,
        tono: "exito",
      };
    case "en_preparacion":
      return {
        id: "en_preparacion",
        label: "En preparación",
        descripcion:
          "Estamos montando la conexión con tu sistema. Te avisamos en cuanto puedas usarla; mientras tanto, sigue conciliando con tus comprobantes.",
        sincroniza: false,
        tono: "espera",
      };
    case "pausada":
      return {
        id: "pausada",
        label: "En pausa",
        descripcion:
          "La conexión existe pero no está trayendo nada ahora mismo.",
        sincroniza: false,
        tono: "neutro",
      };
    default:
      return {
        id: "registrada",
        label: "Registrada, aún no conectada",
        descripcion:
          "Tenemos los datos de tu sistema. Todavía no se trae ningún comprobante: nos pondremos en contacto para activarla.",
        sincroniza: false,
        tono: "espera",
      };
  }
}

/** Nombre que se muestra: el del catálogo, o el que escribió el usuario. */
export function nombreSistema(c: {
  sistema: string;
  nombre_sistema?: string | null;
}): string {
  const escrito = (c.nombre_sistema ?? "").trim();
  if (c.sistema === "otro") return escrito || "Otro sistema";
  // Un id retirado del catálogo no puede dejar la tarjeta sin título: se cae al
  // nombre escrito y, en último término, al propio id.
  return buscarSistema(c.sistema)?.nombre ?? (escrito || c.sistema);
}

/**
 * Lo que el cliente declara de su sistema. El esquema zod que lo valida vive
 * aparte, en `conexiones-schema.ts`: este módulo lo importa el formulario
 * (componente cliente) y arrastrar zod al navegador por una validación que
 * ocurre en el servidor engordaba la ruta sin dar nada a cambio.
 */
export type ConexionErpInput = {
  sistema: string;
  nombre_sistema: string | null;
  url_base: string | null;
  identificador: string | null;
  frecuencia: FrecuenciaSync;
  contacto: string | null;
  notas: string | null;
};

export type ConexionErp = ConexionErpInput & {
  estado: string;
  updated_at?: string | null;
};

/**
 * Los sistemas que la PORTADA nombra, en su forma corta y reconocible.
 *
 * Vive aquí, pegado al catálogo, y no en la página: son dos listas que tienen
 * que decir lo mismo, y separarlas es cómo acaban divergiendo.
 *
 * ⚠️ **No prometen integración.** Hoy no hay ninguna sincronización construida:
 * lo que el producto hace es leer el ARCHIVO que exporte cualquiera de ellos,
 * con las columnas que traiga. Decir «nos conectamos con tu ERP» sería vender
 * algo que no existe, y la portada es el peor sitio posible para hacerlo.
 *
 * ⚠️ Cada nombre es una promesa que se cobra en la pantalla siguiente: quien lee
 * «Oracle» en la portada, se registra y no lo encuentra en «Conectar sistema»
 * concluye que el producto no es para él —y lo descubre justo después de darte
 * sus datos—. `tests/landing.test.ts` ata las dos listas.
 */
export const ERPS_PORTADA = [
  "SAP",
  "Dynamics",
  "Oracle",
  "Defontana",
  "Nubefact",
] as const;
