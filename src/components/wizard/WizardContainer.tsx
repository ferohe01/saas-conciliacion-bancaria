"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Stepper, type PasoWizard } from "./Stepper";
import { UploadZone, type ArchivoResumen } from "./UploadZone";
import { ZonaComprobantes, AvisoSinPlantilla } from "./ZonaComprobantes";
import { MapeoDataset } from "./MapeoDataset";
import { RevisionPrevia } from "./RevisionPrevia";
import { CandadoIcon, ChevronIcon, DocumentoIcon } from "./icons";
import { createClient } from "@/lib/supabase/client";
import { mesesRecientes, periodoDeRango, VALOR_RANGO } from "@/lib/periodo";
import { previsualizarArchivo, type ArchivoProcesado } from "@/lib/parsing/procesar";
import { detectarSaldoFinal } from "@/lib/parsing/saldo";
import { validarCoherencia } from "@/lib/parsing/coherencia";
import { formatearPEN, formatearFecha } from "@/lib/parsing/resumen";
import { normalizarMonto } from "@/lib/normalizacion/monto";
import type { MapeoColumnas } from "@/lib/parsing/deteccion";
import {
  guardarMapeoCuenta,
  resumenComprobantesPeriodo,
  diagnosticarAntesDeConciliar,
  explicarRevisionPrevia,
  type ResumenComprobantes,
} from "@/app/(app)/wizard/actions";
import {
  evaluarDiagnostico,
  debeRevisar,
  type Hallazgo,
} from "@/lib/diagnosticoPrevio";
import { Boton, CLASES_ENTRADA } from "@/components/ui";

export type CuentaOpcion = {
  id: string;
  banco: string;
  numero_enmascarado: string | null;
  moneda: string;
  mapeo_columnas: {
    extracto?: MapeoColumnas;
  } | null;
};

/**
 * Origen de los registros internos. "Subir archivo" existió durante la prueba
 * de concepto y se retiró: conciliaba igual, pero ningún comprobante quedaba
 * cobrado y el saldo no se movía nunca —el error silencioso más caro del
 * producto—. Los registros internos salen de la tabla de comprobantes; el
 * extracto del banco se sigue subiendo como archivo, eso no cambia.
 */
type Fuente = "comprobantes" | "sistema";

const OPCIONES_MES = mesesRecientes(12);

function mapeoAplicable(m: MapeoColumnas, headers: string[]): boolean {
  const valores = Object.values(m);
  return valores.length > 0 && valores.every((h) => headers.includes(h!));
}

/**
 * Combina la detección con el mapeo que la cuenta recordaba.
 *
 * ⚠️ El guardado MANDA donde diga algo, pero NO borra lo que no dice.
 *
 * Antes se devolvía el guardado entero y la detección se descartaba. Eso
 * convertía un error de mapeo en permanente: la primera carga del extracto de
 * una recaudadora se hizo sin la columna de recibos, la cuenta memorizó ese
 * mapeo incompleto, y las cargas siguientes lo volvían a aplicar pisando la
 * detección — que ya reconocía la columna. La conciliación dio 0% tres veces
 * seguidas, y cada intento parecía uno nuevo.
 *
 * Memoria que solo puede quitar campos es una trampa: el usuario no tiene forma
 * de saber que la pantalla está prefiriendo una decisión vieja.
 */
function elegirMapeo(
  detectado: MapeoColumnas,
  guardado: MapeoColumnas | undefined,
  headers: string[],
): MapeoColumnas {
  if (!guardado || !mapeoAplicable(guardado, headers)) return { ...detectado };
  const util = Object.fromEntries(
    Object.entries(guardado).filter(([, v]) => Boolean(v)),
  );
  return { ...detectado, ...util };
}

function tieneFechaYMonto(m: MapeoColumnas): boolean {
  return Boolean(m.fecha) && Boolean(m.monto);
}

/** Campo de fecha para el rango libre. */
function FechaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-neutral-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
      />
    </label>
  );
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

/**
 * Lo que se enseña del archivo recién elegido.
 *
 * Con `resumen` hay cifras porque se leyó entero; sin él el archivo era grande
 * y solo se leyeron las primeras filas, así que **no se cuenta nada**: una
 * cifra sacada de 500 filas es plausible y falsa, y aquí lo honesto es decir
 * cuándo llegarán los totales de verdad.
 */
function resumenParaZona(p: ArchivoProcesado, moneda: string): ArchivoResumen {
  if (p.formato === "pdf") {
    return { nombre: p.nombre, total: "PDF · se procesará al conciliar" };
  }
  if (!p.resumen) {
    return {
      nombre: p.nombre,
      total: "Archivo grande · los totales se calculan al confirmar las columnas",
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

/** Lo mínimo que el wizard necesita saber de la conexión (se edita en /conexiones). */
export type ResumenConexion = { sistema: string; estadoLabel: string };

export function WizardContainer({
  cuentas,
  conexion = null,
  asistente = false,
  mapeoConfigurado = false,
  archivoPropio = false,
}: {
  cuentas: CuentaOpcion[];
  conexion?: ResumenConexion | null;
  /** Si el despliegue tiene modelo configurado (lo decide el servidor). */
  asistente?: boolean;
  /** La empresa ya confirmó con qué columnas viene su archivo de comprobantes. */
  mapeoConfigurado?: boolean;
  /** La empresa puede subir su propio formato en vez de la plantilla (0040). */
  archivoPropio?: boolean;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<PasoWizard>(1);

  const [periodoValor, setPeriodoValor] = useState(
    OPCIONES_MES[1]?.valor ?? OPCIONES_MES[0]!.valor,
  );
  // El rango hereda el mes que estuviera a la vista al cambiar el desplegable
  // (ver su `onChange`): así nunca se entra a dos casillas vacías.
  const [rangoDesde, setRangoDesde] = useState(
    (OPCIONES_MES[1] ?? OPCIONES_MES[0]!).desde,
  );
  const [rangoHasta, setRangoHasta] = useState(
    (OPCIONES_MES[1] ?? OPCIONES_MES[0]!).hasta,
  );
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id ?? "");
  const [fuente, setFuente] = useState<Fuente>("comprobantes");

  const [extracto, setExtracto] = useState<ArchivoProcesado | null>(null);
  const [mapeoExtracto, setMapeoExtracto] = useState<MapeoColumnas>({});

  const [comprobantesResumen, setComprobantesResumen] =
    useState<ResumenComprobantes | null>(null);
  const [recargaComprobantes, setRecargaComprobantes] = useState(0);

  const [saldoLibros, setSaldoLibros] = useState("");
  const [saldoExtIni, setSaldoExtIni] = useState("");
  const [saldoExtFin, setSaldoExtFin] = useState("");

  /**
   * El archivo del extracto, tal cual. Ya no se parsea entero en el navegador:
   * de él solo se leen las primeras filas para poder mapear columnas, y el
   * original viaja al servidor, que es quien lo procesa por lotes.
   */
  const [archivoExtracto, setArchivoExtracto] = useState<File | null>(null);

  /**
   * Lo que devolvió el servidor al cargar el extracto. Los conteos y el saldo
   * final son REALES —los ve quien leyó el archivo entero— en vez de una
   * estimación sobre una previsualización.
   */
  const [lote, setLote] = useState<{
    lote_id: string;
    insertados: number;
    invalidas: number;
    saldo_final: number | null;
    fuera_de_periodo: number;
  } | null>(null);

  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [procesando, startTransition] = useTransition();

  /**
   * Revisión previa del Paso 3. `null` = todavía no se sabe (o no se pudo
   * comprobar), que NO es lo mismo que "todo bien" — por eso no se inicializa
   * a lista vacía.
   */
  const [hallazgos, setHallazgos] = useState<Hallazgo[] | null>(null);
  const [revisando, setRevisando] = useState(false);
  /** La tarjeta de comprobantes está preguntando qué columna es cada cosa. */
  const [mapeandoComprobantes, setMapeandoComprobantes] = useState(false);
  /** Columnas de la plantilla que le faltan al archivo que se intentó subir. */
  const [sinPlantilla, setSinPlantilla] = useState<string[] | null>(null);

  const esRango = periodoValor === VALOR_RANGO;

  /**
   * `null` cuando el rango escrito no sirve (incompleto o del revés). No se cae
   * a un mes por defecto a propósito: conciliar un período que el usuario no
   * pidió da un resultado que parece bueno, y ese es el error caro.
   */
  const periodo = useMemo(
    () =>
      esRango
        ? periodoDeRango(rangoDesde, rangoHasta)
        : (OPCIONES_MES.find((o) => o.valor === periodoValor) ??
          OPCIONES_MES[0]!),
    [esRango, periodoValor, rangoDesde, rangoHasta],
  );
  const cuenta = cuentas.find((c) => c.id === cuentaId);
  const moneda = cuenta?.moneda ?? "PEN";

  /**
   * Aviso de "este archivo no parece del período", en el Paso 1.
   *
   * Solo existe cuando el archivo era pequeño y se leyó entero. Con uno grande
   * el navegador ve las primeras 500 filas, y darlo por bueno mirando su
   * cabecera es exactamente el error que este aviso evita — así que ahí calla y
   * lo cuenta el servidor al importar (`fuera_de_periodo`, en el Paso 3).
   */
  const coherenciaExtracto = useMemo(
    () =>
      extracto?.resumen && periodo
        ? validarCoherencia(extracto.resumen.fechasISO, periodo)
        : null,
    [extracto, periodo],
  );

  // Los comprobantes del período son la única fuente de registros internos, así
  // que su resumen se consulta siempre: es lo que dice si hay materia que
  // conciliar antes de dejar continuar.
  useEffect(() => {
    // Sin período válido no hay nada que contar, y pedirlo con un rango a
    // medio escribir daría cifras que cambian a cada tecla.
    if (!periodo) {
      setComprobantesResumen(null);
      return;
    }
    let cancelado = false;
    (async () => {
      // ⚠️ Lo cuenta la BASE, no el navegador.
      //
      // Antes esto eran tres consultas por PostgREST con el cliente de RLS y
      // sin filtro de empresa. La política es `es_miembro(empresa_id)`, una
      // función sobre una columna que Postgres evalúa fila a fila: con 452.309
      // comprobantes se pasa del `statement_timeout` de 8 s, las consultas
      // vuelven nulas y la pantalla decía **"No hay comprobantes en este
      // período"** sobre medio millón que sí estaban. Una respuesta
      // tranquilizadora y falsa, que es la peor clase.
      const r = await resumenComprobantesPeriodo(periodo.desde, periodo.hasta, moneda);
      if (cancelado) return;
      setComprobantesResumen(r);
    })();
    return () => {
      cancelado = true;
    };
    // ⚠️ `moneda` está en las dependencias: solo entran a conciliar los
    // comprobantes de la moneda de la CUENTA elegida, así que cambiar de cuenta
    // cambia el recuento. Sin esto, la tarjeta seguiría enseñando el número de
    // la cuenta anterior.
  }, [periodo, recargaComprobantes, moneda]);

  /**
   * Un archivo ilegible (corrupto, protegido con contraseña, .xls antiguo) hace
   * que `procesarArchivo` lance. Sin este try/catch la promesa se rechazaba sin
   * dueño y la pantalla se quedaba idéntica: el usuario no sabía si su archivo
   * había entrado o no.
   */
  async function cargarExtracto(file: File) {
    if (!periodo) {
      setError("Antes de subir el extracto, elige un período válido.");
      return;
    }
    setError(null);
    setCargando(true);
    // Un extracto nuevo invalida el que se hubiera cargado antes.
    setLote(null);
    try {
      // Solo la cabecera: lo justo para reconocer las columnas. Leer el archivo
      // entero aquí es lo que impedía cargar un extracto de 26 MB, y no hace
      // falta — el que lo procesa es el servidor.
      const proc = await previsualizarArchivo(file, periodo);
      setExtracto(proc);
      setArchivoExtracto(file);
      setMapeoExtracto(
        elegirMapeo(proc.mapeo, cuenta?.mapeo_columnas?.extracto, proc.headers),
      );
      // Autodetectar el saldo final SOLO si se leyó el archivo entero. Con un
      // archivo grande el navegador ve las primeras 500 filas, así que
      // detectaría el saldo de la fila 500 creyendo que es el último — y un
      // saldo final equivocado corrompe el cuadre sin que se note. En ese caso
      // lo detecta el servidor al importar, que sí ve la última.
      if (proc.resumen && saldoExtFin.trim() === "") {
        const detectado = detectarSaldoFinal(proc.headers, proc.filas);
        if (detectado != null) setSaldoExtFin(String(detectado));
      }
    } catch {
      setExtracto(null);
      setArchivoExtracto(null);
      setError(
        `No pudimos leer "${file.name}". Si es el extracto de tu banco, descárgalo en Excel, CSV o PDF y vuelve a subirlo.`,
      );
    } finally {
      setCargando(false);
    }
  }

  const internosListo =
    fuente === "comprobantes" && (comprobantesResumen?.registros ?? 0) > 0;
  const extractoListo = extracto != null;

  // Un botón deshabilitado sin explicación es un callejón sin salida: la lista
  // dice exactamente qué falta.
  const faltaPaso1 = [
    !periodo &&
      "elegir un período válido (la fecha inicial no puede ser posterior a la final)",
    !cuentaId && "elegir una cuenta bancaria",
    !internosListo && "tener comprobantes en el período",
    !extractoListo && "subir el extracto del banco",
    saldoLibros.trim() === "" && "ingresar el saldo según libros",
  ].filter((x): x is string => Boolean(x));

  const puedeContinuarPaso1 = faltaPaso1.length === 0;

  // Paso 2: validar que el mapeo del extracto tenga fecha + monto (los
  // comprobantes ya vienen estructurados y no se mapean).
  const extractoEsExcel = extracto?.formato === "excel";
  const puedeContinuarPaso2 = !extractoEsExcel || tieneFechaYMonto(mapeoExtracto);

  /**
   * La referencia no es obligatoria, pero sin ella el motor pierde su mejor
   * herramienta: casar por número de operación es lo que resuelve el grueso de
   * una cuenta recaudadora. Sin mapearla, esa capa no puede emparejar nada y
   * todo cae en las heurísticas de monto y fecha.
   *
   * Pasó de verdad: una conciliación de 450.999 movimientos terminó en **0 %**
   * porque la columna de recibos se quedó sin mapear, y nada lo dijo hasta ver
   * el resultado. A ese volumen, descubrirlo al final cuesta media hora.
   */
  const faltaReferencia =
    extractoEsExcel && !mapeoExtracto.referencia;

  function irAPaso2() {
    setAviso(null);
    setError(null);
    setPaso(2);
  }

  /**
   * Confirmar el mapeo SUBE el extracto al servidor.
   *
   * Es el momento correcto: antes no se sabe qué columna es cuál, y después ya
   * no habría dónde enseñar el resultado. Lo que vuelve —cuántos movimientos
   * entraron, su saldo final, cuántos caen fuera del período— sale de leer el
   * archivo entero, cosa que el navegador ya no hace.
   */
  function confirmarPaso2() {
    setError(null);
    if (!periodo || !cuentaId || !archivoExtracto) {
      setError("Falta el período, la cuenta o el extracto. Vuelve al Paso 1.");
      return;
    }
    startTransition(async () => {
      if (cuentaId) {
        await guardarMapeoCuenta(cuentaId, {
          extracto: extractoEsExcel ? mapeoExtracto : undefined,
        });
      }

      const cuerpo = new FormData();
      cuerpo.append("archivo", archivoExtracto);
      cuerpo.append("cuenta_id", cuentaId);
      cuerpo.append("mapeo", JSON.stringify(mapeoExtracto));
      cuerpo.append("desde", periodo.desde);
      cuerpo.append("hasta", periodo.hasta);

      try {
        const res = await fetch("/api/extracto/importar", {
          method: "POST",
          body: cuerpo,
        });
        const data = (await res.json()) as {
          error?: string;
          lote_id?: string;
          insertados?: number;
          invalidas?: number;
          saldo_final?: number | null;
          fuera_de_periodo?: number;
        };
        if (!res.ok || !data.lote_id) {
          setError(data.error ?? "No se pudo cargar el extracto.");
          return;
        }
        setLote({
          lote_id: data.lote_id,
          insertados: data.insertados ?? 0,
          invalidas: data.invalidas ?? 0,
          saldo_final: data.saldo_final ?? null,
          fuera_de_periodo: data.fuera_de_periodo ?? 0,
        });
        // El saldo final lo detecta el servidor, que ve la última fila.
        if (data.saldo_final != null && saldoExtFin.trim() === "") {
          setSaldoExtFin(String(data.saldo_final));
        }
        setPaso(3);
      } catch {
        setError(
          "No se pudo conectar con el servidor al cargar el extracto. Revisa tu conexión e inténtalo de nuevo.",
        );
      }
    });
  }

  const puedeIniciar =
    lote != null &&
    lote.insertados > 0 &&
    (comprobantesResumen?.registros ?? 0) > 0 &&
    Boolean(cuentaId) &&
    periodo != null;

  /**
   * Revisión previa: qué va a pasar si se concilia con estos datos.
   *
   * Se lanza al entrar al Paso 3, que es el único momento en que los dos lados
   * ya están en la base y el motor todavía no ha corrido. Antes de esto, una
   * conciliación de 450.999 movimientos podía terminar en 0 % por una columna
   * sin mapear y no había forma de saberlo hasta media hora después.
   *
   * Si falla no se interrumpe nada: `hallazgos` queda en `null` y el Paso 3
   * funciona como siempre. Una comprobación es una ayuda, no un requisito.
   */
  useEffect(() => {
    if (paso !== 3 || !lote || !periodo) return;
    let vigente = true;
    setRevisando(true);
    diagnosticarAntesDeConciliar(lote.lote_id, periodo.desde, periodo.hasta)
      .then((r) => {
        if (!vigente) return;
        setHallazgos(r ? evaluarDiagnostico(r.contadores, r.maxFilas) : null);
      })
      .catch(() => {
        if (vigente) setHallazgos(null);
      })
      .finally(() => {
        if (vigente) setRevisando(false);
      });
    return () => {
      vigente = false;
    };
  }, [paso, lote, periodo]);

  /**
   * Con algo grave detectado, "Iniciar conciliación" deja de ser el botón
   * negro. No se deshabilita: hay extractos que legítimamente no traen
   * referencia, y prohibirlo cerraría un caso de uso válido. Lo que se hace es
   * poner delante la acción que casi siempre corresponde —volver a mirar el
   * mapeo— y dejar la otra a un clic.
   */
  const convieneRevisar = hallazgos != null && debeRevisar(hallazgos);
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
    if (!periodo) {
      setError("El período no es válido. Vuelve al Paso 1 y revísalo.");
      return;
    }
    const saldoLibrosNum = normalizarMonto(saldoLibros);
    if (saldoLibrosNum == null) {
      setError("Ingresa un saldo según libros válido en el Paso 1.");
      return;
    }
    // Saldo extracto final: el ingresado, o (si falta) inicial + suma de
    // movimientos bancarios del período.
    const extIni = normalizarMonto(saldoExtIni);
    const extFin = normalizarMonto(saldoExtFin);

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
            // Ni una partida viaja en el cuerpo: el extracto ya está en la
            // base y los comprobantes también. El backend corre la capa exacta
            // en SQL y solo manda a n8n el residuo. Es lo que hace que 903.176
            // partidas quepan en una petición de dos líneas.
            lote_extracto_id: lote?.lote_id,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(data.error ?? "No se pudo iniciar la conciliación.");
          return;
        }
        const data = (await res.json()) as {
          job_id: string;
          idempotente?: boolean;
        };

        // ⚠️ El backend NO crea un job nuevo si ya hay uno en vuelo para esta
        // cuenta y período: devuelve el que existe. Es lo correcto —dos clics
        // no deben lanzar dos conciliaciones— pero navegar en silencio hacia él
        // hace creer que se lanzó algo.
        //
        // Pasó de verdad: el usuario aterrizó en una conciliación de hacía 17
        // minutos, leyó "lleva 17 minutos, más de lo habitual" sobre un botón
        // que acababa de pulsar, y concluyó que el sistema estaba roto.
        if (data.idempotente) {
          setAviso(
            "Ya hay una conciliación de este período en marcha. Te llevamos a ella en vez de lanzar otra.",
          );
          setTimeout(() => router.push(`/conciliacion/${data.job_id}`), 2500);
          return;
        }
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
              onChange={(v) => {
                // Al pasar a rango, se hereda el mes que estaba a la vista: se
                // entra viendo un rango válido y se estrecha, en vez de
                // encontrarse dos casillas vacías.
                if (v === VALOR_RANGO) {
                  const mes = OPCIONES_MES.find((o) => o.valor === periodoValor);
                  if (mes) {
                    setRangoDesde(mes.desde);
                    setRangoHasta(mes.hasta);
                  }
                }
                setPeriodoValor(v);
              }}
            >
              {OPCIONES_MES.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
              {/* Al final, no al principio: el mes es lo que quiere una PyME y
                  sigue siendo la respuesta por defecto. El rango está para
                  quien concilia por semana o por día. */}
              <option value={VALOR_RANGO}>Rango de fechas…</option>
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

          {esRango && (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FechaField label="Desde" value={rangoDesde} onChange={setRangoDesde} />
                <FechaField label="Hasta" value={rangoHasta} onChange={setRangoHasta} />
              </div>
              {periodo ? (
                <p className="mt-3 text-sm text-neutral-600">
                  Conciliarás{" "}
                  <span className="font-medium text-neutral-900">
                    {periodo.etiqueta}
                  </span>
                  . Para el mismo día en los dos campos, el corte es de un solo
                  día.
                </p>
              ) : (
                // El aviso va aquí, junto a los campos, y no solo en la lista
                // de "te falta": el error se comete mirando estas dos casillas.
                <p className="mt-3 text-sm font-medium text-amber-800">
                  La fecha inicial no puede ser posterior a la final.
                </p>
              )}
            </div>
          )}

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

            {/* La opción sigue deshabilitada porque todavía no puede producir
                registros; lo que sí existe es la pantalla donde dejar los datos
                del sistema. Sin este enlace, "próximamente" es un cartel sin
                puerta detrás. */}
            <p className="mt-2 text-sm text-neutral-600">
              {conexion ? (
                <>
                  Registraste <span className="font-medium">{conexion.sistema}</span>{" "}
                  ({conexion.estadoLabel.toLowerCase()}). Te avisaremos cuando
                  puedas conciliar desde ahí.{" "}
                  <Link
                    href="/conexiones"
                    className="rounded font-medium text-blue-700 underline underline-offset-2 transition-colors hover:text-blue-800"
                  >
                    Ver la conexión
                  </Link>
                </>
              ) : (
                <>
                  ¿Emites tus comprobantes en otro sistema?{" "}
                  <Link
                    href="/conexiones"
                    className="rounded font-medium text-blue-700 underline underline-offset-2 transition-colors hover:text-blue-800"
                  >
                    Cuéntanos cuál
                  </Link>{" "}
                  y preparamos la conexión.
                </>
              )}
            </p>
          </fieldset>

          {/* Mientras se mapea, la tarjeta de comprobantes ocupa el ancho
              entero: nueve columnas y una vista previa no caben en media
              pantalla, y el extracto se sube después de todos modos. */}
          <div
            className={`mt-4 grid gap-4 ${
              mapeandoComprobantes ? "" : "sm:grid-cols-2"
            }`}
          >
            <div>
              {fuente === "comprobantes" ? (
                <ZonaComprobantes
                  resumen={comprobantesResumen}
                  periodo={periodo}
                  moneda={moneda}
                  onCambio={() => setRecargaComprobantes((n) => n + 1)}
                  mapeoConfigurado={mapeoConfigurado}
                  archivoPropio={archivoPropio}
                  onMapeando={setMapeandoComprobantes}
                  onRechazo={setSinPlantilla}
                />
              ) : (
                // "Conectar sistema" todavía no produce registros. Aun así ocupa
                // el mismo hueco: dejarlo vacío rompería la simetría de los dos
                // lados, que es justo lo que esta pantalla tiene que enseñar.
                <div className="flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-300 bg-white px-6 py-8 text-center">
                  <DocumentoIcon className="h-8 w-8 text-neutral-400" />
                  <p className="mt-3 font-semibold text-neutral-700">
                    Desde tu sistema
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    Todavía no podemos traer tus comprobantes automáticamente.
                  </p>
                  <Link
                    href="/conexiones"
                    className="mt-3 rounded text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800"
                  >
                    Registrar tu sistema
                  </Link>
                </div>
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

          {/* A ancho completo, debajo de las dos tarjetas. Dentro de la columna
              izquierda el texto se partía en seis líneas y los botones quedaban
              apretados: un rechazo tiene que leerse de una pasada, porque es el
              momento en que el usuario decide si esto le sirve o no. */}
          {sinPlantilla && (
            <div className="mt-4">
              <AvisoSinPlantilla
                faltan={sinPlantilla}
                onCerrar={() => setSinPlantilla(null)}
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
              disabled={!puedeContinuarPaso1 || cargando}
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

          {/* La referencia no es obligatoria, pero es EL dato con el que se
              empareja la mayoría de los movimientos. Sin avisar, una
              conciliación de 450.999 partidas terminó en 0% y no hubo forma de
              saberlo hasta ver el resultado. */}
          {faltaReferencia && (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              ⚠️ No has indicado la columna de{" "}
              <strong>referencia / nº de operación</strong>. Se puede conciliar
              sin ella, pero es el dato con el que se emparejan la mayoría de
              los movimientos: sin él, todo depende de que coincidan monto y
              fecha. Si tu extracto la trae, elígela arriba.
            </p>
          )}

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
              <strong>monto</strong> del extracto para poder continuar.
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
                  {(comprobantesResumen?.registros ?? 0).toLocaleString("es-PE")}
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                <p className="text-sm text-neutral-600">Movimientos del banco</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-900">
                  {(lote?.insertados ?? 0).toLocaleString("es-PE")}
                  {!extractoEsExcel && (
                    <span className="ml-2 text-sm font-normal text-neutral-600">
                      · se leerán del PDF al conciliar
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Lo que solo sabe quien leyó el archivo entero. Antes esto se
                calculaba en el navegador sobre todas las filas; ahora el
                navegador solo ve las primeras, así que lo cuenta el servidor
                —y de paso son cifras reales, no estimaciones. */}
            {lote && lote.fuera_de_periodo > 0 && (
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                ⚠️ {lote.fuera_de_periodo.toLocaleString("es-PE")} de los{" "}
                {lote.insertados.toLocaleString("es-PE")} movimientos del archivo
                caen fuera del período elegido. ¿Es el extracto correcto?
              </p>
            )}
            {lote && lote.invalidas > 0 && (
              <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
                Se descartaron {lote.invalidas.toLocaleString("es-PE")} filas sin
                fecha o sin monto legible.
              </p>
            )}

            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-neutral-600">Período</dt>
                  <dd className="font-medium text-neutral-900">
                    {periodo?.etiqueta ?? "—"}
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

            {/* La comprobación real, hecha con los dos lados ya en la base y
                antes de gastar la corrida. Ver `lib/diagnosticoPrevio.ts`. */}
            <RevisionPrevia
              hallazgos={hallazgos}
              cargando={revisando}
              preguntar={
                asistente && lote && periodo
                  ? (historial, pregunta) =>
                      explicarRevisionPrevia(
                        lote.lote_id,
                        periodo.desde,
                        periodo.hasta,
                        historial,
                        pregunta,
                      )
                  : undefined
              }
            />

            {!puedeIniciar && (lote?.insertados ?? 0) === 0 && (
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

          {/* Con algo grave detectado se invierten las prioridades: revisar el
              mapeo pasa a ser el botón negro y conciliar queda a un clic, en
              secundario. No se deshabilita nada — hay extractos que no traen
              referencia y para ellos conciliar por monto y fecha es legítimo—;
              lo que se hace es obligar a mirar. */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <Boton variante="secundario" tamano="lg" onClick={() => setPaso(2)}>
              Atrás
            </Boton>
            <div className="flex flex-wrap items-center gap-3">
              {convieneRevisar && (
                <Boton tamano="lg" onClick={() => setPaso(2)}>
                  Revisar el mapeo
                </Boton>
              )}
              <Boton
                tamano="lg"
                variante={convieneRevisar ? "secundario" : "primario"}
                disabled={!puedeIniciar || procesando}
                onClick={iniciarConciliacion}
              >
                {procesando
                  ? "Iniciando…"
                  : convieneRevisar
                    ? "Conciliar de todas formas"
                    : "Iniciar conciliación"}
              </Boton>
            </div>
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
