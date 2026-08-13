"use client";

import {
  CAMPOS_COMPROBANTE,
  ETIQUETA_COMPROBANTE,
  AYUDA_COMPROBANTE,
  OBLIGATORIOS,
  faltaEnConfig,
  resumirMuestra,
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

const NUM = (n: number) => n.toLocaleString("es-PE");

/**
 * «Declara esto para todo el archivo»: la salida cuando el export no trae la
 * columna. La usan el tipo y la moneda, que fallan igual y por lo mismo.
 *
 * ⚠️ **«Usar la columna» se DESHABILITA cuando no hay columna mapeada.** Antes
 * salía seleccionada por defecto aunque no hubiera nada que usar, y eso dejaba
 * la pantalla en un estado muerto: las tres filas de la vista previa decían «se
 * omitiría», el botón estaba apagado, y la salida era un chip de más abajo que
 * nadie te había señalado. Una opción que no puede funcionar no debe poder
 * elegirse.
 *
 * ⚠️ Y NO se autoselecciona ninguna de las otras. Un libro de ventas son
 * cobranzas y uno de compras son pagos: elegir por el usuario sería una moneda
 * al aire que además mueve el dinero al lado equivocado.
 */
function DeclaracionArchivo<T extends string>({
  titulo,
  descripcion,
  hayColumna,
  valor,
  opciones,
  onElegir,
  aviso,
}: {
  titulo: string;
  descripcion: string;
  hayColumna: boolean;
  valor: T | null;
  opciones: { v: T; label: string }[];
  onElegir: (v: T | null) => void;
  /** Qué pasa si no se declara nada. `null` cuando declararlo es obligatorio. */
  aviso: string | null;
}) {
  // Sin columna y sin declaración no hay nada elegido: hay que decidir.
  const pendiente = !hayColumna && valor === null && aviso === null;

  return (
    <div
      className={`rounded-xl border p-4 ${
        pendiente
          ? "border-amber-300 bg-amber-50"
          : "border-neutral-200 bg-neutral-50"
      }`}
    >
      <p
        className={`text-sm font-medium ${
          pendiente ? "text-amber-900" : "text-neutral-800"
        }`}
      >
        {hayColumna ? titulo : `Tu archivo no trae la columna de ${titulo.toLowerCase()}`}
      </p>
      <p
        className={`mt-1 text-sm ${
          pendiente ? "text-amber-900" : "text-neutral-600"
        }`}
      >
        {pendiente ? "Dinos qué vale para todas las filas y podrás continuar." : descripcion}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!hayColumna}
          onClick={() => onElegir(null)}
          aria-pressed={hayColumna && valor === null}
          title={hayColumna ? undefined : "Tu archivo no trae esa columna"}
          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
            hayColumna && valor === null
              ? "border-neutral-800 bg-neutral-900 text-white"
              : hayColumna
                ? "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                : "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400"
          }`}
        >
          Usar la columna
        </button>
        {opciones.map((o) => {
          const activo = valor === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onElegir(o.v)}
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
      {/* Lo que pasa si no se declara nada. Callarlo convertiría un valor por
          defecto en una suposición invisible — que es justo el fallo que la
          moneda vino a corregir. */}
      {aviso && !hayColumna && valor === null && (
        <p className="mt-2 text-xs text-neutral-600">{aviso}</p>
      )}
    </div>
  );
}

export function MapeoComprobantesForm({
  headers,
  muestras,
  config,
  alternativas,
  onCambio,
  onConfirmar,
  onCancelar,
  moneda = "PEN",
  ocupado = false,
}: {
  headers: string[];
  muestras: Record<string, unknown>[];
  config: Config;
  /** Columnas que casi empataron con la detectada, por campo. */
  alternativas?: Partial<Record<CampoComprobante, string[]>>;
  onCambio: (c: Config) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
  moneda?: string;
  ocupado?: boolean;
}) {
  const falta = faltaEnConfig(config);
  // Sobre la muestra ENTERA, no sobre las tres primeras filas: en un export
  // contable el principio del archivo no es representativo y la previa acababa
  // diciendo "esta fila se omitiría" tres veces sobre un archivo correcto.
  const muestra = resumirMuestra(muestras, config);
  const omitidas = muestra.total - muestra.entran;

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
          // Solo se avisa mientras siga puesta la columna que la detección
          // eligió: en cuanto el usuario toca el desplegable, ya decidió él y
          // repetirle la duda es ruido.
          const dudas =
            config.mapeo[campo] != null
              ? (alternativas?.[campo] ?? []).filter(
                  (h) => h !== config.mapeo[campo],
                )
              : [];
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
              {/* ⚠️ El aviso de empate. La detección eligió entre varias
                  columnas parecidas y puede haberse equivocado; en este archivo
                  eso no da un error, da una conciliación al 0 % media hora
                  después. Decir con qué dudó cuesta una línea y es la única
                  pista que el usuario puede contrastar con la vista previa. */}
              {dudas.length > 0 && (
                <span className="mt-1 block text-xs text-amber-800">
                  También podría ser{" "}
                  {dudas.map((h, i) => (
                    <span key={h}>
                      {i > 0 && " o "}
                      <strong className="font-medium">{h}</strong>
                    </span>
                  ))}
                  . Compruébalo en la vista previa de abajo.
                </span>
              )}
            </label>
          );
        })}
      </div>

      <DeclaracionArchivo
        titulo="Tipo"
        descripcion="Si todo el archivo es de un solo tipo, decláralo aquí y se aplica a todas las filas."
        hayColumna={config.mapeo.tipo != null}
        valor={config.tipoFijo ?? null}
        opciones={[
          { v: "cobranza" as const, label: "Todo son cobranzas" },
          { v: "pago" as const, label: "Todo son pagos" },
        ]}
        onElegir={(v) => onCambio({ ...config, tipoFijo: v })}
        aviso={null}
      />

      <DeclaracionArchivo
        titulo="Moneda"
        descripcion="Solo se concilian comprobantes de la misma moneda que la cuenta bancaria. No se convierte nada."
        hayColumna={config.mapeo.moneda != null}
        valor={config.monedaFija ?? null}
        opciones={[
          { v: "PEN", label: "Todo en soles" },
          { v: "USD", label: "Todo en dólares" },
        ]}
        onElegir={(v) => onCambio({ ...config, monedaFija: v })}
        aviso="Si no indicas nada se cargarán como soles (PEN)."
      />

      {muestra.total > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-neutral-700">
            Así quedarían tus filas
          </p>

          {/* ⚠️ NINGUNA entra: eso sí es una alarma, y hasta ahora se confundía
              con la de arriba. Es el estado en que el mapeo está mal de verdad. */}
          {muestra.entran === 0 ? (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Con este formato no se cargaría <strong>ninguna</strong> de las{" "}
              {NUM(muestra.total)} filas que hemos leído
              {muestra.motivos[0] && <>: falta {muestra.motivos[0].falta.join(" y ")}</>}.
              Revisa las columnas de arriba.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-neutral-50 text-xs text-neutral-500">
                  <tr>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Importe</th>
                    <th className="px-3 py-2">Moneda</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Documento</th>
                    <th className="px-3 py-2">Referencia</th>
                    <th className="px-3 py-2">Contraparte</th>
                  </tr>
                </thead>
                <tbody>
                  {muestra.ejemplos.map((f, i) => (
                    <tr key={i} className="border-t border-neutral-100">
                      <td className="px-3 py-2 tabular-nums">
                        {formatearFecha(f.fecha)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatearPEN(f.monto, f.moneda)}
                      </td>
                      <td className="px-3 py-2">{f.moneda}</td>
                      <td className="px-3 py-2">{f.tipo}</td>
                      <td className="px-3 py-2">{f.serie_numero ?? "—"}</td>
                      <td className="px-3 py-2">{f.referencia_externa ?? "—"}</td>
                      <td className="px-3 py-2">{f.razon_social ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cuánto se queda fuera y por qué. Se dice TAMBIÉN cuando no se
              omite nada: un recuento que solo aparece con problemas deja sin
              saber si el silencio significa "correcto" o "no se miró". */}
          {muestra.entran > 0 && (
            <p
              className={`mt-2 text-sm ${
                omitidas > 0 ? "text-neutral-600" : "text-emerald-800"
              }`}
            >
              {omitidas > 0 ? (
                <>
                  De las {NUM(muestra.total)} filas que hemos leído,{" "}
                  <strong>{NUM(omitidas)} se omitirían</strong>
                  {muestra.motivos.slice(0, 2).map((m, i) => (
                    <span key={m.falta.join("|")}>
                      {i === 0 ? " (" : "; "}
                      {NUM(m.filas)} por falta de {m.falta.join(" y ")}
                      {i === Math.min(muestra.motivos.length, 2) - 1 ? ")" : ""}
                    </span>
                  ))}
                  . El resto se cargaría.
                </>
              ) : (
                <>✓ Las {NUM(muestra.total)} filas leídas se cargarían.</>
              )}
            </p>
          )}

          {/* ⚠️ La muestra NO es el archivo. Decir "132 de 452.605" a partir de
              las primeras filas sería inventarse una cifra. */}
          <p className="mt-1 text-xs text-neutral-500">
            Es una comprobación sobre el principio del archivo, no sobre las
            filas que se importarán.
          </p>
        </div>
      )}

      {/* ⚠️ Sin número de documento no hay IDENTIDAD, y sin identidad no se
          puede detectar que estás subiendo el mismo archivo otra vez: el índice
          único de la 0018 es parcial y las filas sin número entran siempre.
          Se puede continuar —hay ventas al contado sin documento— pero callarlo
          sería dejar que el cliente descubra la tabla duplicada por su cuenta. */}
      {!config.mapeo.serie_numero && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No has indicado el <strong>número de documento</strong>. Puedes
          continuar, pero sin él no podremos reconocer estas filas si vuelves a
          subir el mismo archivo: se cargarían por segunda vez. Si tu archivo
          trae un código único por fila (nº de operación, de recibo, de pago),
          indícalo ahí.
        </p>
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
