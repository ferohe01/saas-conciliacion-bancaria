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
import { resumenAprendizaje } from "@/lib/aprendizaje";
import { PanelAprendizajeCompacto } from "@/components/reportes/ReporteVista";
import { formatearFecha } from "@/lib/parsing/resumen";
import { BancoIcon } from "@/components/wizard/icons";
import { EstadoVacio, BadgeEstadoJob, Tarjeta, clasesBoton } from "@/components/ui";
import { estadoSuscripcion } from "@/lib/suscripcion";
import { PruebaVencida, PruebaPorVencer } from "@/components/app/AvisoPrueba";
import {
  calcularKpis,
  porMes,
  deduplicarUltimoPorPeriodo,
  COLOR_METODO,
  type JobReporte,
  type ResumenJob,
} from "@/lib/reportes";

type CuentaJoin =
  | { banco: string }
  | { banco: string }[]
  | null;

type JobRaw = {
  id: string;
  periodo_desde: string;
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

export default async function DashboardPage() {
  const empresa = await getEmpresaActual();
  const supabase = await createClient();
  const anio = new Date().getUTCFullYear();
  const suscripcion = estadoSuscripcion(empresa ?? {});

  const [
    { data: histAprend },
    { data: completadosData },
    { data: recientesData },
    { count: numCuentas },
  ] = await Promise.all([
    // Pool de aprendizaje: mismo criterio que el few-shot del backend.
    supabase
      .from("jobs_conciliacion")
      .select("resultado")
      .eq("estado", "completado")
      .not("resultado", "is", null)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("jobs_conciliacion")
      .select(
        "id, periodo_desde, cuenta_id, created_at, resultado, cuentas_bancarias(banco)",
      )
      .eq("estado", "completado")
      .gte("periodo_desde", `${anio}-01-01`)
      .lte("periodo_desde", `${anio}-12-31`),
    supabase
      .from("jobs_conciliacion")
      .select("id, estado, periodo_desde, periodo_hasta, resultado")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("cuentas_bancarias").select("id", { count: "exact", head: true }),
  ]);

  const aprendizaje = resumenAprendizaje(
    (histAprend ?? []) as Parameters<typeof resumenAprendizaje>[0],
  );

  // Normalizar a JobReporte y quedarse con una corrida por período+cuenta.
  const jobs: JobReporte[] = [];
  for (const j of (completadosData ?? []) as JobRaw[]) {
    const resumen = j.resultado?.resumen;
    if (!resumen) continue;
    const cuenta = Array.isArray(j.cuentas_bancarias)
      ? j.cuentas_bancarias[0]
      : j.cuentas_bancarias;
    jobs.push({
      id: j.id,
      anio: Number(j.periodo_desde.slice(0, 4)),
      mes: Number(j.periodo_desde.slice(5, 7)),
      banco: cuenta?.banco ?? "—",
      cuentaId: j.cuenta_id,
      numero: null,
      resumen,
      diferenciaCuadre: Number(j.resultado?.cuadre?.diferencia ?? 0),
      createdAt: j.created_at,
    });
  }
  const jobsDef = deduplicarUltimoPorPeriodo(jobs);
  const kpis = calcularKpis(jobsDef);
  const mensual = porMes(jobsDef);
  const totalPartidas =
    kpis.metodos.exacta +
    kpis.metodos.difusa +
    kpis.metodos.ia +
    kpis.metodos.sin_conciliar;

  const recientes = (recientesData ?? []) as JobDash[];
  const sinCuentas = (numCuentas ?? 0) === 0;

  // Lo único que de verdad reclama a la persona: sugerencias sin criterio.
  const porRevisar = recientes.reduce(
    (acc, j) =>
      acc +
      (j.resultado?.matches ?? []).filter((m) => m.estado_revision === "pendiente")
        .length,
    0,
  );
  const jobConPendientes = recientes.find((j) =>
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
          </p>
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

      <PanelAprendizajeCompacto ap={aprendizaje} />
    </div>
  );
}
