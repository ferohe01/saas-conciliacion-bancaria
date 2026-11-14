"use client";

import type { ReactNode } from "react";
import {
  ETIQUETA_COMPROBANTE,
  AYUDA_COMPROBANTE,
  OBLIGATORIOS,
  faltaEnConfig,
  resumirMuestra,
  type CampoComprobante,
  type Config,
  type TipoFijo,
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
 *
 * ⚠️ **Tres bloques por lo que pesa cada campo, no una cuadrícula de diez.**
 * Con los diez iguales, un "Tipo *" en «— sin columna —» parecía un error cuya
 * solución vivía en un recuadro muy por debajo. Ahora la declaración para todo
 * el archivo («Todo son cobranzas») es una opción del MISMO desplegable: la
 * respuesta está donde se hace la pregunta.
 */

const NUM = (n: number) => n.toLocaleString("es-PE");

const IMPRESCINDIBLES: CampoComprobante[] = ["fecha", "monto", "tipo"];
const PARA_CONCILIAR: CampoComprobante[] = [
  "serie_numero",
  "referencia_externa",
  "razon_social",
];
const OPCIONALES: CampoComprobante[] = [
  "moneda",
  "ruc_contraparte",
  "fecha_vencimiento",
  "descripcion",
];

/**
 * Valores del desplegable que no son una columna sino una declaración para
 * todo el archivo. El prefijo no puede chocar con una cabecera real: ningún
 * export trae una columna que se llame así.
 */
const FIJO = "__fijo:";

/** Declaraciones que ofrece cada campo cuando el archivo no trae la columna. */
const DECLARACIONES: Partial<Record<CampoComprobante, { v: string; label: string }[]>> = {
  tipo: [
    { v: "cobranza", label: "Todo el archivo son cobranzas" },
    { v: "pago", label: "Todo el archivo son pagos" },
  ],
  moneda: [
    { v: "PEN", label: "Todo está en soles (PEN)" },
    { v: "USD", label: "Todo está en dólares (USD)" },
  ],
};

/** Qué dice la opción vacía. En tipo hay que decidir; en moneda hay defecto. */
const VACIO: Partial<Record<CampoComprobante, string>> = {
  tipo: "— elige una opción —",
  moneda: "— sin columna: se cargan en soles —",
};

/** El valor declarado del campo, si lo hay. */
function fijoDe(config: Config, campo: CampoComprobante): string | null {
  if (campo === "tipo") return config.tipoFijo ?? null;
  if (campo === "moneda") return config.monedaFija ?? null;
  return null;
}

/** Cómo se lee lo elegido en un campo, para la frase de resumen. */
function descripcionDe(config: Config, campo: CampoComprobante): string | null {
  const fijo = fijoDe(config, campo);
  if (fijo) {
    return DECLARACIONES[campo]?.find((d) => d.v === fijo)?.label ?? fijo;
  }
  return config.mapeo[campo] ?? null;
}

function Campo({
  campo,
  headers,
  config,
  dudas,
  onCambio,
}: {
  campo: CampoComprobante;
  headers: string[];
  config: Config;
  dudas: string[];
  onCambio: (c: Config) => void;
}) {
  const obligatorio = OBLIGATORIOS.includes(campo);
  const ayuda = AYUDA_COMPROBANTE[campo];
  const declaraciones = DECLARACIONES[campo];
  const fijo = fijoDe(config, campo);
  const valor = fijo ? `${FIJO}${fijo}` : (config.mapeo[campo] ?? "");
  // Obligatorio y sin nada elegido: el único campo que bloquea se marca donde
  // está, no en un recuadro de más abajo.
  const pendiente = obligatorio && valor === "";

  const elegir = (v: string) => {
    const mapeo = { ...config.mapeo };
    let tipoFijo = config.tipoFijo ?? null;
    let monedaFija = config.monedaFija ?? null;
    // Elegir una declaración suelta la columna, y elegir una columna suelta la
    // declaración: la declaración manda sobre la columna, así que dejar las dos
    // haría que el desplegable enseñara una cosa y se aplicara la otra.
    const declarado = v.startsWith(FIJO) ? v.slice(FIJO.length) : null;
    if (declarado || v === "") delete mapeo[campo];
    else mapeo[campo] = v;
    if (campo === "tipo") tipoFijo = (declarado as TipoFijo | null) ?? null;
    if (campo === "moneda") monedaFija = declarado ?? null;
    onCambio({ ...config, mapeo, tipoFijo, monedaFija });
  };

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700">
        {ETIQUETA_COMPROBANTE[campo]}
        {obligatorio && <span className="text-red-600"> *</span>}
      </span>
      <select
        value={valor}
        onChange={(e) => elegir(e.target.value)}
        className={`h-11 w-full rounded-xl border bg-white px-3 text-sm text-neutral-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none ${
          pendiente ? "border-amber-400 ring-2 ring-amber-100" : "border-neutral-300"
        }`}
      >
        <option value="">{VACIO[campo] ?? "— sin columna —"}</option>
        {declaraciones && (
          <optgroup label="Mi archivo no trae esta columna">
            {declaraciones.map((d) => (
              <option key={d.v} value={`${FIJO}${d.v}`}>
                {d.label}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Columnas de tu archivo">
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </optgroup>
      </select>
      {ayuda && (
        <span className="mt-1 block text-xs text-neutral-500">{ayuda}</span>
      )}
      {/* ⚠️ El aviso de empate. La detección eligió entre varias columnas
          parecidas y puede haberse equivocado; en este archivo eso no da un
          error, da una conciliación al 0 % media hora después. Decir con qué
          dudó cuesta una línea y es la única pista que el usuario puede
          contrastar con la vista previa. */}
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
}

function Bloque({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 p-4">
      <h4 className="text-sm font-semibold text-neutral-900">{titulo}</h4>
      <p className="mt-0.5 text-xs text-neutral-500">{descripcion}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
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

  // Solo se avisa mientras siga puesta la columna que la detección eligió: en
  // cuanto el usuario toca el desplegable, ya decidió él y repetirle la duda es
  // ruido.
  const dudasDe = (campo: CampoComprobante) =>
    config.mapeo[campo] != null
      ? (alternativas?.[campo] ?? []).filter((h) => h !== config.mapeo[campo])
      : [];

  const campo = (c: CampoComprobante) => (
    <Campo
      key={c}
      campo={c}
      headers={headers}
      config={config}
      dudas={dudasDe(c)}
      onCambio={onCambio}
    />
  );

  // Lo que ya se entendió, para empezar por ahí y no por diez preguntas.
  const entendidos = [...IMPRESCINDIBLES, ...PARA_CONCILIAR].filter(
    (c) => descripcionDe(config, c) != null,
  );
  const opcionalesPuestos = OPCIONALES.filter(
    (c) => descripcionDe(config, c) != null,
  );
  // Lo que bloquea, dicho como pregunta y no como nombre de campo.
  const pendientes = IMPRESCINDIBLES.filter(
    (c) => descripcionDe(config, c) == null,
  ).map((c) =>
    c === "tipo"
      ? "si son cobranzas o pagos"
      : ETIQUETA_COMPROBANTE[c].toLowerCase(),
  );
  // Si la detección dudó en un opcional, el bloque se abre solo: plegar justo
  // lo que hay que revisar sería esconder el aviso.
  const abrirOpcionales = OPCIONALES.some((c) => dudasDe(c).length > 0);

  return (
    <div className="mt-4 space-y-4">
      <div>
        <h3 className="font-semibold text-neutral-900">
          ¿Qué columna es cada cosa?
        </h3>
        <p className="mt-1 text-sm text-neutral-600">
          {entendidos.length > 0 && (
            <>
              Ya reconocimos{" "}
              <strong>
                {entendidos
                  .map((c) => ETIQUETA_COMPROBANTE[c].toLowerCase())
                  .join(", ")}
              </strong>
              .{" "}
            </>
          )}
          {pendientes.length > 0 ? (
            <>
              Solo falta que nos digas{" "}
              <strong className="text-amber-800">{pendientes.join(" y ")}</strong>.
            </>
          ) : (
            <>Revisa la vista previa y pulsa «Importar».</>
          )}{" "}
          Se guarda: la próxima vez subes tu archivo tal cual y no se te
          pregunta nada.
        </p>
      </div>

      <Bloque
        titulo="Imprescindible"
        descripcion="Sin estos tres datos no se puede cargar la fila."
      >
        {IMPRESCINDIBLES.map(campo)}
      </Bloque>

      <Bloque
        titulo="Para conciliar bien"
        descripcion="No son obligatorios, pero de ellos depende que el banco y tus documentos casen."
      >
        {PARA_CONCILIAR.map(campo)}
      </Bloque>

      <details
        open={abrirOpcionales || undefined}
        className="group rounded-2xl border border-neutral-200 p-4"
      >
        <summary className="cursor-pointer list-none text-sm">
          <span className="font-semibold text-neutral-900">Opcional</span>
          <span className="ml-2 text-xs text-neutral-500">
            {opcionalesPuestos.length} de {OPCIONALES.length} indicados
            {/* La moneda es el único opcional con efecto si se deja vacío:
                decirlo en la línea plegada evita que sea una suposición
                invisible. */}
            {config.mapeo.moneda == null && config.monedaFija == null &&
              " · se cargarán en soles (PEN)"}
          </span>
          <span className="float-right text-xs text-blue-600 group-open:hidden">
            Mostrar
          </span>
          <span className="float-right hidden text-xs text-blue-600 group-open:inline">
            Ocultar
          </span>
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {OPCIONALES.map(campo)}
        </div>
      </details>

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
