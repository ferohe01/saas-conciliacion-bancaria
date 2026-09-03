"use client";

import { useMemo } from "react";
import {
  CAMPOS_EXTRACTO,
  ETIQUETA_CAMPO,
  type CampoCanonico,
  type MapeoColumnas,
} from "@/lib/parsing/deteccion";
import {
  normalizarInternos,
  normalizarBancarios,
} from "@/lib/normalizacion/canonico";
import { formatearPEN, formatearFecha } from "@/lib/parsing/resumen";

const CAMPOS_INTERNOS: CampoCanonico[] = [
  "fecha",
  "monto",
  "tipo",
  "referencia",
  "contraparte",
  "descripcion",
];


type Props = {
  titulo: string;
  variante: "internos" | "extracto";
  headers: string[];
  filas: Record<string, unknown>[];
  mapeo: MapeoColumnas;
  moneda: string;
  /**
   * Con qué dudó la detección, por campo.
   *
   * ⚠️ No es cosmético. Un extracto puede traer dos columnas que se parecen
   * —«Nro Operacion» y «Nro Referencia»— y elegir mal no da un error: da una
   * conciliación al 0 % un rato después, con los dos archivos perfectamente
   * emparejables. Nombrar la otra candidata es la única pista que el usuario
   * puede contrastar con la vista previa de abajo.
   */
  alternativas?: Partial<Record<CampoCanonico, string[]>>;
  /**
   * Lo que la DETECCIÓN propuso, antes de que el mapeo guardado de la cuenta se
   * mezclara encima (`elegirMapeo`). Sin esto no hay forma de enseñar que la
   * memoria pisó una propuesta distinta — ver el comentario de `memoriaPisa`.
   */
  detectado?: MapeoColumnas;
  onChange: (m: MapeoColumnas) => void;
};

export function MapeoDataset({
  titulo,
  variante,
  headers,
  filas,
  mapeo,
  moneda,
  alternativas,
  detectado,
  onChange,
}: Props) {
  const campos = variante === "internos" ? CAMPOS_INTERNOS : CAMPOS_EXTRACTO;

  const { preview, invalidas, total } = useMemo(() => {
    const res =
      variante === "internos"
        ? normalizarInternos(filas, mapeo)
        : normalizarBancarios(filas, mapeo);
    return {
      preview: res.filas.slice(0, 8),
      invalidas: res.invalidas,
      total: res.filas.length,
    };
  }, [variante, filas, mapeo]);

  function setCampo(campo: CampoCanonico, valor: string) {
    const nuevo = { ...mapeo };
    if (valor === "") delete nuevo[campo];
    else nuevo[campo] = valor;
    onChange(nuevo);
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <p className="font-semibold text-neutral-900">{titulo}</p>
      <p className="mt-1 text-sm text-neutral-500">
        Verifica que cada dato apunte a la columna correcta de tu archivo.
      </p>

      {/* dropdowns de mapeo */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {campos.map((campo) => {
          const puesta = mapeo[campo];
          /**
           * ⚠️⚠️ Lo que la MEMORIA de la cuenta pisó.
           *
           * `elegirMapeo` hace que el mapeo guardado gane sobre la detección, y
           * eso convierte un error de mapeo en permanente y **mudo**: la cuenta
           * memorizó «Nro Operacion» en una corrida que dio 0 %, y en la
           * siguiente vuelve a aplicarlo pisando una detección que ya propone
           * la columna buena. En pantalla no se distingue de un acierto.
           *
           * Peor todavía: el aviso de empate se apagaba solo justo aquí, porque
           * las alternativas se calculan respecto al ganador de la DETECCIÓN
           * —«Nro Operacion» era la alternativa— y al filtrarlas contra el valor
           * efectivo quedaba la lista vacía. La única pista desaparecía en el
           * único caso en que hacía falta.
           */
          const propuesta = detectado?.[campo];
          const memoriaPisa =
            propuesta != null && puesta != null && propuesta !== puesta;
          // Solo se avisa mientras siga puesta la columna que se eligió sola:
          // en cuanto el usuario toca el desplegable ya decidió él, y repetirle
          // la duda es ruido.
          const dudas =
            puesta != null
              ? (alternativas?.[campo] ?? []).filter((h) => h !== puesta)
              : [];
          return (
            <label key={campo} className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-600">
                {ETIQUETA_CAMPO[campo]}
                {(campo === "fecha" || campo === "monto") && (
                  <span className="text-red-500"> *</span>
                )}
              </span>
              <select
                value={mapeo[campo] ?? ""}
                onChange={(e) => setCampo(campo, e.target.value)}
                className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
              >
                <option value="">(ninguna)</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              {memoriaPisa ? (
                <span className="mt-1 block text-xs text-amber-800">
                  Esta columna viene de la última vez que conciliaste esta
                  cuenta. Por el contenido de tu archivo parece que debería ser{" "}
                  <strong className="font-medium">{propuesta}</strong>.{" "}
                  <button
                    type="button"
                    onClick={() => setCampo(campo, propuesta)}
                    className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800"
                  >
                    Usar {propuesta}
                  </button>
                </span>
              ) : (
                dudas.length > 0 && (
                  <span className="mt-1 block text-xs text-amber-800">
                    También podría ser{" "}
                    {dudas.map((h, i) => (
                      <span key={h}>
                        {i > 0 && " o "}
                        <strong className="font-medium">{h}</strong>
                      </span>
                    ))}
                    . Compruébalo en la vista previa.
                  </span>
                )
              )}
            </label>
          );
        })}
      </div>

      {/* vista previa interpretada */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-neutral-700">
            Vista previa interpretada
          </p>
          <p className="text-xs text-neutral-500">
            {total.toLocaleString("es-PE")} filas válidas
            {invalidas > 0 && (
              <span className="text-amber-600"> · {invalidas} se omitirán</span>
            )}
          </p>
        </div>

        <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Monto</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Referencia</th>
                <th className="px-3 py-2 font-medium">
                  {variante === "internos" ? "Descripción" : "Glosa"}
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-4 text-center text-neutral-600"
                  >
                    Selecciona al menos Fecha y Monto para ver la vista previa.
                  </td>
                </tr>
              ) : (
                preview.map((f, i) => {
                  const esInterno = "id_interno" in f;
                  const ref = esInterno
                    ? f.referencia
                    : (f as { referencia_banco?: string | null })
                        .referencia_banco;
                  const desc = esInterno
                    ? (f as { descripcion?: string | null }).descripcion
                    : (f as { glosa?: string | null }).glosa;
                  return (
                    <tr key={i} className="border-t border-neutral-100">
                      <td className="px-3 py-2">{formatearFecha(f.fecha)}</td>
                      <td
                        className={[
                          "px-3 py-2 tabular-nums",
                          f.monto < 0 ? "text-red-600" : "text-emerald-700",
                        ].join(" ")}
                      >
                        {formatearPEN(f.monto, moneda)}
                      </td>
                      <td className="px-3 py-2">{f.tipo}</td>
                      <td className="px-3 py-2">{ref ?? "—"}</td>
                      <td className="px-3 py-2">{desc ?? "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
