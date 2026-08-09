"use client";

import {
  CAMPOS_COMPROBANTE,
  ETIQUETA_COMPROBANTE,
  AYUDA_COMPROBANTE,
  OBLIGATORIOS,
  faltaEnConfig,
  aplicarMapeo,
  type CampoComprobante,
  type Config,
} from "@/lib/parsing/mapeoComprobantes";
import { formatearFecha, formatearPEN } from "@/lib/parsing/resumen";
import { Boton } from "@/components/ui";

/**
 * «¿Qué columna es cada cosa?» para el archivo de comprobantes del cliente.
 *
 * Es el gemelo del Paso 2 del wizard, que hace esto mismo con el extracto del
 * banco desde siempre. La asimetría era el problema: al banco nos adaptábamos
 * nosotros y al cliente le pedíamos que se adaptara él, transponiendo su export
 * a nuestra plantilla columna por columna, todos los meses.
 *
 * ⚠️ **Con vista previa interpretada.** No basta con elegir de una lista: la
 * confusión cara aquí es mapear la columna equivocada y descubrirlo cuando la
 * conciliación da 0 %. Ver la fecha ya formateada y el importe ya normalizado
 * delata el error antes de importar nada.
 */

export function MapeoComprobantesForm({
  headers,
  muestras,
  config,
  onCambio,
  onConfirmar,
  onCancelar,
  moneda = "PEN",
  ocupado = false,
}: {
  headers: string[];
  muestras: Record<string, unknown>[];
  config: Config;
  onCambio: (c: Config) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
  moneda?: string;
  ocupado?: boolean;
}) {
  const falta = faltaEnConfig(config);
  const ejemplos = muestras.slice(0, 3);

  const setCampo = (campo: CampoComprobante, header: string) => {
    const mapeo = { ...config.mapeo };
    if (header === "") delete mapeo[campo];
    else mapeo[campo] = header;
    onCambio({ ...config, mapeo });
  };

  return (
    <div className="mt-4 space-y-4">
      <div>
        <h3 className="font-semibold text-neutral-900">
          ¿Qué columna es cada cosa?
        </h3>
        <p className="mt-1 text-sm text-neutral-600">
          Tu archivo no usa las columnas de la plantilla, así que dinos qué es
          cada una. <strong>Se guarda</strong>: la próxima vez subes tu archivo
          tal cual y no se te pregunta nada.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {CAMPOS_COMPROBANTE.map((campo) => {
          const obligatorio = OBLIGATORIOS.includes(campo);
          const ayuda = AYUDA_COMPROBANTE[campo];
          return (
            <label key={campo} className="block">
              <span className="mb-1 block text-sm font-medium text-neutral-700">
                {ETIQUETA_COMPROBANTE[campo]}
                {obligatorio && <span className="text-red-600"> *</span>}
              </span>
              <select
                value={config.mapeo[campo] ?? ""}
                onChange={(e) => setCampo(campo, e.target.value)}
                className="h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-sm text-neutral-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
              >
                <option value="">— sin columna —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              {ayuda && (
                <span className="mt-1 block text-xs text-neutral-500">
                  {ayuda}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {/* El tipo es el campo que más falta en un export real: un libro de
          ventas no trae una columna que diga "cobranza", porque todo él lo es.
          Sin esta salida, la mitad de los archivos serían inmapeables. */}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-sm font-medium text-neutral-800">
          ¿Tu archivo no tiene columna de tipo?
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          Si todo el archivo es de un solo tipo, decláralo aquí y se aplica a
          todas las filas.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { v: null, label: "Usar la columna" },
            { v: "cobranza" as const, label: "Todo son cobranzas" },
            { v: "pago" as const, label: "Todo son pagos" },
          ].map((o) => {
            const activo = (config.tipoFijo ?? null) === o.v;
            return (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => onCambio({ ...config, tipoFijo: o.v })}
                aria-pressed={activo}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  activo
                    ? "border-neutral-800 bg-neutral-900 text-white"
                    : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {ejemplos.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-neutral-700">
            Así quedarían tus primeras filas
          </p>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Importe</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2">Referencia</th>
                  <th className="px-3 py-2">Contraparte</th>
                </tr>
              </thead>
              <tbody>
                {ejemplos.map((m, i) => {
                  const f = aplicarMapeo(m, config);
                  if (!f) {
                    return (
                      <tr key={i} className="border-t border-neutral-100">
                        <td
                          colSpan={6}
                          className="px-3 py-2 text-sm text-amber-700"
                        >
                          Esta fila se omitiría: falta fecha, importe o tipo.
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={i} className="border-t border-neutral-100">
                      <td className="px-3 py-2 tabular-nums">
                        {formatearFecha(f.fecha)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatearPEN(f.monto, moneda)}
                      </td>
                      <td className="px-3 py-2">{f.tipo}</td>
                      <td className="px-3 py-2">{f.serie_numero ?? "—"}</td>
                      <td className="px-3 py-2">{f.referencia_externa ?? "—"}</td>
                      <td className="px-3 py-2">{f.razon_social ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {falta.length > 0 && (
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          Para continuar falta indicar {falta.join(", ")}.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Boton variante="secundario" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </Boton>
        <Boton onClick={onConfirmar} disabled={falta.length > 0 || ocupado}>
          {ocupado ? "Importando…" : "Importar con este formato"}
        </Boton>
      </div>
    </div>
  );
}
