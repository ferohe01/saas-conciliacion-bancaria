/**
 * Lector de CSV incremental: recibe el archivo a trozos y va soltando filas.
 *
 * ── Por qué existe, habiendo ya un lector con SheetJS ───────────────────────
 *
 * Un XLSX hay que **descomprimirlo entero en memoria** para poder leerlo: 450.000
 * filas son 1–2 GB, y eso no lo arregla insertar por lotes — el pico ocurre
 * antes de la primera inserción. Un CSV, en cambio, se puede leer trozo a trozo
 * con memoria constante, que es lo único que escala de verdad.
 *
 * De ahí la recomendación de producto: **para archivos grandes, CSV**. Es un
 * "Guardar como" para el cliente y convierte un problema de infraestructura en
 * una nota en pantalla.
 *
 * ── Qué cubre ──────────────────────────────────────────────────────────────
 *
 * Comillas dobles con escape (`""`), saltos de línea dentro de campos
 * entrecomillados, CRLF y separador `,` o `;` (los Excel en español exportan
 * con `;`). No cubre otros dialectos: para eso está el camino de SheetJS.
 */

export type FilaCsv = Record<string, string>;

/** Separador más plausible de una línea de encabezados. */
export function detectarSeparador(primeraLinea: string): "," | ";" {
  let comas = 0;
  let puntos = 0;
  let dentro = false;
  for (const c of primeraLinea) {
    if (c === '"') dentro = !dentro;
    else if (!dentro && c === ",") comas++;
    else if (!dentro && c === ";") puntos++;
  }
  return puntos > comas ? ";" : ",";
}

/**
 * Parte una línea respetando comillas. Devuelve los campos ya sin comillas y
 * con los `""` internos convertidos en `"`.
 */
export function partirLinea(linea: string, sep: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let dentro = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (dentro && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        dentro = !dentro;
      }
    } else if (c === sep && !dentro) {
      campos.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos.map((c) => c.trim());
}

/**
 * Acumulador incremental. Se le da texto a trozos y va devolviendo filas
 * completas; al final se llama a `fin()` para la última línea sin salto.
 *
 * Mantiene el estado mínimo: el resto del trozo anterior y si venimos dentro de
 * un campo entrecomillado (un salto de línea dentro de comillas NO parte fila).
 */
export class LectorCsv {
  private resto = "";
  private headers: string[] | null = null;
  private sep: "," | ";" = ",";
  /** Solo vive dentro de una pasada de `cortarLineas`; ver su comentario. */
  private dentroDeComillas = false;

  /** Encabezados detectados, disponibles tras el primer trozo con una línea. */
  get encabezados(): string[] {
    return this.headers ?? [];
  }

  private cortarLineas(texto: string, hastaElFinal: boolean): string[] {
    // El estado de las comillas se RECALCULA en cada pasada, no se arrastra:
    // `texto` empieza siempre por `resto`, que es una línea completa desde su
    // inicio, así que volver a escanearla reproduce el estado correcto. Si se
    // conservara entre trozos, las comillas del resto se contarían dos veces y
    // el lector acabaría creyendo que está dentro de un campo cuando no lo está.
    this.dentroDeComillas = false;
    const lineas: string[] = [];
    let actual = "";
    for (const c of texto) {
      if (c === '"') this.dentroDeComillas = !this.dentroDeComillas;
      if (c === "\n" && !this.dentroDeComillas) {
        lineas.push(actual.replace(/\r$/, ""));
        actual = "";
      } else {
        actual += c;
      }
    }
    if (hastaElFinal) {
      if (actual.trim() !== "") lineas.push(actual.replace(/\r$/, ""));
      this.resto = "";
    } else {
      this.resto = actual;
    }
    return lineas;
  }

  private aFila(linea: string): FilaCsv | null {
    if (linea.trim() === "") return null;
    const valores = partirLinea(linea, this.sep);
    const fila: FilaCsv = {};
    this.headers!.forEach((h, i) => {
      fila[h] = valores[i] ?? "";
    });
    return fila;
  }

  /** Procesa un trozo y devuelve las filas completas que hayan salido. */
  trozo(texto: string): FilaCsv[] {
    // El BOM de los Excel en Windows se cuela en el primer encabezado y luego
    // ninguna columna coincide por nombre.
    const limpio = this.headers === null ? texto.replace(/^﻿/, "") : texto;
    const lineas = this.cortarLineas(this.resto + limpio, false);
    const filas: FilaCsv[] = [];

    for (const linea of lineas) {
      if (this.headers === null) {
        if (linea.trim() === "") continue;
        this.sep = detectarSeparador(linea);
        this.headers = partirLinea(linea, this.sep);
        continue;
      }
      const f = this.aFila(linea);
      if (f) filas.push(f);
    }
    return filas;
  }

  /** Cierra el lector y devuelve la última fila si quedó sin salto de línea. */
  fin(): FilaCsv[] {
    if (this.resto.trim() === "") return [];
    const lineas = this.cortarLineas(this.resto, true);
    const filas: FilaCsv[] = [];
    for (const linea of lineas) {
      if (this.headers === null) {
        this.sep = detectarSeparador(linea);
        this.headers = partirLinea(linea, this.sep);
        continue;
      }
      const f = this.aFila(linea);
      if (f) filas.push(f);
    }
    return filas;
  }
}
