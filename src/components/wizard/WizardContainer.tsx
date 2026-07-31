"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Stepper, type PasoWizard } from "./Stepper";
import { UploadZone, type ArchivoResumen } from "./UploadZone";
import { ImportadorComprobantes } from "./ImportadorComprobantes";
import { MapeoDataset } from "./MapeoDataset";
import { CandadoIcon, ChevronIcon } from "./icons";
import { createClient } from "@/lib/supabase/client";
import { mesesRecientes } from "@/lib/periodo";
import { procesarArchivo, type ArchivoProcesado } from "@/lib/parsing/procesar";
import { detectarSaldoFinal } from "@/lib/parsing/saldo";
import { validarCoherencia } from "@/lib/parsing/coherencia";
import { formatearPEN, formatearFecha } from "@/lib/parsing/resumen";
import { normalizarMonto } from "@/lib/normalizacion/monto";
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
import { Boton, CLASES_ENTRADA } from "@/components/ui";

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
        <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-neutral-500" />
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
  const router = useRouter();
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
    /** Total cargado en la empresa, sin filtrar por período. */
    totalCargados: number;
    /** Del período, pero ya saldados: no entran a conciliar. */
    yaCobrados: number;
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
  const [cargando, setCargando] = useState<"internos" | "extracto" | null>(null);
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

  // Se consulta SIEMPRE, no solo cuando ya se eligió esa fuente: hace falta
  // saber si hay comprobantes en el período para poder avisar a quien está a
  // punto de subir un archivo y dejar, sin enterarse, el cobro sin aplicar.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      // Se pide también el TOTAL sin filtro de fecha: si el usuario cargó 5
      // comprobantes y en el período caen 2, decir solo "2 registros" parece
      // que se perdieron los otros. Saber que existen fuera del período evita
      // esa alarma —y también avisa de que quizá eligió el mes equivocado.
      const [{ data }, { count: total }, { count: yaCobrados }] =
        await Promise.all([
          // Mismo criterio que `getComprobantesCanonicos`: lo saldado y lo
          // anulado no entra, así que tampoco debe contarse aquí.
          supabase
            .from("comprobantes")
            .select("monto")
            .gte("fecha", periodo.desde)
            .lte("fecha", periodo.hasta)
            .not("estado", "in", "(cobrado,anulado)"),
          supabase
            .from("comprobantes")
            .select("id", { count: "exact", head: true }),
          // Los que caen en el período pero ya se cobraron: hay que decir que
          // se dejan fuera, o parecerá que faltan.
          supabase
            .from("comprobantes")
            .select("id", { count: "exact", head: true })
            .gte("fecha", periodo.desde)
            .lte("fecha", periodo.hasta)
            .eq("estado", "cobrado"),
        ]);
      if (cancelado) return;
      const filas = data ?? [];
      const suma = filas.reduce(
        (acc, r) => acc + Math.abs(Number(r.monto ?? 0)),
        0,
      );
      setComprobantesResumen({
        registros: filas.length,
        suma,
        totalCargados: total ?? filas.length,
        yaCobrados: yaCobrados ?? 0,
      });
    })();
    return () => {
      cancelado = true;
    };
  }, [periodo, recargaComprobantes]);

  /**
   * Un archivo ilegible (corrupto, protegido con contraseña, .xls antiguo) hace
   * que `procesarArchivo` lance. Sin este try/catch la promesa se rechazaba sin
   * dueño y la pantalla se quedaba idéntica: el usuario no sabía si su archivo
   * había entrado o no.
   */
  async function cargarInternos(file: File) {
    setError(null);
    setCargando("internos");
    try {
      const proc = await procesarArchivo(file, periodo);
      setInternos(proc);
      setMapeoInternos(
        elegirMapeo(proc.mapeo, cuenta?.mapeo_columnas?.internos, proc.headers),
      );
    } catch {
      setInternos(null);
      setError(
        `No pudimos leer "${file.name}". Revisa que sea un Excel o CSV sin contraseña y vuelve a intentarlo.`,
      );
    } finally {
      setCargando(null);
    }
  }

  async function cargarExtracto(file: File) {
    setError(null);
    setCargando("extracto");
    try {
      const proc = await procesarArchivo(file, periodo);
      setExtracto(proc);
      setMapeoExtracto(
        elegirMapeo(proc.mapeo, cuenta?.mapeo_columnas?.extracto, proc.headers),
      );
      // Autodetectar el saldo final del extracto (columna de saldo/balance).
      if (proc.formato === "excel" && saldoExtFin.trim() === "") {
        const detectado = detectarSaldoFinal(proc.headers, proc.filas);
        if (detectado != null) setSaldoExtFin(String(detectado));
      }
    } catch {
      setExtracto(null);
      setError(
        `No pudimos leer "${file.name}". Si es el extracto de tu banco, descárgalo en Excel, CSV o PDF y vuelve a subirlo.`,
      );
    } finally {
      setCargando(null);
    }
  }

  const usaArchivoInternos = fuente === "archivo";
  const internosListo = usaArchivoInternos
    ? internos != null
    : fuente === "comprobantes"
      ? (comprobantesResumen?.registros ?? 0) > 0
      : false;
  const extractoListo = extracto != null;

  // Un botón deshabilitado sin explicación es un callejón sin salida: la lista
  // dice exactamente qué falta.
  const faltaPaso1 = [
    !cuentaId && "elegir una cuenta bancaria",
    !internosListo &&
      (fuente === "comprobantes"
        ? "tener comprobantes en el período"
        : "subir tus registros internos"),
    !extractoListo && "subir el extracto del banco",
    saldoLibros.trim() === "" && "ingresar el saldo según libros",
  ].filter((x): x is string => Boolean(x));

  const puedeContinuarPaso1 = faltaPaso1.length === 0;

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

  const puedeIniciar =
    internosCanon.length > 0 && bancariosCanon.length > 0 && Boolean(cuentaId);
  const saldoExtractoFaltante =
    normalizarMonto(saldoExtFin) == null && normalizarMonto(saldoExtIni) == null;

  // El resumen del Paso 3 muestra el monto ya formateado, no la cadena cruda
  // que tecleó el usuario: es la última pantalla antes de disparar el motor.
  const montoVista = (v: string) => {
    const n = normalizarMonto(v);
    return n == null ? "—" : formatearPEN(n, moneda);
  };
  const saldoLibrosVista = montoVista(saldoLibros);
  const saldoExtFinVista = montoVista(saldoExtFin);

  function iniciarConciliacion() {
    setError(null);
    const saldoLibrosNum = normalizarMonto(saldoLibros);
    if (saldoLibrosNum == null) {
      setError("Ingresa un saldo según libros válido en el Paso 1.");
      return;
    }
    // Saldo extracto final: el ingresado, o (si falta) inicial + suma de
    // movimientos bancarios del período.
    const extIni = normalizarMonto(saldoExtIni);
    let extFin = normalizarMonto(saldoExtFin);
    if (extFin == null && extIni != null) {
      const sumaMov = bancariosCanon.reduce((a, m) => a + m.monto, 0);
      extFin = Number((extIni + sumaMov).toFixed(2));
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/conciliacion/iniciar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cuenta_id: cuentaId,
            periodo: { desde: periodo.desde, hasta: periodo.hasta },
            saldos: {
              saldo_libros_final: saldoLibrosNum,
              saldo_extracto_inicial: extIni,
              saldo_extracto_final: extFin,
            },
            registros_internos: internosCanon,
            movimientos_bancarios: bancariosCanon,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(data.error ?? "No se pudo iniciar la conciliación.");
          return;
        }
        const data = (await res.json()) as { job_id: string };
        router.push(`/conciliacion/${data.job_id}`);
      } catch {
        setError(
          "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
        );
      }
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

          {/* Grupo de radios real: con `<button>` el lector de pantalla no
              anunciaba cuál estaba elegido, y la opción deshabilitada
              ("próximamente") no era alcanzable con teclado. */}
          <fieldset className="mt-6">
            <legend className="mb-2 text-sm font-medium text-neutral-700">
              ¿De dónde salen tus registros internos?
            </legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { v: "archivo", label: "Subir archivo" },
                  { v: "comprobantes", label: "Usar mis comprobantes" },
                  { v: "sistema", label: "Conectar sistema" },
                ] as { v: Fuente; label: string }[]
              ).map((op) => {
                const activo = fuente === op.v;
                const proximamente = op.v === "sistema";
                return (
                  <label
                    key={op.v}
                    className={[
                      "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                      "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-500",
                      activo
                        ? "border-blue-600 bg-blue-50 text-blue-800"
                        : "border-neutral-300 text-neutral-700 hover:bg-neutral-50",
                      proximamente ? "cursor-not-allowed text-neutral-500" : "",
                    ].join(" ")}
                  >
                    <input
                      type="radio"
                      name="fuente-internos"
                      value={op.v}
                      checked={activo}
                      disabled={proximamente}
                      onChange={() => setFuente(op.v)}
                      className="sr-only"
                    />
                    {op.label}
                    {proximamente && (
                      <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-xs font-normal text-neutral-600">
                        próximamente
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            {/* Subir un archivo cuando hay comprobantes registrados en el
                período rompe el bucle de cobranzas sin que nadie se entere: el
                resultado se ve idéntico en pantalla, pero ningún comprobante
                queda cobrado y el saldo no se mueve nunca. Es una decisión con
                consecuencias invisibles, así que se explica antes de tomarla. */}
            {fuente === "archivo" && (comprobantesResumen?.registros ?? 0) > 0 && (
              <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-sm text-blue-900">
                  Tienes{" "}
                  <span className="font-semibold tabular-nums">
                    {comprobantesResumen!.registros.toLocaleString("es-PE")}
                  </span>{" "}
                  {comprobantesResumen!.registros === 1
                    ? "comprobante registrado"
                    : "comprobantes registrados"}{" "}
                  en este período. Si los usas como origen, al aprobar la
                  conciliación se descontará su saldo y sabrás qué te queda por
                  cobrar. Con un archivo eso no ocurre.
                </p>
                <button
                  type="button"
                  onClick={() => setFuente("comprobantes")}
                  className="mt-2 min-h-9 rounded-lg px-2 text-sm font-medium text-blue-800 underline underline-offset-2 transition-colors hover:bg-blue-100 hover:text-blue-900"
                >
                  Usar mis comprobantes
                </button>
              </div>
            )}
          </fieldset>

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
                    <>
                      <p className="mt-1 text-sm text-neutral-600">
                        {comprobantesResumen.registros.toLocaleString("es-PE")}{" "}
                        registros ·{" "}
                        {formatearPEN(comprobantesResumen.suma, moneda)}
                      </p>
                      {/* Decir cuántos quedan fuera evita la alarma de "se
                          perdieron mis datos" y avisa de que quizá el mes
                          elegido no es el que el usuario tenía en mente. */}
                      {comprobantesResumen.totalCargados >
                        comprobantesResumen.registros && (
                        <p className="mt-1 text-sm text-neutral-500">
                          Tienes{" "}
                          <span className="tabular-nums">
                            {comprobantesResumen.totalCargados.toLocaleString("es-PE")}
                          </span>{" "}
                          comprobantes cargados en total; el resto es de otros
                          períodos. Cambia el mes si buscabas esos.
                        </p>
                      )}
                      {/* Lo ya cobrado se queda fuera a propósito. Callarlo
                          haría pensar que faltan facturas; decirlo convierte
                          una ausencia sospechosa en una decisión entendible. */}
                      {comprobantesResumen.yaCobrados > 0 && (
                        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                          <span className="font-medium tabular-nums">
                            {comprobantesResumen.yaCobrados.toLocaleString("es-PE")}
                          </span>{" "}
                          {comprobantesResumen.yaCobrados === 1
                            ? "comprobante de este período ya está cobrado y no entra"
                            : "comprobantes de este período ya están cobrados y no entran"}
                          : se conciliaron antes. Así no se descuenta su saldo
                          dos veces.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-neutral-500">Cargando…</p>
                  )}
                  {comprobantesResumen?.registros === 0 && (
                    <p className="mt-1 text-sm text-amber-600">
                      No hay comprobantes en este período. Impórtalos abajo o
                      elige otro mes.
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
                className={`${CLASES_ENTRADA} tabular-nums`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-neutral-700">
                Saldo extracto inicial
                <span className="text-xs font-normal text-neutral-500">
                  opcional
                </span>
              </span>
              <input
                inputMode="decimal"
                value={saldoExtIni}
                onChange={(e) => setSaldoExtIni(e.target.value)}
                placeholder="0.00"
                className={`${CLASES_ENTRADA} tabular-nums`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-neutral-700">
                Saldo extracto final
                <span className="text-xs font-normal text-neutral-500">
                  para el cuadre
                </span>
              </span>
              <input
                inputMode="decimal"
                value={saldoExtFin}
                onChange={(e) => setSaldoExtFin(e.target.value)}
                placeholder="se autodetecta"
                className={`${CLASES_ENTRADA} tabular-nums`}
              />
            </label>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </p>
          )}

          {!puedeContinuarPaso1 && !error && (
            <p className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
              Para continuar falta {faltaPaso1.join(", ")}.
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm text-neutral-600">
              <CandadoIcon className="h-4 w-4" />
              Tus archivos se procesan de forma segura
            </span>
            <Boton
              tamano="lg"
              disabled={!puedeContinuarPaso1 || cargando !== null}
              onClick={irAPaso2}
            >
              {cargando ? "Leyendo el archivo…" : "Continuar"}
            </Boton>
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
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </p>
          )}

          {!puedeContinuarPaso2 && !error && (
            <p className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
              Marca al menos la columna de <strong>fecha</strong> y la de{" "}
              <strong>monto</strong> en cada archivo para poder continuar.
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <Boton variante="secundario" tamano="lg" onClick={() => setPaso(1)}>
              Atrás
            </Boton>
            <Boton
              tamano="lg"
              disabled={!puedeContinuarPaso2 || procesando}
              onClick={confirmarPaso2}
            >
              {procesando ? "Preparando…" : "Está correcto, continuar"}
            </Boton>
          </div>
        </>
      )}

      {/* ─────────────────────────── PASO 3 ─────────────────────────── */}
      {paso === 3 && (
        <>
          <div className="mt-8 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                <p className="text-sm text-neutral-600">Tus registros</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-900">
                  {internosCanon.length.toLocaleString("es-PE")}
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                <p className="text-sm text-neutral-600">Movimientos del banco</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-900">
                  {bancariosCanon.length.toLocaleString("es-PE")}
                  {!extractoEsExcel && (
                    <span className="ml-2 text-sm font-normal text-neutral-600">
                      · se leerán del PDF al conciliar
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-neutral-600">Período</dt>
                  <dd className="font-medium text-neutral-900">
                    {periodo.etiqueta}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-600">Cuenta</dt>
                  <dd className="font-medium text-neutral-900">
                    {cuenta
                      ? `${cuenta.banco} ${cuenta.numero_enmascarado ?? ""}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-600">Saldo libros (final)</dt>
                  <dd className="font-medium tabular-nums text-neutral-900">
                    {saldoLibrosVista}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-600">Saldo extracto final</dt>
                  <dd className="font-medium tabular-nums text-neutral-900">
                    {saldoExtFinVista}
                  </dd>
                </div>
              </dl>
            </div>

            {!puedeIniciar && bancariosCanon.length === 0 && (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
                No hay movimientos bancarios para conciliar (¿el extracto es un
                PDF? En el MVP usa Excel/CSV).
              </p>
            )}
            {saldoExtractoFaltante && (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
                ⚠️ Sin el <strong>saldo final del extracto</strong> el cuadre no
                balanceará. Vuelve al Paso 1 e ingrésalo (o el saldo inicial,
                para calcularlo).
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <Boton variante="secundario" tamano="lg" onClick={() => setPaso(2)}>
              Atrás
            </Boton>
            <Boton
              tamano="lg"
              disabled={!puedeIniciar || procesando}
              onClick={iniciarConciliacion}
            >
              {procesando ? "Iniciando…" : "Iniciar conciliación"}
            </Boton>
          </div>
        </>
      )}

      {aviso && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
        >
          {aviso}
        </p>
      )}
    </div>
  );
}
