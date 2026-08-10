"use client";

import { useRef, useState, useTransition } from "react";
import { DocumentoIcon, CheckIcon } from "./icons";
import { Boton } from "@/components/ui";
import { quitarComprobantesDelPeriodo } from "@/app/(app)/wizard/actions";
import { formatearPEN } from "@/lib/parsing/resumen";
import { descargarPlantilla } from "@/lib/plantilla";
import { leerCabecera } from "@/lib/parsing/leerArchivo";
import { esPlantilla } from "@/lib/parsing/mapeoComprobantes";
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
}: {
  resumen: ResumenComprobantes | null;
  periodo: { desde: string; hasta: string } | null;
  moneda: string;
  onCambio: () => void;
  /** La empresa ya confirmó con qué columnas viene su archivo. */
  mapeoConfigurado?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, startSubida] = useTransition();
  const [quitando, setQuitando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  /** Solo para explicar la espera: por encima de esto lo lee el servidor. */
  const [grande, setGrande] = useState(false);

  const subir = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setAviso(null);
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
      if (!mapeoConfigurado) {
        try {
          const { headers } = await leerCabecera(file, 5);
          if (headers.length > 0 && !esPlantilla(headers)) {
            setError(
              "Las columnas de este archivo no son las de la plantilla. Ve a " +
                "Comprobantes y súbelo ahí: podrás indicar qué columna es cada " +
                "cosa, se guarda, y a partir de entonces podrás subirlo desde aquí.",
            );
            return;
          }
        } catch {
          // Si no se puede leer la cabecera, que lo intente el servidor.
        }
      }

      const cuerpo = new FormData();
      cuerpo.append("archivo", file);
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
      </div>
      {mensajes}
      {input}
    </div>
  );
}

/**
 * "¿No tienes sistema? Usa la plantilla" — solo la descarga.
 *
 * Subir la plantilla llena ya vive dentro de `ZonaComprobantes`, que es donde
 * uno la busca; aquí queda el paso previo, el de quien todavía no tiene un
 * archivo que soltar. Dejar los dos botones juntos abajo era lo que rompía la
 * simetría de la pantalla.
 */
export function AyudaPlantilla() {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-sm font-medium text-neutral-800">
        ¿No tienes sistema? Usa la plantilla
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        Descárgala, llénala con tus cobranzas y pagos, y súbela arriba en
        «Comprobantes del período».
      </p>
      <button
        type="button"
        onClick={() => void descargarPlantilla()}
        className="mt-3 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
      >
        Descargar plantilla
      </button>
    </div>
  );
}
