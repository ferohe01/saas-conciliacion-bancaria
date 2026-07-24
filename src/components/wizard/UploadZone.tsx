"use client";

import { useRef, useState } from "react";
import { BancoIcon, DocumentoIcon, CheckIcon } from "./icons";

/** Resumen del archivo cargado que se muestra en el estado "verde". */
export type ArchivoResumen = {
  nombre: string;
  registros?: number;
  total?: string; // ya formateado, ej. "S/ 312,450.00"
  rangoFechas?: string;
};

type UploadZoneProps = {
  titulo: string;
  /** Ícono para el estado vacío ("documento" o "banco"). */
  icono?: "documento" | "banco";
  /** Texto de ayuda de formatos, ej. "Excel, CSV o PDF". */
  formatos?: string;
  /** Texto de ayuda de bancos, ej. "BCP, BBVA, Interbank, Scotiabank". */
  bancos?: string;
  accept?: string;
  resumen?: ArchivoResumen | null;
  onArchivo: (file: File) => void;
};

/**
 * Zona de carga con dos estados:
 *  - vacío: borde punteado, ícono, "arrastra o haz clic", botón.
 *  - cargado: tarjeta verde con nombre del archivo, ✓ y resumen.
 * Soporta clic y arrastrar-y-soltar.
 */
export function UploadZone({
  titulo,
  icono = "banco",
  formatos,
  bancos,
  accept = ".xlsx,.xls,.csv,.pdf",
  resumen,
  onArchivo,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);

  function abrirSelector() {
    inputRef.current?.click();
  }

  function manejarArchivos(files: FileList | null) {
    const file = files?.[0];
    if (file) onArchivo(file);
  }

  // ── Estado cargado (verde) ────────────────────────────────────────────
  if (resumen) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <DocumentoIcon className="mt-0.5 h-6 w-6 text-emerald-600" />
            <div>
              <p className="font-semibold text-emerald-900">{titulo}</p>
              <p className="mt-1 text-sm text-emerald-800">{resumen.nombre}</p>
              {(resumen.registros != null || resumen.total) && (
                <p className="mt-0.5 text-sm text-emerald-700">
                  {resumen.registros != null && (
                    <>{resumen.registros.toLocaleString("es-PE")} registros</>
                  )}
                  {resumen.registros != null && resumen.total && " · "}
                  {resumen.total}
                </p>
              )}
              {resumen.rangoFechas && (
                <p className="mt-0.5 text-xs text-emerald-600">
                  {resumen.rangoFechas}
                </p>
              )}
            </div>
          </div>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <CheckIcon className="h-4 w-4" />
          </span>
        </div>
        <button
          type="button"
          onClick={abrirSelector}
          className="mt-4 text-sm font-medium text-emerald-700 underline-offset-2 hover:underline"
        >
          Cambiar archivo
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => manejarArchivos(e.target.files)}
        />
      </div>
    );
  }

  // ── Estado vacío (punteado) ───────────────────────────────────────────
  const Icono = icono === "documento" ? DocumentoIcon : BancoIcon;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastrando(false);
        manejarArchivos(e.dataTransfer.files);
      }}
      onClick={abrirSelector}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          abrirSelector();
        }
      }}
      className={[
        "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
        arrastrando
          ? "border-blue-400 bg-blue-50"
          : "border-neutral-300 bg-white hover:border-neutral-400",
      ].join(" ")}
    >
      <Icono className="h-8 w-8 text-neutral-400" />
      <p className="mt-3 font-semibold text-neutral-800">{titulo}</p>
      <p className="mt-1 text-sm text-neutral-500">
        Arrastra el archivo o haz clic para buscar
      </p>
      <span className="mt-4 inline-flex items-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50">
        Seleccionar archivo
      </span>
      {(formatos || bancos) && (
        <p className="mt-3 text-xs text-neutral-400">
          {formatos}
          {formatos && bancos && " · "}
          {bancos}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => manejarArchivos(e.target.files)}
      />
    </div>
  );
}
