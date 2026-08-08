import {
  leerArchivo,
  leerCabecera,
  esExtensionSoportada,
  esPDF,
} from "./leerArchivo";
import { detectarColumnas, type MapeoColumnas } from "./deteccion";
import { calcularResumen, type ResumenArchivo } from "./resumen";
import { validarCoherencia, type ResultadoCoherencia } from "./coherencia";

/** Resultado de procesar un archivo cargado en el Paso 1. */
export type ArchivoProcesado = {
  nombre: string;
  formato: "excel" | "pdf" | "no_soportado";
  headers: string[];
  filas: Record<string, unknown>[];
  mapeo: MapeoColumnas;
  resumen: ResumenArchivo | null;
  coherencia: ResultadoCoherencia | null;
};

/**
 * Lee un archivo, detecta columnas, calcula el resumen y valida la coherencia
 * con el período. El PDF no se parsea en el navegador (se delega a n8n); se
 * acepta y se marca como tal.
 */
export async function procesarArchivo(
  file: File,
  periodo: { desde: string; hasta: string },
): Promise<ArchivoProcesado> {
  if (esPDF(file.name)) {
    return {
      nombre: file.name,
      formato: "pdf",
      headers: [],
      filas: [],
      mapeo: {},
      resumen: null,
      coherencia: null,
    };
  }

  if (!esExtensionSoportada(file.name)) {
    return {
      nombre: file.name,
      formato: "no_soportado",
      headers: [],
      filas: [],
      mapeo: {},
      resumen: null,
      coherencia: null,
    };
  }

  const { headers, filas } = await leerArchivo(file);
  const muestras = filas.slice(0, 20);
  const mapeo = detectarColumnas(headers, muestras);
  const resumen = calcularResumen(filas, mapeo);
  const coherencia = validarCoherencia(resumen.fechasISO, periodo);

  return {
    nombre: file.name,
    formato: "excel",
    headers,
    filas,
    mapeo,
    resumen,
    coherencia,
  };
}

/**
 * Previsualización para el Paso 2: SOLO las primeras filas.
 *
 * El mapeo de columnas necesita ejemplos, no el archivo entero. Leerlo entero
 * era lo que impedía cargar un extracto de 26 MB en el navegador — y no hace
 * falta, porque quien lo procesa es el servidor.
 *
 * ⚠️ `resumen` viene en `null` a propósito: contar y sumar sobre las primeras
 * 500 filas daría cifras plausibles y falsas. Los totales, el rango de fechas y
 * el saldo final los devuelve `/api/extracto/importar`, que lo ve completo.
 */
export async function previsualizarArchivo(
  file: File,
): Promise<ArchivoProcesado> {
  if (esPDF(file.name)) {
    return {
      nombre: file.name, formato: "pdf", headers: [], filas: [],
      mapeo: {}, resumen: null, coherencia: null,
    };
  }
  if (!esExtensionSoportada(file.name)) {
    return {
      nombre: file.name, formato: "no_soportado", headers: [], filas: [],
      mapeo: {}, resumen: null, coherencia: null,
    };
  }

  const { headers, filas } = await leerCabecera(file);
  return {
    nombre: file.name,
    formato: "excel",
    headers,
    filas,
    mapeo: detectarColumnas(headers, filas.slice(0, 20)),
    resumen: null,
    coherencia: null,
  };
}
