"use client";

import { useRef, useState, useTransition } from "react";
import { DocumentoIcon, CheckIcon } from "./icons";
import { Boton } from "@/components/ui";
import {
  quitarComprobantesDelPeriodo,
  guardarMapeoComprobantes,
} from "@/app/(app)/wizard/actions";
import { formatearPEN } from "@/lib/parsing/resumen";
import { descargarPlantilla } from "@/lib/plantilla";
import { leerCabecera } from "@/lib/parsing/leerArchivo";
import {
  esPlantilla,
  columnasFaltantes,
  type Config,
} from "@/lib/parsing/mapeoComprobantes";
import { detectarColumnasComprobante } from "@/lib/parsing/deteccionComprobantes";
import { MapeoComprobantesForm } from "@/components/comprobantes/MapeoComprobantesForm";
import type { ResumenComprobantes } from "@/app/(app)/wizard/actions";

/**
 * Comprobantes del período — el gemelo de `UploadZone`.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Los dos lados de una conciliación son simétricos —tus registros y los del
 * banco— pero la pantalla no lo era: el extracto tenía su zona de carga y los
 * comprobantes eran una tarjeta de texto cuyo botón de subir vivía en OTRO
 * bloque, más abajo, bajo el título "¿No tienes sistema? Usa la plantilla".
 *
 * Eso obligaba a leer toda la pantalla para descubrir dónde se cargan los
 * comprobantes, y rompía la lectura de "esto contra esto". Aquí cada lado tiene
 * su propia caja, con su carga dentro y la misma silueta.
 *
 * Comparte los dos estados de `UploadZone` —punteado cuando está vacío, verde
 * cuando hay datos— para que la simetría se vea también cuando ya cargaste.
 */

/** Por encima de esto no hay previsualización: el servidor lo lee por lotes. */
const AVISO_GRANDE = 8 * 1024 * 1024;

export function ZonaComprobantes({
  resumen,
  periodo,
  moneda,
  onCambio,
  mapeoConfigurado = false,
  archivoPropio = false,
  onMapeando,
  onRechazo,
}: {
  resumen: ResumenComprobantes | null;
  periodo: { desde: string; hasta: string } | null;
  moneda: string;
  onCambio: () => void;
  /** La empresa ya confirmó con qué columnas viene su archivo. */
  mapeoConfigurado?: boolean;
  /**
   * La empresa puede subir su propio formato (`modo_carga = archivo_propio`).
   * Sin esto se exige la plantilla, que es lo correcto para una PyME.
   */
  archivoPropio?: boolean;
  /** Avisa al wizard para darle a la tarjeta el ancho entero mientras se mapea. */
  onMapeando?: (activo: boolean) => void;
  /**
   * Columnas de la plantilla que faltan, o null al limpiarse. Lo pinta el
   * wizard a ancho completo: en media pantalla el aviso no se lee de una
   * pasada, y es el momento en que el usuario decide si esto le sirve.
   */
  onRechazo?: (faltan: string[] | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, startSubida] = useTransition();
  const [quitando, setQuitando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  /** Solo para explicar la espera: por encima de esto lo lee el servidor. */
  const [grande, setGrande] = useState(false);
  /**
   * Cuando el archivo no trae las columnas de la plantilla: qué es cada una.
   * Vive AQUÍ y no en otra pantalla — todo el paso de cargar comprobantes
   * ocurre en esta tarjeta.
   */
  const [mapeando, setMapeando] = useState<{
    archivo: File;
    headers: string[];
    muestras: Record<string, unknown>[];
    config: Config;
  } | null>(null);

  const subir = (file: File | undefined, config?: Config) => {
    if (!file) return;
    setError(null);
    setAviso(null);
    onRechazo?.(null);
    setGrande(file.size > AVISO_GRANDE);
    startSubida(async () => {
      // ⚠️ Se comprueba ANTES de subir, no después de fallar.
      //
      // Esta carga rápida no pregunta por las columnas: usa la plantilla, o el
      // formato que la empresa ya confirmó en Comprobantes. Con un archivo
      // ajeno y sin formato guardado, el servidor descartaría TODAS las filas y
      // el usuario leería "200 filas con datos incompletos" — un mensaje que
      // culpa a sus datos y no dice dónde arreglarlo.
      //
      // Aquí el mapeo es un acto de configuración que se hace una vez, así que
      // se señala el camino en vez de abrirlo a medias en esta tarjeta.
      // ── Modo plantilla: el archivo TIENE que traer sus columnas ───────────
      //
      // Es el caso normal de una PyME, y para ella la plantilla es mejor
      // producto: garantiza los datos limpios y no la obliga a distinguir el
      // "número de documento" de la "referencia de operación" —lo que más se
      // confunde—. Un mapeo mal elegido no da la cara al mapear, sino cuando la
      // conciliación no encuentra pareja.
      //
      // ⚠️ El rechazo dice QUÉ COLUMNAS faltan. "Este archivo no sirve" deja al
      // usuario comparando dos ficheros a mano.
      if (!archivoPropio) {
        try {
          const { headers } = await leerCabecera(file, 5);
          const faltan = columnasFaltantes(headers);
          if (headers.length > 0 && faltan.length > 0) {
            onRechazo?.(faltan);
            return;
          }
        } catch {
          // Si no se puede leer la cabecera, que decida el servidor.
        }
      }

      if (archivoPropio && !mapeoConfigurado && !config) {
        try {
          const { headers, filas } = await leerCabecera(file);
          if (headers.length > 0 && !esPlantilla(headers)) {
            // No es la plantilla: se pregunta aquí mismo qué columna es cada
            // cosa. Antes esto mandaba a otra pantalla, y tener DOS sitios
            // donde cargar comprobantes en el mismo paso confundía más de lo
            // que ayudaba.
            setMapeando({
              archivo: file,
              headers,
              muestras: filas,
              config: {
                mapeo: detectarColumnasComprobante(headers, filas),
                tipoFijo: null,
              },
            });
            onMapeando?.(true);
            return;
          }
        } catch {
          // Si no se puede leer la cabecera, que lo intente el servidor.
        }
      }

      // El formato se recuerda ANTES de importar: si la carga es larga y el
      // usuario cierra la pestaña, el aprendizaje ya quedó hecho.
      if (config) await guardarMapeoComprobantes(config);

      const cuerpo = new FormData();
      cuerpo.append("archivo", file);
      if (config) cuerpo.append("mapeo", JSON.stringify(config));
      try {
        const r = await fetch("/api/comprobantes/importar", {
          method: "POST",
          body: cuerpo,
        });
        const res = (await r.json()) as {
          ok?: boolean;
          error?: string;
          mensaje?: string;
        };
        if (!r.ok || !res.ok) {
          setError(res.error ?? "No se pudo importar.");
          return;
        }
        setAviso(res.mensaje ?? "Comprobantes importados.");
        setMapeando(null);
        onMapeando?.(false);
        onCambio();
      } catch {
        setError(
          "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
        );
      }
    });
  };

  const quitar = () => {
    if (!periodo) return;
    setError(null);
    setAviso(null);
    startSubida(async () => {
      const r = await quitarComprobantesDelPeriodo(periodo.desde, periodo.hasta);
      if (!r.ok) {
        setError(r.error ?? "No se pudieron quitar.");
        return;
      }
      setQuitando(false);
      // Lo protegido se dice siempre: sin eso, un "se quitaron 900 de 1.000"
      // parecería un fallo en vez de la regla que protege lo ya conciliado.
      setAviso(
        r.protegidos
          ? `Se quitaron ${(r.borrados ?? 0).toLocaleString("es-PE")}. ${r.protegidos.toLocaleString("es-PE")} se conservaron porque ya tienen cobros aplicados.`
          : `Se quitaron ${(r.borrados ?? 0).toLocaleString("es-PE")} comprobantes.`,
      );
      onCambio();
    });
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".xlsx,.xls,.csv"
      className="sr-only"
      onChange={(e) => {
        subir(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  const mensajes = (
    <>
      {aviso && (
        <p role="status" className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {aviso}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </>
  );

  // ── Mapeando: la tarjeta se convierte en el paso de "¿qué columna es qué?"
  //
  // Ocurre AQUÍ, no en otra pantalla. Tener dos sitios donde cargar
  // comprobantes dentro del mismo paso confundía más de lo que ayudaba.
  if (mapeando) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <DocumentoIcon className="mt-0.5 h-6 w-6 text-neutral-500" />
          <div className="min-w-0">
            <p className="font-semibold text-neutral-900">
              Comprobantes del período
            </p>
            <p className="mt-1 truncate text-sm text-neutral-600">
              {mapeando.archivo.name}
            </p>
          </div>
        </div>

        <MapeoComprobantesForm
          headers={mapeando.headers}
          muestras={mapeando.muestras}
          config={mapeando.config}
          moneda={moneda}
          ocupado={subiendo}
          onCambio={(config) => setMapeando({ ...mapeando, config })}
          onCancelar={() => {
            setMapeando(null);
            onMapeando?.(false);
          }}
          onConfirmar={() => subir(mapeando.archivo, mapeando.config)}
        />
        {mensajes}
      </div>
    );
  }

  // ── Con datos: misma tarjeta verde que el extracto cargado ───────────────
  if (resumen && resumen.registros > 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <DocumentoIcon className="mt-0.5 h-6 w-6 text-emerald-600" />
            <div>
              <p className="font-semibold text-emerald-900">
                Comprobantes del período
              </p>
              <p className="mt-1 text-sm tabular-nums text-emerald-800">
                {resumen.registros.toLocaleString("es-PE")} registros ·{" "}
                {resumen.sumaParcial && "desde "}
                {formatearPEN(resumen.suma, moneda)}
              </p>

              {/* Decir cuántos quedan fuera evita la alarma de "se perdieron
                  mis datos" y avisa de que quizá el mes no es el que el
                  usuario tenía en mente. */}
              {resumen.totalCargados > resumen.registros && (
                <p className="mt-1 text-xs text-emerald-700">
                  Tienes {resumen.totalCargados.toLocaleString("es-PE")} en
                  total; el resto es de otros períodos.
                </p>
              )}

              {/* Lo ya cobrado se queda fuera a propósito. Callarlo haría
                  pensar que faltan facturas. */}
              {resumen.yaCobrados > 0 && (
                <p className="mt-1 text-xs text-emerald-700">
                  {resumen.yaCobrados.toLocaleString("es-PE")} ya están cobrados
                  y no entran: se conciliaron antes.
                </p>
              )}
            </div>
          </div>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <CheckIcon className="h-4 w-4" />
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            disabled={subiendo}
            onClick={() => inputRef.current?.click()}
            className="text-sm font-medium text-emerald-700 underline-offset-2 hover:underline disabled:opacity-50"
          >
            {subiendo ? "Trabajando…" : "Añadir más comprobantes"}
          </button>

          {quitando ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-emerald-900">
                ¿Quitar los {resumen.registros.toLocaleString("es-PE")} de este
                período?
              </span>
              <Boton variante="peligro" tamano="sm" disabled={subiendo} onClick={quitar}>
                {subiendo ? "Quitando…" : "Sí, quitar"}
              </Boton>
              <Boton
                variante="secundario"
                tamano="sm"
                disabled={subiendo}
                onClick={() => setQuitando(false)}
              >
                No
              </Boton>
            </span>
          ) : (
            // Confirmación en dos pasos y sin escribir nada: volver a subir el
            // archivo deshace la operación.
            <button
              type="button"
              disabled={subiendo}
              onClick={() => setQuitando(true)}
              className="text-sm font-medium text-emerald-700 underline-offset-2 hover:text-red-700 hover:underline disabled:opacity-50"
            >
              Cancelar esta carga
            </button>
          )}
        </div>
        {mensajes}
        {input}
      </div>
    );
  }

  // ── Vacío: mismo punteado que el extracto ───────────────────────────────
  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          subir(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={[
          "flex h-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          arrastrando
            ? "border-blue-400 bg-blue-50"
            : "border-neutral-300 bg-white hover:border-neutral-400",
        ].join(" ")}
      >
        <DocumentoIcon className="h-8 w-8 text-neutral-500" />
        <p className="mt-3 font-semibold text-neutral-800">
          Comprobantes del período
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          {subiendo
            ? "Importando…"
            : resumen === null
              ? "Buscando los del período…"
              : "Arrastra el archivo o haz clic para buscar"}
          {subiendo && grande && " los archivos grandes tardan un poco"}
        </p>
        <span className="mt-4 inline-flex items-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50">
          Seleccionar archivo
        </span>
        <p className="mt-3 text-xs text-neutral-600">
          Excel o CSV · tus cobranzas y pagos del período
        </p>
        <p className="mt-1 text-xs text-neutral-600">
          Súbelo con las columnas que tenga: te preguntamos qué es cada una.
        </p>
      </div>

      {/* La plantilla, para quien no tiene ningún archivo que soltar. Va DENTRO
          de la tarjeta, debajo de su zona de carga: cuando vivía en un bloque
          aparte había dos sitios donde cargar comprobantes en el mismo paso, y
          eso confundía más de lo que ayudaba. */}
      <p className="mt-3 text-center text-xs text-neutral-600">
        ¿No tienes sistema?{" "}
        <button
          type="button"
          onClick={() => void descargarPlantilla()}
          className="rounded font-medium text-blue-700 underline underline-offset-2 transition-colors hover:text-blue-800"
        >
          Descarga la plantilla
        </button>{" "}
        y llénala.
      </p>

      {mensajes}
      {input}
    </div>
  );
}

/**
 * «Este archivo no tiene el formato esperado».
 *
 * ⚠️ Va **fuera** de la tarjeta y a ancho completo, debajo de las dos. Dentro de
 * media pantalla el texto se partía en seis líneas y los dos botones quedaban
 * apretados contra el borde: un rechazo tiene que leerse de una pasada, porque
 * es el momento en que el usuario decide si el sistema le sirve o no.
 *
 * ⚠️ Y trae la salida al lado. Decir «usa la plantilla» y dejar al usuario
 * buscándola convierte una regla razonable en un muro.
 */
export function AvisoSinPlantilla({
  faltan,
  onCerrar,
}: {
  faltan: string[];
  onCerrar: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900"
    >
      <p className="font-medium">Este archivo no tiene el formato esperado</p>
      <p className="mt-1 max-w-prose">
        Le {faltan.length === 1 ? "falta la columna" : "faltan las columnas"}{" "}
        <strong>{faltan.join(", ")}</strong>. Descarga la plantilla, copia ahí
        tus cobranzas y pagos, y súbela.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Boton
          tamano="sm"
          onClick={() => {
            void descargarPlantilla();
          }}
        >
          Descargar plantilla
        </Boton>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded text-sm font-medium text-amber-900 underline underline-offset-2"
        >
          Elegir otro archivo
        </button>
      </div>
      {/* La salida para quien SÍ exporta desde un ERP. Discreta a propósito:
          vive en Configuración y no en el flujo de carga, para que nadie acabe
          ahí por probar a ver qué pasa. */}
      <p className="mt-3 max-w-prose text-xs text-amber-800">
        ¿Tu sistema exporta a Excel o CSV con sus propias columnas? Puedes
        habilitarlo en Configuración en la opción → Cómo cargas tus
        comprobantes.
      </p>
    </div>
  );
}
