"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Stepper, type PasoWizard } from "./Stepper";
import { UploadZone, type ArchivoResumen } from "./UploadZone";
import { ImportadorComprobantes } from "./ImportadorComprobantes";
import { MapeoDataset } from "./MapeoDataset";
import { CandadoIcon, ChevronIcon } from "./icons";
import { createClient } from "@/lib/supabase/client";
import { mesesRecientes } from "@/lib/periodo";
import { procesarArchivo, type ArchivoProcesado } from "@/lib/parsing/procesar";
import { validarCoherencia } from "@/lib/parsing/coherencia";
import { formatearPEN, formatearFecha } from "@/lib/parsing/resumen";
import type { MapeoColumnas } from "@/lib/parsing/deteccion";
import {
  normalizarInternos,
  normalizarBancarios,
} from "@/lib/normalizacion/canonico";
import {
  guardarMapeoCuenta,
  getComprobantesCanonicos,
} from "@/app/(app)/wizard/actions";
import type {
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";

export type CuentaOpcion = {
  id: string;
  banco: string;
  numero_enmascarado: string | null;
  moneda: string;
  mapeo_columnas: {
    internos?: MapeoColumnas;
    extracto?: MapeoColumnas;
  } | null;
};

type Fuente = "archivo" | "comprobantes" | "sistema";

const OPCIONES_MES = mesesRecientes(12);

function mapeoAplicable(m: MapeoColumnas, headers: string[]): boolean {
  const valores = Object.values(m);
  return valores.length > 0 && valores.every((h) => headers.includes(h!));
}

/** Prefiere el mapeo guardado (memoria) si aplica a estos encabezados. */
function elegirMapeo(
  detectado: MapeoColumnas,
  guardado: MapeoColumnas | undefined,
  headers: string[],
): MapeoColumnas {
  if (guardado && mapeoAplicable(guardado, headers)) return { ...guardado };
  return { ...detectado };
}

function tieneFechaYMonto(m: MapeoColumnas): boolean {
  return Boolean(m.fecha) && Boolean(m.monto);
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
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
          {children}
        </select>
        <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-neutral-400" />
      </div>
    </label>
  );
}

function resumenParaZona(p: ArchivoProcesado, moneda: string): ArchivoResumen {
  if (p.formato !== "excel" || !p.resumen) {
    return {
      nombre: p.nombre,
      total:
        p.formato === "pdf" ? "PDF · se procesará al conciliar" : undefined,
    };
  }
  const r = p.resumen;
  return {
    nombre: p.nombre,
    registros: r.registros,
    total: formatearPEN(r.sumaTotal, moneda),
    rangoFechas:
      r.fechaMin && r.fechaMax
        ? `${formatearFecha(r.fechaMin)} – ${formatearFecha(r.fechaMax)}`
        : undefined,
  };
}

export function WizardContainer({ cuentas }: { cuentas: CuentaOpcion[] }) {
  const [paso, setPaso] = useState<PasoWizard>(1);

  const [periodoValor, setPeriodoValor] = useState(
    OPCIONES_MES[1]?.valor ?? OPCIONES_MES[0]!.valor,
  );
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id ?? "");
  const [fuente, setFuente] = useState<Fuente>("archivo");

  const [internos, setInternos] = useState<ArchivoProcesado | null>(null);
  const [extracto, setExtracto] = useState<ArchivoProcesado | null>(null);
  const [mapeoInternos, setMapeoInternos] = useState<MapeoColumnas>({});
  const [mapeoExtracto, setMapeoExtracto] = useState<MapeoColumnas>({});

  const [comprobantesResumen, setComprobantesResumen] = useState<{
    registros: number;
    suma: number;
  } | null>(null);
  const [recargaComprobantes, setRecargaComprobantes] = useState(0);

  const [saldoLibros, setSaldoLibros] = useState("");
  const [saldoExtIni, setSaldoExtIni] = useState("");
  const [saldoExtFin, setSaldoExtFin] = useState("");

  // Resultados canónicos (para Paso 3 / envío a n8n en Fase 5).
  const [internosCanon, setInternosCanon] = useState<RegistroInterno[]>([]);
  const [bancariosCanon, setBancariosCanon] = useState<MovimientoBancario[]>(
    [],
  );

  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [procesando, startTransition] = useTransition();

  const periodo = useMemo(
    () => OPCIONES_MES.find((o) => o.valor === periodoValor) ?? OPCIONES_MES[0]!,
    [periodoValor],
  );
  const cuenta = cuentas.find((c) => c.id === cuentaId);
  const moneda = cuenta?.moneda ?? "PEN";

  const coherenciaInternos = useMemo(
    () =>
      internos?.resumen
        ? validarCoherencia(internos.resumen.fechasISO, periodo)
        : null,
    [internos, periodo],
  );
  const coherenciaExtracto = useMemo(
    () =>
      extracto?.resumen
        ? validarCoherencia(extracto.resumen.fechasISO, periodo)
        : null,
    [extracto, periodo],
  );

  useEffect(() => {
    if (fuente !== "comprobantes") return;
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("comprobantes")
        .select("monto")
        .gte("fecha", periodo.desde)
        .lte("fecha", periodo.hasta);
      if (cancelado) return;
      const filas = data ?? [];
      const suma = filas.reduce(
        (acc, r) => acc + Math.abs(Number(r.monto ?? 0)),
        0,
      );
      setComprobantesResumen({ registros: filas.length, suma });
    })();
    return () => {
      cancelado = true;
    };
  }, [fuente, periodo, recargaComprobantes]);

  async function cargarInternos(file: File) {
    const proc = await procesarArchivo(file, periodo);
    setInternos(proc);
    setMapeoInternos(
      elegirMapeo(proc.mapeo, cuenta?.mapeo_columnas?.internos, proc.headers),
    );
  }
  async function cargarExtracto(file: File) {
    const proc = await procesarArchivo(file, periodo);
    setExtracto(proc);
    setMapeoExtracto(
      elegirMapeo(proc.mapeo, cuenta?.mapeo_columnas?.extracto, proc.headers),
    );
  }

  const usaArchivoInternos = fuente === "archivo";
  const internosListo = usaArchivoInternos
    ? internos != null
    : fuente === "comprobantes"
      ? (comprobantesResumen?.registros ?? 0) > 0
      : false;
  const extractoListo = extracto != null;

  const puedeContinuarPaso1 =
    Boolean(cuentaId) &&
    internosListo &&
    extractoListo &&
    saldoLibros.trim() !== "";

  // Paso 2: validar que los mapeos aplicables tengan fecha + monto.
  const extractoEsExcel = extracto?.formato === "excel";
  const mapeoInternosOk = !usaArchivoInternos || tieneFechaYMonto(mapeoInternos);
  const mapeoExtractoOk = !extractoEsExcel || tieneFechaYMonto(mapeoExtracto);
  const puedeContinuarPaso2 = mapeoInternosOk && mapeoExtractoOk;

  function irAPaso2() {
    setAviso(null);
    setError(null);
    setPaso(2);
  }

  function confirmarPaso2() {
    setError(null);
    startTransition(async () => {
      // Registros internos canónicos.
      let internosOut: RegistroInterno[] = [];
      if (usaArchivoInternos && internos) {
        internosOut = normalizarInternos(internos.filas, mapeoInternos).filas;
      } else if (fuente === "comprobantes") {
        internosOut = await getComprobantesCanonicos(
          periodo.desde,
          periodo.hasta,
        );
      }

      // Movimientos bancarios canónicos (solo si el extracto es Excel/CSV; el
      // PDF se procesa en n8n).
      const bancariosOut = extractoEsExcel
        ? normalizarBancarios(extracto!.filas, mapeoExtracto).filas
        : [];

      if (internosOut.length === 0) {
        setError("No hay registros internos válidos para conciliar.");
        return;
      }

      // Guardar memoria de mapeos en la cuenta.
      if (cuentaId) {
        await guardarMapeoCuenta(cuentaId, {
          internos: usaArchivoInternos ? mapeoInternos : undefined,
          extracto: extractoEsExcel ? mapeoExtracto : undefined,
        });
      }

      setInternosCanon(internosOut);
      setBancariosCanon(bancariosOut);
      setPaso(3);
    });
  }

  return (
    <div className="w-full max-w-3xl rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <Stepper actual={paso} />

      {/* ─────────────────────────── PASO 1 ─────────────────────────── */}
      {paso === 1 && (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Período a conciliar"
              value={periodoValor}
              onChange={setPeriodoValor}
            >
              {OPCIONES_MES.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </SelectField>

            {cuentas.length > 0 ? (
              <SelectField
                label="Cuenta bancaria"
                value={cuentaId}
                onChange={setCuentaId}
              >
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.banco} {c.numero_enmascarado ?? ""} ·{" "}
                    {c.moneda === "USD" ? "USD" : "PEN"}
                  </option>
                ))}
              </SelectField>
            ) : (
              <div>
                <span className="mb-1.5 block text-sm font-medium text-neutral-700">
                  Cuenta bancaria
                </span>
                <Link
                  href="/cuentas"
                  className="flex h-12 items-center justify-center rounded-xl border border-dashed border-neutral-300 text-sm font-medium text-blue-600 hover:bg-neutral-50"
                >
                  + Agregar una cuenta bancaria
                </Link>
              </div>
            )}
          </div>

          <div className="mt-6">
            <span className="mb-2 block text-sm font-medium text-neutral-700">
              Registros internos (cobranzas y pagos)
            </span>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { v: "archivo", label: "Subir archivo" },
                  { v: "comprobantes", label: "Usar mis comprobantes" },
                  { v: "sistema", label: "Conectar sistema" },
                ] as { v: Fuente; label: string }[]
              ).map((op) => {
                const activo = fuente === op.v;
                const deshabilitado = op.v === "sistema";
                return (
                  <button
                    key={op.v}
                    type="button"
                    disabled={deshabilitado}
                    onClick={() => setFuente(op.v)}
                    className={[
                      "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                      activo
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-neutral-300 text-neutral-700 hover:bg-neutral-50",
                      deshabilitado ? "cursor-not-allowed opacity-50" : "",
                    ].join(" ")}
                  >
                    {op.label}
                    {deshabilitado && " · próximamente"}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              {usaArchivoInternos && (
                <UploadZone
                  titulo="Registros internos"
                  icono="documento"
                  formatos="Excel o CSV"
                  accept=".xlsx,.xls,.csv"
                  resumen={internos ? resumenParaZona(internos, moneda) : null}
                  onArchivo={cargarInternos}
                />
              )}
              {fuente === "comprobantes" && (
                <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                  <p className="font-semibold text-neutral-900">
                    Comprobantes del período
                  </p>
                  {comprobantesResumen ? (
                    <p className="mt-1 text-sm text-neutral-600">
                      {comprobantesResumen.registros.toLocaleString("es-PE")}{" "}
                      registros ·{" "}
                      {formatearPEN(comprobantesResumen.suma, moneda)}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-neutral-500">Cargando…</p>
                  )}
                  {comprobantesResumen?.registros === 0 && (
                    <p className="mt-1 text-sm text-amber-600">
                      No hay comprobantes en este período. Impórtalos abajo.
                    </p>
                  )}
                </div>
              )}
              {coherenciaInternos?.advertir && usaArchivoInternos && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  ⚠️ {coherenciaInternos.mensaje}
                </p>
              )}
            </div>

            <div>
              <UploadZone
                titulo="Extracto bancario"
                icono="banco"
                formatos="Excel, CSV o PDF"
                bancos="BCP, BBVA, Interbank, Scotiabank"
                accept=".xlsx,.xls,.csv,.pdf"
                resumen={extracto ? resumenParaZona(extracto, moneda) : null}
                onArchivo={cargarExtracto}
              />
              {coherenciaExtracto?.advertir && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  ⚠️ {coherenciaExtracto.mensaje}
                </p>
              )}
            </div>
          </div>

          {fuente === "comprobantes" && (
            <div className="mt-4">
              <ImportadorComprobantes
                onImportado={() => setRecargaComprobantes((n) => n + 1)}
              />
            </div>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-neutral-700">
                Saldo según libros (final)
              </span>
              <input
                inputMode="decimal"
                value={saldoLibros}
                onChange={(e) => setSaldoLibros(e.target.value)}
                placeholder="0.00"
                className="h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-neutral-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-neutral-700">
                Saldo extracto inicial
              </span>
              <input
                inputMode="decimal"
                value={saldoExtIni}
                onChange={(e) => setSaldoExtIni(e.target.value)}
                placeholder="opcional"
                className="h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-neutral-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-neutral-700">
                Saldo extracto final
              </span>
              <input
                inputMode="decimal"
                value={saldoExtFin}
                onChange={(e) => setSaldoExtFin(e.target.value)}
                placeholder="opcional"
                className="h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-neutral-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
              />
            </label>
          </div>

          <div className="mt-8 flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm text-neutral-500">
              <CandadoIcon className="h-4 w-4" />
              Tus archivos se procesan de forma segura
            </span>
            <button
              type="button"
              disabled={!puedeContinuarPaso1}
              onClick={irAPaso2}
              className="rounded-xl bg-neutral-900 px-6 py-3 font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              Continuar
            </button>
          </div>
        </>
      )}

      {/* ─────────────────────────── PASO 2 ─────────────────────────── */}
      {paso === 2 && (
        <>
          <div className="mt-8 space-y-4">
            {usaArchivoInternos && internos && (
              <MapeoDataset
                titulo="Registros internos"
                variante="internos"
                headers={internos.headers}
                filas={internos.filas}
                mapeo={mapeoInternos}
                moneda={moneda}
                onChange={setMapeoInternos}
              />
            )}

            {fuente === "comprobantes" && (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-600">
                Tus comprobantes registrados ya están estructurados, no
                requieren mapeo de columnas.
              </div>
            )}

            {extractoEsExcel && extracto ? (
              <MapeoDataset
                titulo="Extracto bancario"
                variante="extracto"
                headers={extracto.headers}
                filas={extracto.filas}
                mapeo={mapeoExtracto}
                moneda={moneda}
                onChange={setMapeoExtracto}
              />
            ) : (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-600">
                El extracto es un PDF: sus columnas se interpretarán durante la
                conciliación (n8n).
              </div>
            )}
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-8 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setPaso(1)}
              className="rounded-xl border border-neutral-300 px-5 py-3 font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Atrás
            </button>
            <button
              type="button"
              disabled={!puedeContinuarPaso2 || procesando}
              onClick={confirmarPaso2}
              className="rounded-xl bg-neutral-900 px-6 py-3 font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              {procesando ? "Preparando…" : "Está correcto, continuar"}
            </button>
          </div>
        </>
      )}

      {/* ─────────────────────────── PASO 3 ─────────────────────────── */}
      {paso === 3 && (
        <>
          <div className="mt-8 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                <p className="text-sm text-neutral-500">Registros internos</p>
                <p className="mt-1 text-2xl font-bold text-neutral-900">
                  {internosCanon.length.toLocaleString("es-PE")}
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                <p className="text-sm text-neutral-500">Movimientos bancarios</p>
                <p className="mt-1 text-2xl font-bold text-neutral-900">
                  {bancariosCanon.length.toLocaleString("es-PE")}
                  {!extractoEsExcel && (
                    <span className="ml-2 text-sm font-normal text-neutral-400">
                      (PDF)
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-600">
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-neutral-500">Período</dt>
                  <dd className="font-medium text-neutral-900">
                    {periodo.etiqueta}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Cuenta</dt>
                  <dd className="font-medium text-neutral-900">
                    {cuenta
                      ? `${cuenta.banco} ${cuenta.numero_enmascarado ?? ""}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Saldo libros (final)</dt>
                  <dd className="font-medium text-neutral-900">
                    {saldoLibros || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Saldo extracto final</dt>
                  <dd className="font-medium text-neutral-900">
                    {saldoExtFin || "—"}
                  </dd>
                </div>
              </dl>
            </div>

            <p className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
              Todo listo para conciliar. El envío a n8n y la pantalla de progreso
              en vivo se conectan en la Fase 5.
            </p>
          </div>

          <div className="mt-8 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setPaso(2)}
              className="rounded-xl border border-neutral-300 px-5 py-3 font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Atrás
            </button>
            <button
              type="button"
              disabled
              className="rounded-xl bg-neutral-900 px-6 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              Iniciar conciliación
            </button>
          </div>
        </>
      )}

      {aviso && (
        <p className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {aviso}
        </p>
      )}
    </div>
  );
}
