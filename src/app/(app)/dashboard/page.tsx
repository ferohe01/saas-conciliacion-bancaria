/**
 * DIRECCIÓN — Panel de control
 *
 * THESIS: un tablero de mando que abre con lo que reclama criterio humano, no
 * con una vitrina de porcentajes. Rechaza el muro de tarjetas gemelas ícono +
 * título + texto que la categoría envía por defecto.
 * OWN-WORLD: "El Libro Mayor Iluminado" heredado — franja de cifras dividida
 * por filetes de 1px como el encabezado de un libro mayor, papel mate, color
 * solo donde algo pasó, `tabular-nums` en cada número.
 * STORY: el usuario entiende en un vistazo si el período cuadra, cuánto trabajo
 * le espera y cómo viene el año; cada cifra es un enlace a su detalle.
 * FIRST VIEWPORT: encabezado, franja de cuatro cifras, y debajo tendencia del
 * año junto a la distribución por método.
 * FORM: tablero denso dentro del shell lateral fijado por el usuario.
 */

import Link from "next/link";
import { getEmpresaActual } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getResumenAprendizaje } from "@/lib/aprendizaje-servidor";
import { GanchoAprendizaje } from "@/components/aprendizaje/GanchoAprendizaje";
import { formatearFecha } from "@/lib/parsing/resumen";
import { BancoIcon } from "@/components/wizard/icons";
import { EstadoVacio, BadgeEstadoJob, Tarjeta, clasesBoton } from "@/components/ui";
import { estadoSuscripcion } from "@/lib/suscripcion";
import {
  PruebaVencida,
  PruebaPorVencer,
  ChipPrueba,
} from "@/components/app/AvisoPrueba";
import {
  calcularKpis,
  porMes,
  filtrarAnual,
  filtrarMes,
  enFocoDelFiltro,
  deduplicarUltimoPorPeriodo,
  COLOR_METODO,
  type JobReporte,
  type ResumenJob,
} from "@/lib/reportes";
import { FiltrosReporte } from "@/components/reportes/FiltrosReporte";
import { AvisoSinAprobar } from "@/components/conciliacion/AvisoSinAprobar";
import { nombreMes } from "@/lib/periodo";

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
  resultado: {
    matches?: { estado_revision?: string }[];
    cuadre?: { diferencia: number };
  } | null;
};

const NUM = (n: number) => n.toLocaleString("es-PE");

/** Una celda de la franja de cifras. El valor manda; la etiqueta va encima. */
function Cifra({
  etiqueta,
  valor,
  nota,
  tono = "neutro",
  href,
}: {
  etiqueta: string;
  valor: string;
  nota?: React.ReactNode;
  tono?: "neutro" | "cuadre" | "atencion";
  href?: string;
}) {
  const color =
    tono === "cuadre"
      ? "text-emerald-700"
      : tono === "atencion"
        ? "text-amber-700"
        : "text-neutral-900";

  const cuerpo = (
    <>
      <p className="text-[0.6875rem] font-medium tracking-[0.05em] text-neutral-500 uppercase">
        {etiqueta}
      </p>
      <p className={`mt-2 text-3xl leading-none font-bold tabular-nums ${color}`}>
        {valor}
      </p>
      {nota && <p className="mt-2 text-sm text-neutral-600">{nota}</p>}
    </>
  );

  return href ? (
    <Link
      href={href}
      className="block h-full bg-white px-5 py-4 transition-colors hover:bg-neutral-50"
    >
      {cuerpo}
    </Link>
  ) : (
    <div className="h-full bg-white px-5 py-4">{cuerpo}</div>
  );
}

/** Tendencia del año: doce columnas, altura por registros procesados. */
function Tendencia({
  datos,
  anio,
}: {
  datos: ReturnType<typeof porMes>;
  anio: number;
}) {
  const max = Math.max(...datos.map((d) => d.registros), 1);
  const hayDatos = datos.some((d) => d.registros > 0);

  return (
    <section
      aria-labelledby="h-tendencia"
      className="rounded-2xl border border-neutral-200 bg-white p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="h-tendencia" className="font-semibold text-neutral-900">
          Volumen del año
        </h2>
        <span className="text-xs tabular-nums text-neutral-500">{anio}</span>
      </div>

      {hayDatos ? (
        <>
          <ol className="mt-5 flex h-36 items-end gap-1.5" aria-hidden>
            {datos.map((d) => (
              <li key={d.mes} className="flex h-full flex-1 flex-col justify-end">
                <div
                  className="rounded-t-sm bg-neutral-800"
                  style={{
                    height: `${Math.max((d.registros / max) * 100, d.registros > 0 ? 3 : 0)}%`,
                  }}
                />
              </li>
            ))}
          </ol>
          <ol className="mt-2 flex gap-1.5">
            {datos.map((d) => (
              <li
                key={d.mes}
                className="flex-1 text-center text-[0.6875rem] text-neutral-500"
              >
                {d.etiqueta}
              </li>
            ))}
          </ol>
          {/* El gráfico es decorativo; la tabla lleva el dato accesible. */}
          <table className="sr-only">
            <caption>Registros procesados por mes en {anio}</caption>
            <tbody>
              {datos.map((d) => (
                <tr key={d.mes}>
                  <th scope="row">{d.etiqueta}</th>
                  <td>{NUM(d.registros)} registros</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="mt-4 text-sm text-neutral-600">
          Aún no hay conciliaciones de {anio}. Cuando cierres tu primer período
          aparecerá aquí la tendencia del año.
        </p>
      )}
    </section>
  );
}

/** Distribución por método. Paleta Okabe-Ito: esto es un gráfico, no UI. */
function Metodos({
  metodos,
  total,
}: {
  metodos: { exacta: number; difusa: number; ia: number; sin_conciliar: number };
  total: number;
}) {
  const filas = [
    { clave: "exacta", label: "Exacta", valor: metodos.exacta },
    { clave: "difusa", label: "Difusa", valor: metodos.difusa },
    { clave: "ia", label: "Sugerido IA", valor: metodos.ia },
    { clave: "sin_conciliar", label: "Sin conciliar", valor: metodos.sin_conciliar },
  ] as const;

  return (
    <section
      aria-labelledby="h-metodos"
      className="rounded-2xl border border-neutral-200 bg-white p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="h-metodos" className="font-semibold text-neutral-900">
          Cómo se concilió
        </h2>
        <Link
          href="/reportes"
          className="rounded text-sm font-medium text-blue-700 transition-colors hover:text-blue-800"
        >
          Ver reportes
        </Link>
      </div>

      {total > 0 ? (
        <>
          <div
            className="mt-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
            aria-hidden
          >
            {filas
              .filter((f) => f.valor > 0)
              .map((f) => (
                <div
                  key={f.clave}
                  style={{
                    width: `${(f.valor / total) * 100}%`,
                    backgroundColor: COLOR_METODO[f.clave],
                  }}
                />
              ))}
          </div>
          <ul className="mt-4 space-y-2.5">
            {filas.map((f) => (
              <li key={f.clave} className="flex items-center gap-2.5 text-sm">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: COLOR_METODO[f.clave] }}
                />
                <span className="flex-1 text-neutral-700">{f.label}</span>
                <span className="tabular-nums text-neutral-900">{NUM(f.valor)}</span>
                <span className="w-12 text-right tabular-nums text-neutral-500">
                  {total > 0 ? Math.round((f.valor / total) * 100) : 0}%
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-sm text-neutral-600">
          Todavía no hay partidas conciliadas que resumir.
        </p>
      )}
    </section>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const empresa = await getEmpresaActual();
  const supabase = await createClient();
  const suscripcion = estadoSuscripcion(empresa ?? {});

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
      .select(
        "id, estado, estado_contable, cuenta_id, periodo_desde, periodo_hasta, resultado",
      )
      .not("estado_contable", "in", "(anulada,reemplazada)")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.from("cuentas_bancarias").select("id", { count: "exact", head: true }),
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, numero_enmascarado")
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

  const jobsDef = filtrarMes(
    filtrarAnual(todas, { anio, banco: bancoSel, cuentaId: cuentaSel }),
    mes,
  );

  const hayFiltroFino =
    mes !== "todos" || bancoSel !== "todos" || cuentaSel !== "todos";

  const kpis = calcularKpis(jobsDef);
  const mensual = porMes(jobsDef);
  const totalPartidas =
    kpis.metodos.exacta +
    kpis.metodos.difusa +
    kpis.metodos.ia +
    kpis.metodos.sin_conciliar;

  const sinCuentas = (numCuentas ?? 0) === 0;

  // El filtro tiene que alcanzar a TODO lo que hay en la página, no solo a las
  // cifras agregadas. Cuando no lo hacía, elegir una cuenta sin conciliaciones
  // seguía anunciando las sugerencias pendientes de otra cuenta: el panel decía
  // que había trabajo justo donde no lo había.
  const bancoDeCuenta = new Map(cuentas.map((c) => [c.id, c.banco]));
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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Panel de control
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            {empresa?.nombre} · ejercicio <span className="tabular-nums">{anio}</span>
            {hayFiltroFino && (
              <>
                {" · "}
                <span className="font-medium text-neutral-800">
                  {[
                    mes !== "todos" ? nombreMes(mes) : null,
                    bancoSel !== "todos" ? bancoSel : null,
                    cuentaSel !== "todos"
                      ? (cuentas.find((c) => c.id === cuentaSel)
                          ?.numero_enmascarado ?? "cuenta")
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </>
            )}
          </p>
          <div className="mt-2">
            <ChipPrueba estado={suscripcion} />
          </div>
        </div>
        {suscripcion.puedeConciliar && (
          <Link href="/wizard" className={clasesBoton("primario", "md")}>
            Conciliar un período
          </Link>
        )}
      </header>

      {/* El estado de la cuenta va antes que nada: cambia lo que el usuario
          puede hacer en esta pantalla. */}
      {suscripcion.expirada ? (
        <PruebaVencida />
      ) : (
        <PruebaPorVencer estado={suscripcion} />
      )}

      {/* Las cifras de abajo solo cuentan lo aprobado. Si hay conciliaciones
          terminadas sin aprobar, callarlo haría pensar que se perdieron. */}
      <AvisoSinAprobar cuantas={sinAprobar ?? 0} />

      {/* Elegir qué conciliaciones se están mirando, antes de mirarlas. */}
      <FiltrosReporte
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

      {/* Un recorte vacío enseñado como ceros se lee como "no tienes nada",
          no como "no hay nada aquí". Hay que decir cuál de las dos es. */}
      {enFoco.length === 0 && jobsDef.length === 0 && (
        <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-600">
          No hay conciliaciones para este recorte
          {hayFiltroFino ? "" : ` del ejercicio ${anio}`}. Prueba con otro
          período o cuenta{hayFiltroFino ? ", o quita los filtros" : ""}.
        </p>
      )}

      {/* Lo que reclama criterio humano va antes que cualquier métrica. */}
      {porRevisar > 0 && jobConPendientes && (
        <Tarjeta tono="maquina">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-neutral-900">
                <span className="tabular-nums">{porRevisar}</span>{" "}
                {porRevisar === 1
                  ? "sugerencia espera tu revisión"
                  : "sugerencias esperan tu revisión"}
              </p>
              <p className="mt-0.5 text-sm text-neutral-700">
                La IA propuso estos emparejamientos; nada se concilia sin que tú lo
                apruebes.
              </p>
            </div>
            <Link
              href={`/conciliacion/${jobConPendientes.id}`}
              className={clasesBoton("primario", "md")}
            >
              Revisar ahora
            </Link>
          </div>
        </Tarjeta>
      )}

      {/* Franja de cifras: un solo contenedor dividido por filetes, como el
          encabezado de un libro mayor. No cuatro tarjetas sueltas. */}
      {/* El filete lo dibuja el fondo del contenedor asomando por el gap de 1px:
          así cae correcto tanto en 2 columnas (tablet) como en 4 (escritorio),
          sin bordes puestos a mano por celda. */}
      <section
        aria-label="Indicadores del ejercicio"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 lg:grid-cols-4"
      >
        <Cifra
          etiqueta="Por revisar"
          valor={NUM(porRevisar)}
          tono={porRevisar > 0 ? "atencion" : "neutro"}
          nota={porRevisar > 0 ? "sugerencias de la IA" : "nada pendiente"}
          href={jobConPendientes ? `/conciliacion/${jobConPendientes.id}` : undefined}
        />
        <Cifra
          etiqueta="Períodos cuadrados"
          valor={`${NUM(kpis.jobsCuadrados)}/${NUM(kpis.conciliaciones)}`}
          tono={
            kpis.conciliaciones > 0 && kpis.jobsCuadrados === kpis.conciliaciones
              ? "cuadre"
              : "neutro"
          }
          nota="diferencia S/ 0.00"
        />
        <Cifra
          etiqueta="Automatización"
          valor={`${kpis.pctAutomatizacion.toLocaleString("es-PE")}%`}
          nota="conciliado sin intervención"
          href="/reportes"
        />
        <Cifra
          etiqueta="Movimientos"
          valor={NUM(kpis.movimientos)}
          nota={`${NUM(kpis.registros)} registros internos`}
          href="/reportes"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Tendencia datos={mensual} anio={anio} />
        <Metodos metodos={kpis.metodos} total={totalPartidas} />
      </div>

      {recientes.length > 0 && (
        <section
          aria-labelledby="h-recientes"
          className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-neutral-200 px-5 py-4">
            <h2 id="h-recientes" className="font-semibold text-neutral-900">
              Últimas conciliaciones
            </h2>
            <Link
              href="/conciliacion"
              className="rounded text-sm font-medium text-blue-700 transition-colors hover:text-blue-800"
            >
              Ver todas
            </Link>
          </div>
          <ul className="divide-y divide-neutral-200">
            {recientes.map((j) => {
              const dif = j.resultado?.cuadre?.diferencia;
              const cuadra = dif != null && Math.abs(dif) < 0.005;
              return (
                <li key={j.id}>
                  <Link
                    href={`/conciliacion/${j.id}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 transition-colors hover:bg-neutral-50"
                  >
                    <span className="text-sm tabular-nums text-neutral-800">
                      {formatearFecha(j.periodo_desde)} – {formatearFecha(j.periodo_hasta)}
                    </span>
                    <span className="flex items-center gap-3">
                      {dif != null && (
                        <span
                          className={`text-sm font-medium ${cuadra ? "text-emerald-800" : "text-amber-800"}`}
                        >
                          {cuadra ? "Cuadra" : "Con diferencia"}
                        </span>
                      )}
                      <BadgeEstadoJob estado={j.estado} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <GanchoAprendizaje ap={aprendizaje} />
    </div>
  );
}
