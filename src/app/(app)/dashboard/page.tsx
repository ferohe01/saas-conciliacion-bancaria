/**
 * DIRECCIÓN — Panel de control («terminal financiera clara»)
 *
 * THESIS: que un financiero lea el estado de sus conciliaciones de un vistazo,
 * como una terminal de bolsa —franja de indicadores, cifras alineadas,
 * variación contra el mes anterior— pero sobre el papel claro del resto del
 * producto, no con el fondo negro y el neón que DESIGN.md prohíbe.
 * LECTURA EN TRES FRANJAS HORIZONTALES:
 *   1. cabecera con los filtros en línea y la acción primaria;
 *   2. franja de seis indicadores dividida por filetes (libro mayor);
 *   3. la mesa: análisis a la izquierda (8/12) y un carril de acción a la
 *      derecha (4/12) con lo que espera a una persona y las últimas corridas.
 * Los avisos que antes eran banners a ancho completo (sin aprobar, prueba por
 * vencer, sugerencias por revisar) viven ahora como filas del carril: siguen
 * ahí, con su cifra y su enlace, sin empujar todo lo demás hacia abajo.
 * ANCHO: el único panel con ancho amplio (`data-ancho="amplio"`, ~1440 px).
 */

import Link from "next/link";
import { getEmpresaActual } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getResumenAprendizaje } from "@/lib/aprendizaje-servidor";
import { GanchoAprendizaje } from "@/components/aprendizaje/GanchoAprendizaje";
import { formatearFecha } from "@/lib/parsing/resumen";
import { BancoIcon } from "@/components/wizard/icons";
import { EstadoVacio, clasesBoton } from "@/components/ui";
import { estadoSuscripcion } from "@/lib/suscripcion";
import {
  PruebaVencida,
  PruebaPorVencer,
  ChipPrueba,
} from "@/components/app/AvisoPrueba";
import {
  calcularKpis,
  porMes,
  porBanco,
  filtrarAnual,
  filtrarMes,
  enFocoDelFiltro,
  deduplicarUltimoPorPeriodo,
  type JobReporte,
  type ResumenJob,
} from "@/lib/reportes";
import { FiltrosReporte } from "@/components/reportes/FiltrosReporte";
import { OrigenPartidas } from "@/components/conciliacion/OrigenPartidas";
import { motorDelResumen, origenDelJob } from "@/lib/origenPartidas-servidor";
import { nombreMes } from "@/lib/periodo";
import {
  cuadra,
  formatoDinero,
  ultimoPeriodo,
  variacionAutomatizacion,
} from "@/lib/panelControl";
import {
  CarrilAtencion,
  ComoSeConcilio,
  Indicador,
  PorBanco,
  TendenciaAnual,
  TextoVariacion,
  UltimasConciliaciones,
  type PendienteAtencion,
} from "@/components/panel/PanelControl";

type CuentaJoin =
  | { banco: string }
  | { banco: string }[]
  | null;

type JobRaw = {
  id: string;
  periodo_desde: string;
  periodo_hasta: string;
  cuenta_id: string;
  created_at: string;
  resultado: {
    resumen?: ResumenJob;
    cuadre?: { diferencia?: number };
  } | null;
  cuentas_bancarias: CuentaJoin;
};

type JobDash = {
  id: string;
  estado: string;
  estado_contable: string | null;
  cuenta_id: string;
  periodo_desde: string;
  periodo_hasta: string;
  origen_partidas: unknown;
  resultado: {
    matches?: { estado_revision?: string }[];
    cuadre?: { diferencia: number };
    resumen?: ResumenJob;
  } | null;
};

const NUM = (n: number) => n.toLocaleString("es-PE");

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const empresa = await getEmpresaActual();
  const supabase = await createClient();
  const suscripcion = estadoSuscripcion(empresa ?? {});

  // ⚠️ `origen_partidas` es una columna de la 0043. Si el despliegue va por
  // delante de la migración, PostgREST responde con error a TODO el select y el
  // panel se quedaría sin actividad reciente ni sugerencias pendientes: un
  // detalle nuevo tumbando lo que ya funcionaba. Se pide aparte y con reintento
  // sin la columna.
  const COLUMNAS_RECIENTES =
    "id, estado, estado_contable, cuenta_id, periodo_desde, periodo_hasta, resultado";

  const [
    { data: aprobadasData },
    { data: recientesData },
    { count: numCuentas },
    { data: cuentasData },
    { count: sinAprobar },
  ] = await Promise.all([
    // Solo lo APROBADO alimenta las cifras: es la conciliación que rige. Se
    // traen todos los años para poder ofrecer el selector; el volumen es de
    // unas pocas decenas de filas por ejercicio.
    supabase
      .from("jobs_conciliacion")
      .select(
        "id, periodo_desde, periodo_hasta, cuenta_id, created_at, resultado, cuentas_bancarias(banco)",
      )
      .eq("estado", "completado")
      .eq("estado_contable", "aprobada"),
    // Actividad reciente y trabajo pendiente. Se traen más de las que se
    // muestran porque hay que filtrarlas por período y cuenta después: quedarse
    // con 6 antes de filtrar dejaba fuera conciliaciones que sí encajan.
    // Las terminales no entran: revisar sugerencias de una conciliación anulada
    // o reemplazada no es trabajo pendiente.
    supabase
      .from("jobs_conciliacion")
      .select(`${COLUMNAS_RECIENTES}, origen_partidas`)
      .not("estado_contable", "in", "(anulada,reemplazada)")
      .order("created_at", { ascending: false })
      .limit(60)
      .then(async (r) =>
        r.error
          ? await supabase
              .from("jobs_conciliacion")
              .select(COLUMNAS_RECIENTES)
              .not("estado_contable", "in", "(anulada,reemplazada)")
              .order("created_at", { ascending: false })
              .limit(60)
          : r,
      ),
    supabase.from("cuentas_bancarias").select("id", { count: "exact", head: true }),
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, numero_enmascarado, moneda")
      .order("banco"),
    // Terminadas pero sin aprobar: no cuentan, y hay que decirlo.
    supabase
      .from("jobs_conciliacion")
      .select("id", { count: "exact", head: true })
      .eq("estado", "completado")
      .in("estado_contable", ["borrador", "en_proceso", "observada"]),
  ]);

  const aprendizaje = await getResumenAprendizaje();

  // Normalizar a JobReporte y quedarse con una corrida por período+cuenta.
  const jobs: JobReporte[] = [];
  for (const j of (aprobadasData ?? []) as JobRaw[]) {
    const resumen = j.resultado?.resumen;
    if (!resumen) continue;
    const cuenta = Array.isArray(j.cuentas_bancarias)
      ? j.cuentas_bancarias[0]
      : j.cuentas_bancarias;
    jobs.push({
      id: j.id,
      anio: Number(j.periodo_desde.slice(0, 4)),
      mes: Number(j.periodo_desde.slice(5, 7)),
      periodoDesde: j.periodo_desde,
      periodoHasta: j.periodo_hasta,
      banco: cuenta?.banco ?? "—",
      cuentaId: j.cuenta_id,
      numero: null,
      resumen,
      diferenciaCuadre: Number(j.resultado?.cuadre?.diferencia ?? 0),
      createdAt: j.created_at,
    });
  }
  // Red de seguridad: con el constraint de la 0012 no puede haber dos
  // aprobadas solapadas, así que aquí ya no debería colapsar nada.
  const todas = deduplicarUltimoPorPeriodo(jobs);

  const cuentas = (cuentasData ?? []) as {
    id: string;
    banco: string;
    numero_enmascarado: string | null;
    moneda: string | null;
  }[];

  // Opciones y valores del filtro.
  const aniosSet = new Set(todas.map((j) => j.anio));
  aniosSet.add(new Date().getUTCFullYear());
  const anios = [...aniosSet].sort((a, b) => b - a);
  const bancos = [...new Set(cuentas.map((c) => c.banco))].sort();

  const anio = Number(sp.anio) || anios[0]!;
  const mes = sp.mes && sp.mes !== "todos" ? Number(sp.mes) : ("todos" as const);
  const bancoSel = sp.banco ?? "todos";
  const cuentaSel = sp.cuenta ?? "todos";

  // El año entero (con banco y cuenta) alimenta la tendencia y la variación:
  // con un mes elegido, el gráfico sigue enseñando los doce y lo marca.
  const delAnio = filtrarAnual(todas, { anio, banco: bancoSel, cuentaId: cuentaSel });
  const jobsDef = filtrarMes(delAnio, mes);

  const hayFiltroFino =
    mes !== "todos" || bancoSel !== "todos" || cuentaSel !== "todos";

  const kpis = calcularKpis(jobsDef);
  const serieAnual = porMes(delAnio);
  const variacion = variacionAutomatizacion(serieAnual, mes);
  const filasBanco = porBanco(jobsDef);

  const sinCuentas = (numCuentas ?? 0) === 0;

  // El filtro tiene que alcanzar a TODO lo que hay en la página, no solo a las
  // cifras agregadas. Cuando no lo hacía, elegir una cuenta sin conciliaciones
  // seguía anunciando las sugerencias pendientes de otra cuenta: el panel decía
  // que había trabajo justo donde no lo había.
  const bancoDeCuenta = new Map(cuentas.map((c) => [c.id, c.banco]));
  const monedaDeCuenta = new Map(cuentas.map((c) => [c.id, c.moneda]));
  const enFoco = enFocoDelFiltro(
    (recientesData ?? []) as JobDash[],
    { anio, mes, banco: bancoSel, cuentaId: cuentaSel },
    bancoDeCuenta,
  );

  const recientes = enFoco.slice(0, 6);

  // Lo único que de verdad reclama a la persona: sugerencias sin criterio.
  const porRevisar = enFoco.reduce(
    (acc, j) =>
      acc +
      (j.resultado?.matches ?? []).filter((m) => m.estado_revision === "pendiente")
        .length,
    0,
  );
  const jobConPendientes = enFoco.find((j) =>
    (j.resultado?.matches ?? []).some((m) => m.estado_revision === "pendiente"),
  );

  // ── De dónde salieron las partidas de la última conciliación ──────────────
  //
  // La pregunta «mi archivo tiene 452.605 filas y aquí dice 452.177» se hace
  // mirando ESTE panel, así que la respuesta tiene que estar aquí. Se toma la
  // conciliación terminada más reciente del recorte: la cascada solo tiene
  // sentido contra un archivo concreto, y sumar varias contaría dos veces las
  // cargas que comparten.
  const ultimaTerminada = enFoco.find(
    (j) => j.estado === "completado" && j.resultado?.resumen,
  );
  const origen = ultimaTerminada
    ? {
        jobId: ultimaTerminada.id,
        desde: ultimaTerminada.periodo_desde,
        hasta: ultimaTerminada.periodo_hasta,
        origen: origenDelJob(ultimaTerminada.origen_partidas),
        motor: motorDelResumen(ultimaTerminada.resultado),
      }
    : null;

  if (sinCuentas) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Hola, {empresa?.nombre}
          </h1>
          <p className="mt-1 text-neutral-600">
            Registra tu primera cuenta bancaria para empezar.
          </p>
        </header>
        <EstadoVacio
          icono={<BancoIcon className="h-6 w-6" />}
          titulo="Empieza registrando tu cuenta bancaria"
          texto="Necesitamos saber de qué banco es el extracto que vas a subir. Toma menos de un minuto y solo se hace una vez."
          accion={
            <Link href="/cuentas" className={clasesBoton("primario", "md")}>
              Registrar una cuenta
            </Link>
          }
        />
      </div>
    );
  }

  // ── El cuadre del último período aprobado: la cifra en dinero ─────────────
  //
  // Se enseña la del ÚLTIMO período, no una suma: las diferencias de varios
  // meses pueden tener signos opuestos y anularse, y un «S/ 0,00» salido de
  // esa resta afirmaría un cuadre que ningún período tuvo.
  const ultimo = ultimoPeriodo(jobsDef);
  const monedaUltimo = ultimo ? (monedaDeCuenta.get(ultimo.cuentaId) ?? null) : null;
  const etiquetaUltimo = ultimo
    ? ultimo.periodoDesde.slice(0, 7) === ultimo.periodoHasta.slice(0, 7) &&
      ultimo.periodoDesde.endsWith("-01")
      ? `${nombreMes(Number(ultimo.periodoDesde.slice(5, 7)))} · ${ultimo.banco}`
      : `${formatearFecha(ultimo.periodoDesde)} – ${formatearFecha(ultimo.periodoHasta)} · ${ultimo.banco}`
    : null;

  const sueltas = kpis.sinConciliarInternos + kpis.sinConciliarBancarios;

  // El carril de atención, por urgencia: lo que la IA espera, lo que no cuenta
  // todavía, y lo que nadie emparejó.
  const pendientes: PendienteAtencion[] = [];
  if (porRevisar > 0 && jobConPendientes) {
    pendientes.push({
      clave: "revisar",
      marca: "maquina",
      cifra: porRevisar,
      texto: porRevisar === 1 ? "sugerencia espera tu revisión" : "sugerencias esperan tu revisión",
      detalle: "Nada se concilia sin que tú lo apruebes.",
      href: `/conciliacion/${jobConPendientes.id}`,
    });
  }
  if ((sinAprobar ?? 0) > 0) {
    pendientes.push({
      clave: "sin-aprobar",
      marca: "atencion",
      cifra: sinAprobar ?? 0,
      texto:
        sinAprobar === 1
          ? "conciliación terminada sin aprobar"
          : "conciliaciones terminadas sin aprobar",
      detalle: "No cuentan en estas cifras: solo suma lo aprobado.",
      href: "/conciliacion",
    });
  }
  if (sueltas > 0) {
    pendientes.push({
      clave: "sueltas",
      marca: "atencion",
      cifra: sueltas,
      texto: sueltas === 1 ? "partida sin conciliar" : "partidas sin conciliar",
      detalle: `${NUM(kpis.sinConciliarInternos)} tuyas · ${NUM(kpis.sinConciliarBancarios)} del banco`,
      href: "/reportes/sin-conciliar",
    });
  }

  const recorte = [
    mes !== "todos" ? nombreMes(mes) : null,
    bancoSel !== "todos" ? bancoSel : null,
    cuentaSel !== "todos"
      ? (cuentas.find((c) => c.id === cuentaSel)?.numero_enmascarado ?? "cuenta")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div data-ancho="amplio" className="space-y-5">
      {/* ── 1. Cabecera: quién, qué recorte, y la acción primaria ──────────── */}
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Panel de control
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-600">
            <span>
              {empresa?.nombre} · ejercicio <span className="tabular-nums">{anio}</span>
              {hayFiltroFino && (
                <>
                  {" · "}
                  <span className="font-medium text-neutral-800">{recorte}</span>
                </>
              )}
            </span>
            <ChipPrueba estado={suscripcion} />
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <FiltrosReporte
            enLinea
            anios={anios}
            bancos={bancos}
            cuentas={cuentas}
            valores={{
              anio,
              mes: mes === "todos" ? "todos" : String(mes),
              banco: bancoSel,
              cuenta: cuentaSel,
            }}
          />
          {suscripcion.puedeConciliar && (
            <Link href="/wizard" className={clasesBoton("primario", "md")}>
              Conciliar un período
            </Link>
          )}
        </div>
      </header>

      {/* La prueba vencida sí va a ancho completo: cambia lo que se puede hacer
          en toda la pantalla. */}
      {suscripcion.expirada && <PruebaVencida />}

      {/* Un recorte vacío enseñado como ceros se lee como "no tienes nada",
          no como "no hay nada aquí". Hay que decir cuál de las dos es. */}
      {enFoco.length === 0 && jobsDef.length === 0 && (
        <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-3 text-sm text-neutral-600">
          No hay conciliaciones para este recorte
          {hayFiltroFino ? "" : ` del ejercicio ${anio}`}. Prueba con otro
          período o cuenta{hayFiltroFino ? ", o quita los filtros" : ""}.
        </p>
      )}

      {/* ── 2. Franja de indicadores ──────────────────────────────────────────
          Un solo contenedor dividido por filetes, como el encabezado de un
          libro mayor. El filete es el fondo asomando por el gap de 1px: cae
          bien en 2, 3 o 6 columnas sin bordes puestos a mano. Las columnas las
          decide el ancho de la franja (container query), no el de la ventana:
          la guarda lateral se come 256 px y la ventana no lo sabe. */}
      <div className="@container">
      <section
        aria-label="Indicadores del recorte"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 @xl:grid-cols-3 @[58rem]:grid-cols-6"
      >
        <Indicador
          etiqueta="Por revisar"
          valor={NUM(porRevisar)}
          tono={porRevisar > 0 ? "atencion" : "neutro"}
          nota={porRevisar > 0 ? "sugerencias de la IA" : "nada pendiente"}
          href={jobConPendientes ? `/conciliacion/${jobConPendientes.id}` : undefined}
        />
        <Indicador
          etiqueta="Períodos cuadrados"
          valor={`${NUM(kpis.jobsCuadrados)}/${NUM(kpis.conciliaciones)}`}
          tono={
            kpis.conciliaciones > 0 && kpis.jobsCuadrados === kpis.conciliaciones
              ? "cuadre"
              : "neutro"
          }
          nota="con diferencia S/ 0,00"
        />
        <Indicador
          etiqueta="Automatización"
          valor={`${kpis.pctAutomatizacion.toLocaleString("es-PE")}%`}
          variacion={variacion ? <TextoVariacion v={variacion} /> : undefined}
          nota="conciliado sin intervención"
          href="/reportes"
        />
        <Indicador
          etiqueta="Movimientos"
          valor={NUM(kpis.movimientos)}
          nota={`${NUM(kpis.registros)} registros internos`}
          href="/reportes"
        />
        <Indicador
          etiqueta="Sin conciliar"
          valor={NUM(sueltas)}
          tono={sueltas > 0 ? "atencion" : "neutro"}
          nota={`${kpis.pctSinConciliar.toLocaleString("es-PE")}% de las partidas`}
          href={sueltas > 0 ? "/reportes/sin-conciliar" : undefined}
        />
        <Indicador
          etiqueta="Diferencia de cuadre"
          valor={
            ultimo
              ? `${cuadra(ultimo.diferenciaCuadre) ? "" : ultimo.diferenciaCuadre < 0 ? "−" : "+"}${formatoDinero(ultimo.diferenciaCuadre, monedaUltimo)}`
              : "—"
          }
          tono={ultimo ? (cuadra(ultimo.diferenciaCuadre) ? "cuadre" : "descuadre") : "neutro"}
          nota={
            ultimo ? (
              <>
                {cuadra(ultimo.diferenciaCuadre) ? "✓ cuadra · " : "✕ no cuadra · "}
                {etiquetaUltimo}
              </>
            ) : (
              "sin períodos aprobados"
            )
          }
          href={ultimo ? `/conciliacion/${ultimo.id}` : undefined}
        />
      </section>
      </div>

      {/* ── 3. La mesa: análisis (8/12) y carril de acción (4/12) ──────────── */}
      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          <TendenciaAnual datos={serieAnual} anio={anio} mesSel={mes} />
          <div className="grid gap-5 md:grid-cols-2">
            <ComoSeConcilio
              metodos={kpis.metodos}
              total={kpis.paresConciliados}
              sueltas={{
                internos: kpis.sinConciliarInternos,
                bancarios: kpis.sinConciliarBancarios,
                pct: kpis.pctSinConciliar,
              }}
            />
            <PorBanco filas={filasBanco} />
          </div>
          {/* Plegado: es la respuesta a una duda concreta («mi archivo tiene
              más filas»), no algo que haya que mirar a diario. */}
          {origen && (origen.origen || origen.motor) && (
            <OrigenPartidas
              compacto
              origen={origen.origen}
              motor={origen.motor}
              jobId={origen.jobId}
              periodo={
                origen.desde === origen.hasta
                  ? formatearFecha(origen.desde)
                  : `${formatearFecha(origen.desde)} – ${formatearFecha(origen.hasta)}`
              }
            />
          )}
        </div>

        <aside aria-label="Acción" className="space-y-5 xl:col-span-4">
          <CarrilAtencion
            pendientes={pendientes}
            extra={
              !suscripcion.expirada ? <PruebaPorVencer estado={suscripcion} /> : undefined
            }
          />
          {recientes.length > 0 && (
            <UltimasConciliaciones
              filas={recientes.map((j) => ({
                id: j.id,
                desde: j.periodo_desde,
                hasta: j.periodo_hasta,
                banco: bancoDeCuenta.get(j.cuenta_id) ?? "—",
                estado: j.estado,
                diferencia: j.resultado?.cuadre?.diferencia ?? null,
                moneda: monedaDeCuenta.get(j.cuenta_id) ?? null,
              }))}
            />
          )}
          <GanchoAprendizaje ap={aprendizaje} />
        </aside>
      </div>
    </div>
  );
}
