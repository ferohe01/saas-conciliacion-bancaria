"use client";

import { useRef, useState, useTransition } from "react";
import { descargarPlantilla, COLUMNAS_PLANTILLA } from "@/lib/plantilla";
import { leerArchivo } from "@/lib/parsing/leerArchivo";
import { normalizarFecha } from "@/lib/normalizacion/fecha";
import { normalizarMonto } from "@/lib/normalizacion/monto";
import { formatearFecha, formatearPEN } from "@/lib/parsing/resumen";
import { importarComprobantes } from "@/app/(app)/wizard/actions";

type FilaImport = {
  fecha: string;
  fecha_vencimiento: string | null;
  monto: number;
  tipo: "cobranza" | "pago";
  referencia: string | null;
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
      ruc_contraparte: texto(f["ruc_contraparte"]),
      razon_social: texto(f["razon_social"]),
      descripcion: texto(f["descripcion"]),
    });
  }
  return { validas, invalidas };
}

export function ImportadorComprobantes({
  onImportado,
}: {
  onImportado?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [filas, setFilas] = useState<FilaImport[] | null>(null);
  const [invalidas, setInvalidas] = useState(0);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  async function onArchivo(file: File) {
    setError(null);
    setOkMsg(null);
    try {
      const { filas: crudas } = await leerArchivo(file);
      const { validas, invalidas } = normalizarFilas(crudas);
      setNombre(file.name);
      setFilas(validas);
      setInvalidas(invalidas);
      if (validas.length === 0) {
        setError(
          "No se encontraron filas válidas. Revisa fecha, monto y tipo (cobranza/pago).",
        );
      }
    } catch {
      setError("No se pudo leer el archivo.");
    }
  }

  function confirmar() {
    if (!filas || filas.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await importarComprobantes(filas);
      if (!res.ok) {
        setError(res.error ?? "No se pudo importar.");
        return;
      }
      setOkMsg(`Se importaron ${res.insertados} comprobantes.`);
      setFilas(null);
      setNombre("");
      onImportado?.();
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-sm font-medium text-neutral-800">
        ¿No tienes sistema? Usa la plantilla
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        Descarga la plantilla, llénala con tus cobranzas/pagos y súbela para
        registrarlos.
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
          Subir plantilla llena
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

      {filas && filas.length > 0 && (
        <div className="mt-4">
          <p className="text-sm text-neutral-700">
            <span className="font-medium">{nombre}</span> — {filas.length}{" "}
            comprobantes listos
            {invalidas > 0 && (
              <span className="text-amber-600">
                {" "}
                · {invalidas} fila(s) con datos incompletos se omitirán
              </span>
            )}
          </p>

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
                    <td className="px-3 py-2">{formatearPEN(f.monto)}</td>
                    <td className="px-3 py-2">{f.tipo}</td>
                    <td className="px-3 py-2">{f.referencia ?? "—"}</td>
                    <td className="px-3 py-2">{f.ruc_contraparte ?? "—"}</td>
                    <td className="px-3 py-2">{f.razon_social ?? "—"}</td>
                    <td className="px-3 py-2">{f.descripcion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={confirmar}
            disabled={pendiente}
            className="mt-3 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:bg-neutral-300"
          >
            {pendiente ? "Importando…" : `Importar ${filas.length} comprobantes`}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {okMsg && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {okMsg}
        </p>
      )}
    </div>
  );
}
