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
 * Cuándo el navegador puede permitirse leer el archivo entero.
 *
 * Por debajo de esto, leerlo cuesta poco y el Paso 1 puede enseñar de golpe
 * cuántos movimientos hay, cuánto suman, qué rango cubren y si el archivo
 * parece de otro período. Ese resumen inmediato es lo que hace que una PyME
 * detecte al instante que subió el extracto equivocado, y vale la pena
 * conservarlo.
 *
 * Por encima —una recaudadora con 450.000 movimientos son 26 MB— no se puede:
 * abrirlo entero agota la memoria del navegador. Ahí se leen solo las primeras
 * filas y los totales los devuelve el servidor al importarlo.
 */
export const BYTES_RESUMEN_INMEDIATO = 8 * 1024 * 1024;

/**
 * Previsualización para el Paso 2.
 *
 * ⚠️ La bifurcación es SOLO de previsualización. Los dos tamaños suben el
 * archivo al servidor igual y concilian por el mismo camino: lo único que
 * cambia es cuánto alcanza a enseñar el navegador antes. Si el tamaño decidiera
 * también cómo se procesa, habría dos motores que mantener y una clase entera
 * de fallos que solo aparecen con archivos grandes.
 *
 * Cuando `resumen` viene `null` es que el archivo era grande: contar o sumar
 * sobre las primeras 500 filas daría cifras plausibles y falsas, así que no se
 * calculan. Los totales reales llegan de `/api/extracto/importar`.
 */
export async function previsualizarArchivo(
  file: File,
  periodo: { desde: string; hasta: string },
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

  // Archivo pequeño: se lee entero y el Paso 1 enseña el resumen completo.
  if (file.size <= BYTES_RESUMEN_INMEDIATO) return procesarArchivo(file, periodo);

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
