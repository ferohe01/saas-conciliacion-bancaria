/**
 * Cómo carga sus comprobantes una empresa.
 *
 * ── Dos clientes distintos, dos caminos ────────────────────────────────────
 *
 * La PyME de 500 facturas al mes las lleva en su propio Excel o en un cuaderno.
 * Para ella, **la plantilla es mejor producto**: garantiza datos limpios y no
 * la obliga a entender la diferencia entre "número de documento" y "referencia
 * de operación" —justo lo que más se confunde—. Si mapea mal una columna, no lo
 * descubre al mapear: lo descubre cuando la conciliación da 0 %, y entonces
 * culpa al sistema.
 *
 * La recaudadora de 450.000 movimientos no puede transponer nada a ninguna
 * plantilla. Para ella, exigirla es cerrarle la puerta.
 *
 * ⚠️ **El discriminador es la EMPRESA, no el archivo.** La tentación era abrir
 * el mapeo "para archivos grandes", y no funciona: la primera prueba del flujo
 * de la recaudadora se hizo con **200 filas**, que un umbral habría bloqueado.
 * Y una PyME que pasa de 4.900 a 5.100 filas cambiaría de flujo de un mes a
 * otro sin entender por qué. Un umbral convierte una decisión de producto en
 * una lotería.
 *
 * Funciones puras: el mismo criterio vale en el servidor (donde se hace
 * cumplir) y en la interfaz (donde se explica).
 */

export type ModoCarga = "plantilla" | "archivo_propio";

/**
 * Un valor desconocido cae a `plantilla`, nunca a `archivo_propio`.
 *
 * Mismo criterio que `plan` en `suscripcion.ts`: ante un dato que no se
 * entiende, el camino guiado. Degradar hacia el modo abierto sería conceder por
 * accidente lo que se decidió no conceder por defecto.
 */
export function modoCarga(valor: unknown): ModoCarga {
  return valor === "archivo_propio" ? "archivo_propio" : "plantilla";
}

/** ¿Puede subir un archivo con sus propias columnas? */
export function permiteArchivoPropio(valor: unknown): boolean {
  return modoCarga(valor) === "archivo_propio";
}

export const ETIQUETA_MODO: Record<ModoCarga, string> = {
  plantilla: "Con la plantilla",
  archivo_propio: "Con el archivo de mi sistema",
};

export const DESCRIPCION_MODO: Record<ModoCarga, string> = {
  plantilla:
    "Descargas la plantilla, la llenas con tus cobranzas y pagos, y la subes. Es lo más simple y evita errores al cargar.",
  archivo_propio:
    "Subes el archivo tal como lo exporta tu sistema y nos dices una vez qué columna es cada cosa. Para quien factura desde un ERP y no puede rehacer el archivo cada mes.",
};

/**
 * Aviso al pasar al modo abierto.
 *
 * No es un trámite: quien lo activa se hace cargo de que las columnas estén
 * bien elegidas, y ese error no da la cara hasta la conciliación.
 */
export const AVISO_ARCHIVO_PROPIO =
  "Tú eliges qué columna es cada dato. Si te equivocas en una, los comprobantes se cargan igual y el error no aparece hasta que la conciliación no encuentra pareja. Con la plantilla eso no puede pasar.";
