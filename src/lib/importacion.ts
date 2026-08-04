/**
 * Reglas de una importación de plantilla: qué es un duplicado y cómo se cuenta
 * lo que pasó.
 *
 * Puro y con tests. La identidad de un comprobante es (tipo, serie_numero) —el
 * mismo criterio que el índice único de `0018`—, nunca el monto: dos boletas
 * del mismo cliente por el mismo importe el mismo día son documentos distintos
 * y fusionarlas borraría una venta real.
 */

/**
 * Palabra que hay que escribir para vaciar los comprobantes.
 *
 * Vive aquí y no junto a la server action porque un archivo `"use server"` solo
 * puede exportar funciones async: una constante ahí rompe el build.
 */
export const CONFIRMACION_VACIAR = "BORRAR";

export type FilaImportable = {
  tipo: "cobranza" | "pago";
  referencia?: string | null;
  [k: string]: unknown;
};

/**
 * Clave natural, o `null` cuando la fila no tiene serie: sin número no hay
 * identidad que comparar, así que esas filas nunca se consideran duplicadas.
 * Se normaliza igual que en la base (`upper(btrim(...))`) para que "f001-101" y
 * "F001-101 " no entren como dos facturas.
 */
export function claveComprobante(f: {
  tipo: string;
  referencia?: string | null;
}): string | null {
  const serie = (f.referencia ?? "").trim().toUpperCase();
  if (serie === "") return null;
  return `${f.tipo}|${serie}`;
}

/**
 * Quita las filas repetidas DENTRO del propio archivo.
 *
 * Hace falta además de la comprobación contra la base: un Excel con la misma
 * factura dos veces pasaría el filtro de "¿ya existe?" —no existía— y luego
 * reventaría contra el índice único, con un error de Postgres en vez de una
 * explicación. Gana la primera aparición, que es el orden en que el usuario las
 * escribió.
 */
export function dedupEnArchivo<T extends { tipo: string; referencia?: string | null }>(
  filas: T[],
): { filas: T[]; repetidas: number } {
  const vistas = new Set<string>();
  const out: T[] = [];
  let repetidas = 0;

  for (const f of filas) {
    const k = claveComprobante(f);
    if (k === null) {
      out.push(f); // sin serie: no hay forma de saber si se repite
      continue;
    }
    if (vistas.has(k)) {
      repetidas++;
      continue;
    }
    vistas.add(k);
    out.push(f);
  }
  return { filas: out, repetidas };
}

/** Separa lo que ya está en la base de lo que entra nuevo. */
export function separarExistentes<
  T extends { tipo: string; referencia?: string | null },
>(filas: T[], clavesExistentes: Iterable<string>): { nuevas: T[]; yaExistian: number } {
  const existentes = new Set(clavesExistentes);
  const nuevas: T[] = [];
  let yaExistian = 0;

  for (const f of filas) {
    const k = claveComprobante(f);
    if (k !== null && existentes.has(k)) {
      yaExistian++;
      continue;
    }
    nuevas.push(f);
  }
  return { nuevas, yaExistian };
}

export type ResumenImportacion = {
  insertados: number;
  yaExistian: number;
  repetidasEnArchivo: number;
  invalidas: number;
};

/**
 * Una frase que explique el resultado sin obligar a interpretar números.
 *
 * Importa especialmente el caso "0 insertados": sin explicación parece que la
 * carga falló, cuando lo que pasa es que ya estaba todo. Es justo la confusión
 * que llevó a subir el archivo dos veces.
 */
export function mensajeImportacion(r: ResumenImportacion): string {
  const partes: string[] = [];

  if (r.insertados === 0) {
    partes.push(
      r.yaExistian > 0
        ? "No se agregó ninguno: todos los comprobantes del archivo ya estaban cargados."
        : "No se agregó ningún comprobante.",
    );
  } else {
    partes.push(
      `Se ${r.insertados === 1 ? "agregó 1 comprobante" : `agregaron ${r.insertados} comprobantes`}.`,
    );
    if (r.yaExistian > 0) {
      partes.push(
        r.yaExistian === 1
          ? "1 ya estaba cargado y se omitió."
          : `${r.yaExistian} ya estaban cargados y se omitieron.`,
      );
    }
  }

  if (r.repetidasEnArchivo > 0) {
    partes.push(
      r.repetidasEnArchivo === 1
        ? "1 fila venía repetida en el archivo."
        : `${r.repetidasEnArchivo} filas venían repetidas en el archivo.`,
    );
  }
  if (r.invalidas > 0) {
    partes.push(
      r.invalidas === 1
        ? "1 fila se descartó por datos incompletos."
        : `${r.invalidas} filas se descartaron por datos incompletos.`,
    );
  }

  return partes.join(" ");
}
