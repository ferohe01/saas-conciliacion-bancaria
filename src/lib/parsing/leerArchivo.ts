import * as XLSX from "xlsx";

/**
 * Lectura de archivos Excel/CSV en el navegador con SheetJS. Devuelve los
 * encabezados y las filas como objetos { encabezado: valor }. El parsing de PDF
 * NO se hace aquí (se delega a n8n en una fase futura).
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

export async function leerArchivo(file: File): Promise<ArchivoLeido> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const nombreHoja = wb.SheetNames[0];
  if (!nombreHoja) return { headers: [], filas: [] };

  const hoja = wb.Sheets[nombreHoja]!;
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
