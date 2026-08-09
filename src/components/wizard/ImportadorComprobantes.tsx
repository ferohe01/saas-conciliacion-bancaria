"use client";

import { useRef, useState, useTransition } from "react";
import { descargarPlantilla, COLUMNAS_PLANTILLA } from "@/lib/plantilla";
import { leerArchivo, leerCabecera } from "@/lib/parsing/leerArchivo";
import { detectarColumnasComprobante } from "@/lib/parsing/deteccionComprobantes";
import { esPlantilla, type Config } from "@/lib/parsing/mapeoComprobantes";
import { MapeoComprobantesForm } from "@/components/comprobantes/MapeoComprobantesForm";
import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";
import { formatearFecha, formatearPEN } from "@/lib/parsing/resumen";
import {
  deshacerImportacion,
  guardarMapeoComprobantes,
} from "@/app/(app)/wizard/actions";

/**
 * Por encima de esto no se previsualiza: el navegador no puede con ello.
 *
 * 4 MB de CSV son ~75.000 filas, que SheetJS en el navegador convierte en
 * cientos de MB. Cubre de sobra la plantilla habitual (5.000 filas ≈ 1,6 MB) y
 * deja fuera lo que de verdad haría sufrir a la pestaña. El servidor lee ese
 * mismo archivo con 13 MB de memoria, medidos sobre 100.000 filas.
 */
const MAX_VISTA_PREVIA = 4 * 1024 * 1024;

type FilaImport = {
  fecha: string;
  fecha_vencimiento: string | null;
  monto: number;
  tipo: "cobranza" | "pago";
  referencia: string | null;
  referencia_externa: string | null;
  ruc_contraparte: string | null;
  razon_social: string | null;
  descripcion: string | null;
};

function texto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/** Convierte las filas crudas de la plantilla en filas válidas + conteo de errores. */
function normalizarFilas(crudas: Record<string, unknown>[]): {
  validas: FilaImport[];
  invalidas: number;
} {
  const validas: FilaImport[] = [];
  let invalidas = 0;

  for (const f of crudas) {
    const fecha = normalizarFecha(f["fecha"]);
    const monto = normalizarMonto(f["monto"]);
    const tipoRaw = String(f["tipo"] ?? "").trim().toLowerCase();
    const tipo =
      tipoRaw === "cobranza" || tipoRaw === "pago" ? tipoRaw : null;

    if (!fecha || monto == null || !tipo) {
      invalidas++;
      continue;
    }
    validas.push({
      fecha,
      // Opcional: muchas ventas son al contado. Si falta, el aging usa la
      // fecha de emision como referencia.
      fecha_vencimiento: normalizarFecha(f["fecha_vencimiento"]) ?? null,
      monto,
      tipo,
      referencia: texto(f["referencia"]),
      referencia_externa: texto(f["referencia_externa"]),
      ruc_contraparte: texto(f["ruc_contraparte"]),
      razon_social: texto(f["razon_social"]),
      descripcion: texto(f["descripcion"]),
    });
  }
  return { validas, invalidas };
}

export function ImportadorComprobantes({
  onImportado,
  mapeoGuardado = null,
}: {
  onImportado?: () => void;
  /** El formato que esta empresa confirmó la última vez. */
  mapeoGuardado?: Config | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [filas, setFilas] = useState<FilaImport[] | null>(null);
  const [invalidas, setInvalidas] = useState(0);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  /** Lote recién importado: mientras exista, se ofrece deshacerlo. */
  const [ultimoLote, setUltimoLote] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  /** Cuando el archivo no es la plantilla: qué columna es cada cosa. */
  const [mapeando, setMapeando] = useState<{
    headers: string[];
    muestras: Record<string, unknown>[];
    config: Config;
  } | null>(null);

  /**
   * El archivo SIEMPRE lo procesa el servidor. Aquí solo se lee para enseñar
   * una vista previa, y únicamente si es pequeño: parsear en el navegador un
   * archivo de cientos de miles de filas se lleva gigas de memoria y tumba la
   * pestaña. Por encima del límite se sube a ciegas, que es exactamente lo que
   * hace posible cargar 450.000 comprobantes.
   */
  async function onArchivo(file: File) {
    setError(null);
    setOkMsg(null);
    setArchivo(file);
    setNombre(file.name);
    setFilas(null);
    setInvalidas(0);
    setMapeando(null);

    // ── Las cabeceras se leen SIEMPRE, incluso de un archivo enorme ────────
    //
    // `leerCabecera` trae solo el principio (2 MB de CSV bastan para 500
    // filas), así que se puede saber qué columnas trae un archivo de 450.000
    // sin que el navegador lo sostenga entero. Sin esto, un cliente grande no
    // podría mapear nunca: justo el que más lo necesita.
    let cabeceras: string[] = [];
    let muestras: Record<string, unknown>[] = [];
    try {
      const previa = await leerCabecera(file);
      cabeceras = previa.headers;
      muestras = previa.filas;
    } catch {
      // Si ni las cabeceras se pueden leer, que decida el servidor.
      return;
    }

    // Camino 1: es la plantilla. No se pregunta nada, como siempre.
    if (esPlantilla(cabeceras)) {
      if (file.size > MAX_VISTA_PREVIA) return; // grande: sin previa
      try {
        const { filas: crudas } = await leerArchivo(file);
        const { validas, invalidas } = normalizarFilas(crudas);
        setFilas(validas);
        setInvalidas(invalidas);
        if (validas.length === 0) {
          setError(
            "No se encontraron filas válidas. Revisa fecha, monto y tipo (cobranza/pago).",
          );
        }
      } catch {
        // Que falle la previa no impide importar: el servidor vuelve a leerlo.
        setFilas(null);
      }
      return;
    }

    // Camino 2: es el archivo del cliente. Se propone un mapeo y se confirma.
    const detectado = detectarColumnasComprobante(cabeceras, muestras);
    const guardado = mapeoGuardado?.mapeo ?? {};
    setMapeando({
      headers: cabeceras,
      muestras,
      // Lo guardado MANDA donde diga algo, pero no borra lo detectado: es la
      // misma regla que `elegirMapeo` del extracto, y por el mismo motivo —una
      // memoria que solo puede quitar campos convierte un error en permanente.
      config: {
        mapeo: { ...detectado, ...guardado },
        tipoFijo: mapeoGuardado?.tipoFijo ?? null,
      },
    });
  }

  function confirmar(config?: Config) {
    if (!archivo) return;
    setError(null);
    startTransition(async () => {
      // Se recuerda ANTES de importar: si la carga es larga y el usuario cierra
      // la pestaña, el formato ya quedó aprendido y no hay que repetirlo.
      if (config) await guardarMapeoComprobantes(config);

      const cuerpo = new FormData();
      cuerpo.append("archivo", archivo);
      if (config) cuerpo.append("mapeo", JSON.stringify(config));
      try {
        const r = await fetch("/api/comprobantes/importar", {
          method: "POST",
          body: cuerpo,
        });
        const res = (await r.json()) as {
          ok?: boolean; error?: string; mensaje?: string;
          insertados?: number; lote?: string;
        };
        if (!r.ok || !res.ok) {
          setError(res.error ?? "No se pudo importar.");
          return;
        }
        setOkMsg(res.mensaje ?? `Se importaron ${res.insertados} comprobantes.`);
        setUltimoLote(res.lote ?? null);
        setArchivo(null);
        setFilas(null);
        setNombre("");
        setMapeando(null);
        onImportado?.();
      } catch {
        setError(
          "Se cortó la conexión durante la carga. Si el archivo es grande, revisa la lista antes de reintentar: puede que parte ya esté cargada.",
        );
      }
    });
  }

  function deshacer() {
    if (!ultimoLote) return;
    setError(null);
    startTransition(async () => {
      const res = await deshacerImportacion(ultimoLote);
      if (!res.ok) {
        setError(res.error ?? "No se pudo deshacer.");
        return;
      }
      setOkMsg(
        res.protegidos
          ? `Se quitaron ${res.borrados} comprobantes. ${res.protegidos} se conservaron porque ya tienen cobros aplicados.`
          : `Se quitaron ${res.borrados} comprobantes de esa carga.`,
      );
      setUltimoLote(null);
      onImportado?.();
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      {/* Los dos caminos, dichos en voz alta. Antes solo se nombraba el de la
          plantilla, así que quien SÍ tiene sistema no veía ninguna puerta. */}
      <p className="text-sm font-medium text-neutral-800">
        Carga tus comprobantes
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        ¿Tu sistema exporta a Excel o CSV? <strong>Súbelo tal cual</strong> y
        dinos una vez qué columna es cada cosa. ¿No tienes sistema? Descarga la
        plantilla, llénala y súbela.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            void descargarPlantilla();
          }}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          Descargar plantilla
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          Subir archivo
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onArchivo(file);
            e.target.value = "";
          }}
        />
      </div>

      {/* Camino 2: el archivo del cliente. Se confirma el mapeo una vez y se
          recuerda para las próximas cargas. */}
      {mapeando && (
        <MapeoComprobantesForm
          headers={mapeando.headers}
          muestras={mapeando.muestras}
          config={mapeando.config}
          ocupado={pendiente}
          onCambio={(config) => setMapeando({ ...mapeando, config })}
          onCancelar={() => {
            setMapeando(null);
            setArchivo(null);
            setNombre("");
          }}
          onConfirmar={() => confirmar(mapeando.config)}
        />
      )}

      {archivo && !mapeando && (
        <div className="mt-4">
          <p className="text-sm text-neutral-700">
            <span className="font-medium">{nombre}</span>
            {filas ? ` — ${filas.length} comprobantes listos` : ""}
            {invalidas > 0 && (
              <span className="text-amber-600">
                {" "}
                · {invalidas} fila(s) con datos incompletos se omitirán
              </span>
            )}
          </p>

          {!filas && (
            <p className="mt-2 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
              Archivo grande ({(archivo.size / 1048576).toFixed(1)} MB): se
              procesa en el servidor por lotes, sin vista previa. Si es un Excel
              de más de 50.000 filas, guárdalo como CSV — ese formato no tiene
              tope porque se lee por partes.
            </p>
          )}

          {filas && (
          <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  {COLUMNAS_PLANTILLA.map((c) => (
                    <th key={c} className="px-3 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 5).map((f, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    <td className="px-3 py-2">{formatearFecha(f.fecha)}</td>
                    {/* Faltaba esta celda: la cabecera tenía 9 columnas y el
                        cuerpo 8, así que la vista previa mostraba cada valor
                        bajo el título de la columna siguiente. Una previsual
                        desalineada es peor que ninguna: invita a mapear mal. */}
                    <td className="px-3 py-2">
                      {f.fecha_vencimiento ? formatearFecha(f.fecha_vencimiento) : "—"}
                    </td>
                    <td className="px-3 py-2">{formatearPEN(f.monto)}</td>
                    <td className="px-3 py-2">{f.tipo}</td>
                    <td className="px-3 py-2">{f.referencia ?? "—"}</td>
                    <td className="px-3 py-2">{f.referencia_externa ?? "—"}</td>
                    <td className="px-3 py-2">{f.ruc_contraparte ?? "—"}</td>
                    <td className="px-3 py-2">{f.razon_social ?? "—"}</td>
                    <td className="px-3 py-2">{f.descripcion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          <button
            type="button"
            onClick={() => confirmar()}
            disabled={pendiente}
            className="mt-3 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:bg-neutral-300"
          >
            {pendiente
              ? "Importando… (puede tardar en archivos grandes)"
              : filas
                ? `Importar ${filas.length} comprobantes`
                : "Importar este archivo"}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {okMsg && (
        <div className="mt-3 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <p>{okMsg}</p>
          {/* Deshacer vive junto al mensaje de éxito, que es el momento en que
              uno se da cuenta de que subió el archivo equivocado. */}
          {ultimoLote && (
            <button
              type="button"
              onClick={deshacer}
              disabled={pendiente}
              className="mt-1.5 min-h-9 rounded-lg px-2 text-sm font-medium text-emerald-900 underline underline-offset-2 transition-colors hover:bg-emerald-100 disabled:opacity-60"
            >
              {pendiente ? "Deshaciendo…" : "Deshacer esta importación"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
