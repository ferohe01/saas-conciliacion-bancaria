import { LectorCsv } from "./csv";
/**
 * Lectura de archivos Excel/CSV en el navegador con SheetJS. Devuelve los
 * encabezados y las filas como objetos { encabezado: valor }. El parsing de PDF
 * NO se hace aquí (se delega a n8n en una fase futura).
 *
 * SheetJS se carga con import() dinámico para que no pese en el bundle inicial.
 */

export type ArchivoLeido = {
  headers: string[];
  filas: Record<string, unknown>[];
};

const EXT_SOPORTADAS = [".xlsx", ".xls", ".csv"];

export function esExtensionSoportada(nombre: string): boolean {
  const n = nombre.toLowerCase();
  return EXT_SOPORTADAS.some((e) => n.endsWith(e));
}

export function esPDF(nombre: string): boolean {
  return nombre.toLowerCase().endsWith(".pdf");
}

/**
 * Cuántas filas basta leer para mapear columnas.
 *
 * El Paso 2 solo necesita ver ejemplos para que la persona reconozca cuál es la
 * fecha y cuál el monto. Leer el archivo entero para eso es lo que impedía
 * cargar un extracto de 26 MB: el navegador tendría que sostenerlo en memoria
 * cuando el que va a procesarlo es el servidor.
 */
export const FILAS_PREVIA = 500;

/**
 * Lee SOLO el principio del archivo, para la previsualización del mapeo.
 *
 * ⚠️ Lo que sale de aquí no sirve para contar ni para sumar: son las primeras
 * filas, no el archivo. Los totales y el saldo final los devuelve el servidor
 * al importarlo, que es quien lo ve entero — y son datos reales en vez de una
 * estimación del navegador.
 */
export async function leerCabecera(
  file: File,
  maxFilas = FILAS_PREVIA,
): Promise<ArchivoLeido> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    // Un par de MB alcanzan de sobra para 500 filas, y evitan traer los otros
    // 24 a la memoria del navegador.
    const trozo = await file.slice(0, 2 * 1024 * 1024).text();
    const lector = new LectorCsv();
    // Sin `fin()`: la última línea del trozo casi seguro está cortada por la
    // mitad, y una fila a medias en la previsualización confunde al mapear.
    const filas = lector.trozo(trozo).slice(0, maxFilas);
    return { headers: lector.encabezados, filas };
  }

  // Un XLSX hay que descomprimirlo entero antes de ver la primera fila; lo
  // único que se puede acotar es cuánto se convierte. Por eso el formato
  // grande recomendado es CSV.
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
    sheetRows: maxFilas + 1,
  });
  const nombreHoja = wb.SheetNames[0];
  if (!nombreHoja) return { headers: [], filas: [] };
  return aFilas(XLSX, wb.Sheets[nombreHoja]!);
}

export async function leerArchivo(file: File): Promise<ArchivoLeido> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const nombreHoja = wb.SheetNames[0];
  if (!nombreHoja) return { headers: [], filas: [] };

  return aFilas(XLSX, wb.Sheets[nombreHoja]!);
}

/** Matriz de SheetJS → filas { encabezado: valor }. Compartida por los dos lectores. */
function aFilas(
  XLSX: typeof import("xlsx"),
  hoja: import("xlsx").WorkSheet,
): ArchivoLeido {
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  if (matriz.length === 0) return { headers: [], filas: [] };

  const headers = (matriz[0] ?? []).map((h, i) =>
    String(h ?? "").trim() || `Columna ${i + 1}`,
  );

  const filas: Record<string, unknown>[] = [];
  for (let r = 1; r < matriz.length; r++) {
    const fila = matriz[r] ?? [];
    // Saltar filas totalmente vacías.
    if (fila.every((c) => c == null || String(c).trim() === "")) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = fila[i] ?? "";
    });
    filas.push(obj);
  }

  return { headers, filas };
}
