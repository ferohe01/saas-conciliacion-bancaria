"use client";

import { useState } from "react";
import { Stepper } from "./Stepper";
import { UploadZone, type ArchivoResumen } from "./UploadZone";
import { CandadoIcon, ChevronIcon } from "./icons";

/**
 * Paso 1 del wizard — "Cargar datos".
 *
 * ⚠️ PROTOTIPO VISUAL: la interacción es local (sin backend ni parsing real).
 * Los registros internos vienen pre-cargados con datos de ejemplo para
 * reproducir el mockup; el extracto bancario empieza vacío. En la Fase 3 esto
 * se conecta con SheetJS (parsing) y Supabase (cuentas/período reales).
 */

const PERIODOS = [
  "Junio 2026",
  "Mayo 2026",
  "Abril 2026",
  "Primer trimestre 2026",
];

const CUENTAS = [
  "BCP Soles ····4521",
  "BBVA Soles ····8890",
  "Interbank Dólares ····3312",
];

// Resumen de ejemplo para reproducir el estado cargado del mockup.
const REGISTROS_EJEMPLO: ArchivoResumen = {
  nombre: "cobranzas_junio.xlsx",
  registros: 184,
  total: "S/ 312,450.00",
};

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full appearance-none rounded-xl border border-neutral-300 bg-white px-4 pr-10 text-neutral-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-neutral-400" />
      </div>
    </label>
  );
}

export function Paso1CargarDatos() {
  const [periodo, setPeriodo] = useState(PERIODOS[0]!);
  const [cuenta, setCuenta] = useState(CUENTAS[0]!);
  const [registros, setRegistros] = useState<ArchivoResumen | null>(
    REGISTROS_EJEMPLO,
  );
  const [extracto, setExtracto] = useState<ArchivoResumen | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const puedeContinuar = registros != null && extracto != null;

  return (
    <div className="w-full max-w-3xl rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      {/* asa decorativa */}
      <div className="mx-auto mb-6 h-1.5 w-10 rounded-full bg-neutral-200" />

      {/* stepper */}
      <Stepper actual={1} />

      {/* selects */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Período a conciliar"
          value={periodo}
          options={PERIODOS}
          onChange={setPeriodo}
        />
        <SelectField
          label="Cuenta bancaria"
          value={cuenta}
          options={CUENTAS}
          onChange={setCuenta}
        />
      </div>

      {/* zonas de carga */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <UploadZone
          titulo="Registros internos"
          icono="documento"
          formatos="Excel o CSV"
          accept=".xlsx,.xls,.csv"
          resumen={registros}
          onArchivo={(file) =>
            setRegistros({ nombre: file.name, registros: undefined })
          }
        />
        <UploadZone
          titulo="Extracto bancario"
          icono="banco"
          formatos="Excel, CSV o PDF"
          bancos="BCP, BBVA, Interbank, Scotiabank"
          accept=".xlsx,.xls,.csv,.pdf"
          resumen={extracto}
          onArchivo={(file) => setExtracto({ nombre: file.name })}
        />
      </div>

      {aviso && (
        <p className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {aviso}
        </p>
      )}

      {/* footer */}
      <div className="mt-8 flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-sm text-neutral-500">
          <CandadoIcon className="h-4 w-4" />
          Tus archivos se procesan de forma segura
        </span>
        <button
          type="button"
          disabled={!puedeContinuar}
          onClick={() =>
            setAviso(
              "En el prototipo esto avanzaría al Paso 2 · Verificar columnas (en construcción).",
            )
          }
          className="rounded-xl bg-neutral-900 px-6 py-3 font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}
