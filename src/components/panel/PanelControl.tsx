/**
 * Piezas del panel de control (terminal financiera clara).
 *
 * Todas son de servidor y solo presentan lo que la página ya calculó: ninguna
 * consulta datos por su cuenta.
 */

import Link from "next/link";
import { BadgeEstadoJob } from "@/components/ui";
import { formatearFecha } from "@/lib/parsing/resumen";
import { nombreMes } from "@/lib/periodo";
import {
  COLOR_METODO,
  ETIQUETA_METODO,
  type FilaBanco,
  type PuntoMensual,
} from "@/lib/reportes";
import { cuadra, formatoDinero, type Variacion } from "@/lib/panelControl";

const NUM = (n: number) => n.toLocaleString("es-PE");
const PCT = (n: number) => `${n.toLocaleString("es-PE")}%`;

/** Rótulo de columna del libro mayor: el único kicker del panel. */
function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[0.6875rem] font-medium tracking-[0.05em] text-neutral-500 uppercase">
      {children}
    </p>
  );
}

// ── Franja de indicadores ──────────────────────────────────────────────────

type Tono = "neutro" | "cuadre" | "atencion" | "descuadre";

const COLOR_TONO: Record<Tono, string> = {
  neutro: "text-neutral-900",
  cuadre: "text-emerald-700",
  atencion: "text-amber-700",
  descuadre: "text-red-600",
};

/**
 * Una celda de la franja. El valor manda; la etiqueta va encima y la nota
 * debajo. La franja entera es UN contenedor dividido por filetes de 1px —el
 * encabezado de un libro mayor—, no seis tarjetas sueltas.
 */
export function Indicador({
  etiqueta,
  valor,
  nota,
  tono = "neutro",
  href,
  variacion,
}: {
  etiqueta: string;
  valor: string;
  nota?: React.ReactNode;
  tono?: Tono;
  href?: string;
  variacion?: React.ReactNode;
}) {
  // Cada celda es su propio contenedor: la cifra baja un escalón cuando la
  // celda es estrecha, en vez de partirse («1,350,40 / 2» no se lee), y la
  // etiqueta reserva dos líneas para que todas las cifras de la fila alineen.
  const cuerpo = (
    <>
      <div className="@max-[9rem]:min-h-[2.6em]">
        <Rotulo>{etiqueta}</Rotulo>
      </div>
      <p
        className={`mt-2 text-2xl leading-none font-bold tracking-tight whitespace-nowrap tabular-nums @min-[10rem]:text-3xl ${COLOR_TONO[tono]}`}
      >
        {valor}
      </p>
      {variacion && <div className="mt-2">{variacion}</div>}
      {nota && <p className="mt-1.5 text-[0.8125rem] leading-snug text-neutral-600">{nota}</p>}
    </>
  );
  return href ? (
    <Link
      href={href}
      className="@container block h-full bg-white px-4 py-4 transition-colors hover:bg-neutral-50 focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:outline-none"
    >
      {cuerpo}
    </Link>
  ) : (
    <div className="@container h-full bg-white px-4 py-4">{cuerpo}</div>
  );
}

/**
 * «▲ 2,1 pts vs mayo». La flecha y la palabra llevan el sentido; el color no
 * (DESIGN.md: las cifras no se pintan por énfasis).
 */
export function TextoVariacion({ v }: { v: Variacion }) {
  const igual = v.puntos === 0;
  const sube = v.puntos > 0;
  return (
    <p className="text-[0.8125rem] font-medium tabular-nums text-neutral-700">
      <span aria-hidden>{igual ? "＝" : sube ? "▲" : "▼"}</span>{" "}
      <span className="sr-only">{igual ? "igual" : sube ? "sube" : "baja"}</span>
      {igual ? "sin cambio" : `${Math.abs(v.puntos).toLocaleString("es-PE")} pts`}{" "}
      <span className="font-normal text-neutral-500">
        vs {nombreMes(v.mesAnterior).toLowerCase()}
      </span>
    </p>
  );
}

// ── Tendencia del año ──────────────────────────────────────────────────────

/**
 * Doce meses de un vistazo: barras con el volumen de registros conciliados y
 * una línea con el % que se concilió solo. Dos escalas, y la leyenda lo dice:
 * la línea va de 0 a 100 % aunque las barras sean miles.
 *
 * Con un mes elegido en el filtro, su barra se marca en azul —el color de
 * «aquí estás mirando»— y el resto se apaga.
 */
export function TendenciaAnual({
  datos,
  anio,
  mesSel,
}: {
  datos: PuntoMensual[];
  anio: number;
  mesSel: number | "todos";
}) {
  const max = Math.max(...datos.map((d) => d.registros), 1);
  const hayDatos = datos.some((d) => d.registros > 0);

  // La línea se corta donde no hubo conciliación: unir dos meses saltando uno
  // vacío dibujaría una tendencia que nadie midió.
  const tramos: string[] = [];
  let actual: string[] = [];
  datos.forEach((d, i) => {
    if (d.registros > 0) actual.push(`${i + 0.5},${100 - d.pctAutomatizacion}`);
    else if (actual.length) {
      tramos.push(actual.join(" "));
      actual = [];
    }
  });
  if (actual.length) tramos.push(actual.join(" "));
  const sueltos = datos
    .map((d, i) => ({ d, i }))
    .filter(({ d, i }) => d.registros > 0 && !(datos[i - 1]?.registros) && !(datos[i + 1]?.registros));

  return (
    <section
      aria-labelledby="h-tendencia"
      className="rounded-2xl border border-neutral-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="h-tendencia" className="font-semibold text-neutral-900">
          Tendencia del año <span className="font-normal tabular-nums text-neutral-500">{anio}</span>
        </h2>
        {hayDatos && (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-neutral-800" />
              Registros conciliados
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-0.5 w-4 rounded-full"
                style={{ backgroundColor: COLOR_METODO.exacta }}
              />
              % conciliado solo (0–100 %)
            </li>
          </ul>
        )}
      </div>

      {hayDatos ? (
        <>
          <div className="relative mt-5 h-44" aria-hidden>
            {/* Guías de 0, 50 y 100 % para leer la línea sin adivinar. */}
            {[0, 50, 100].map((g) => (
              <div
                key={g}
                className="absolute inset-x-0 border-t border-dashed border-neutral-200"
                style={{ top: `${100 - g}%` }}
              >
                <span className="absolute -top-2 right-0 bg-white pl-1 text-[0.6875rem] tabular-nums text-neutral-500">
                  {g}%
                </span>
              </div>
            ))}
            <ol className="absolute inset-0 flex items-end gap-1.5 pr-8">
              {datos.map((d) => {
                const marcado = mesSel !== "todos" && d.mes === mesSel;
                const apagado = mesSel !== "todos" && !marcado;
                return (
                  <li key={d.mes} className="flex h-full flex-1 flex-col justify-end">
                    <div
                      title={`${nombreMes(d.mes)}: ${NUM(d.registros)} registros · ${PCT(d.pctAutomatizacion)} solo`}
                      className={`rounded-t-sm ${
                        marcado ? "bg-blue-600" : apagado ? "bg-neutral-300" : "bg-neutral-800"
                      }`}
                      style={{
                        height: `${Math.max((d.registros / max) * 82, d.registros > 0 ? 3 : 0)}%`,
                      }}
                    />
                  </li>
                );
              })}
            </ol>
            <svg
              className="pointer-events-none absolute inset-0 h-full w-[calc(100%-2rem)]"
              viewBox="0 0 12 100"
              preserveAspectRatio="none"
            >
              {tramos.map((p) => (
                <polyline
                  key={p}
                  points={p}
                  fill="none"
                  stroke={COLOR_METODO.exacta}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {/* Un mes aislado no tiene con quién unirse: se marca con un trazo
                  corto para que no desaparezca de la línea. */}
              {sueltos.map(({ d, i }) => (
                <line
                  key={d.mes}
                  x1={i + 0.25}
                  x2={i + 0.75}
                  y1={100 - d.pctAutomatizacion}
                  y2={100 - d.pctAutomatizacion}
                  stroke={COLOR_METODO.exacta}
                  strokeWidth={2.5}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </div>
          <ol className="mt-2 flex gap-1.5 pr-8" aria-hidden>
            {datos.map((d) => (
              <li
                key={d.mes}
                className={`flex-1 text-center text-[0.6875rem] ${
                  mesSel !== "todos" && d.mes === mesSel
                    ? "font-semibold text-blue-700"
                    : "text-neutral-500"
                }`}
              >
                {d.etiqueta}
              </li>
            ))}
          </ol>
          {/* El gráfico es visual; la tabla lleva el dato accesible.
              ⚠️ `sr-only` va en un div y no en la tabla: una <table> ignora el
              width de 1px, crece hasta su contenido y desbordaba la página en
              móvil (scroll horizontal sin nada visible que lo explicara). */}
          <div className="sr-only">
          <table>
            <caption>Registros conciliados y porcentaje conciliado solo, por mes de {anio}</caption>
            <tbody>
              {datos.map((d) => (
                <tr key={d.mes}>
                  <th scope="row">{nombreMes(d.mes)}</th>
                  <td>{NUM(d.registros)} registros</td>
                  <td>{PCT(d.pctAutomatizacion)} conciliado solo</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-neutral-600">
          Aún no hay conciliaciones aprobadas de {anio}. Cuando apruebes tu primer
          período aparecerá aquí la tendencia del año.
        </p>
      )}
    </section>
  );
}

// ── Cómo se concilió ───────────────────────────────────────────────────────

/**
 * Distribución por método. Paleta Okabe-Ito: esto es un gráfico, no UI.
 *
 * ⚠️ La barra cuenta PARES y «sin conciliar» no es un método: las partidas
 * sueltas se dicen aparte, por lado y con su % sobre las partidas de los dos
 * lados, que es la única base con la que cuadra (ver el historial de este
 * componente en el panel anterior: un cliente cazó el «2 %» sin sentido).
 */
export function ComoSeConcilio({
  metodos,
  total,
  sueltas,
}: {
  metodos: { exacta: number; difusa: number; ia: number };
  /** Pares conciliados: exacta + difusa + IA. */
  total: number;
  sueltas: { internos: number; bancarios: number; pct: number };
}) {
  const filas = [
    { clave: "exacta", label: ETIQUETA_METODO.exacta, valor: metodos.exacta },
    { clave: "difusa", label: ETIQUETA_METODO.difusa, valor: metodos.difusa },
    { clave: "ia", label: ETIQUETA_METODO.ia, valor: metodos.ia },
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
          Reportes
        </Link>
      </div>

      {total > 0 ? (
        <>
          <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
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
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">Pares conciliados por método</caption>
            <tbody>
              {filas.map((f) => (
                <tr key={f.clave}>
                  <th scope="row" className="py-1 text-left font-normal text-neutral-700">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: COLOR_METODO[f.clave] }}
                      />
                      {f.label}
                    </span>
                  </th>
                  <td className="py-1 text-right tabular-nums text-neutral-900">{NUM(f.valor)}</td>
                  <td className="w-14 py-1 text-right tabular-nums text-neutral-500">
                    {Math.round((f.valor / total) * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="mt-4 text-sm text-neutral-600">Todavía no hay pares conciliados que resumir.</p>
      )}

      {sueltas.internos + sueltas.bancarios > 0 && (
        <Link
          href="/reportes/sin-conciliar"
          className="group mt-3 block border-t border-neutral-200 pt-3 text-sm"
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: COLOR_METODO.sin_conciliar }}
            />
            <span className="flex-1 text-neutral-700 group-hover:text-blue-700">
              {ETIQUETA_METODO.sin_conciliar}
            </span>
            <span className="tabular-nums text-neutral-900">
              {NUM(sueltas.internos + sueltas.bancarios)}
            </span>
            <span className="w-14 text-right tabular-nums text-neutral-500">{sueltas.pct}%</span>
          </span>
          <span className="mt-0.5 block pl-[1.125rem] text-xs text-neutral-600">
            <span className="tabular-nums">{NUM(sueltas.internos)}</span> tuyos ·{" "}
            <span className="tabular-nums">{NUM(sueltas.bancarios)}</span> del banco
          </span>
        </Link>
      )}
    </section>
  );
}

// ── Por banco ──────────────────────────────────────────────────────────────

/** Una fila por banco: cuánto se concilió y qué parte salió sola. */
export function PorBanco({ filas }: { filas: FilaBanco[] }) {
  return (
    <section
      aria-labelledby="h-bancos"
      className="rounded-2xl border border-neutral-200 bg-white p-5"
    >
      <h2 id="h-bancos" className="font-semibold text-neutral-900">
        Por banco
      </h2>
      {filas.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[0.6875rem] tracking-[0.05em] text-neutral-500 uppercase">
                <th scope="col" className="pb-1.5 text-left font-medium">Banco</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Períodos</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Registros</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Solo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filas.map((f) => (
                <tr key={f.banco}>
                  <th scope="row" className="py-1.5 text-left font-medium text-neutral-800">
                    {f.banco}
                  </th>
                  <td className="py-1.5 text-right tabular-nums text-neutral-700">
                    {NUM(f.conciliaciones)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-900">
                    {NUM(f.registros)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-700">
                    {PCT(f.pctAutomatizacion)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-neutral-600">Sin conciliaciones aprobadas en este recorte.</p>
      )}
    </section>
  );
}

// ── Carril de atención ─────────────────────────────────────────────────────

export type PendienteAtencion = {
  clave: string;
  /** Forma + color del marcador: la forma lleva el sentido sin depender del color. */
  marca: "maquina" | "atencion";
  cifra: number;
  texto: string;
  detalle?: string;
  href: string;
};

/**
 * Lo que espera a una persona, en una lista ordenada por urgencia. Sustituye a
 * los banners a ancho completo que alargaban el panel: cada aviso sigue
 * existiendo, pero como una fila con su cifra y su enlace.
 */
export function CarrilAtencion({
  pendientes,
  extra,
}: {
  pendientes: PendienteAtencion[];
  extra?: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="h-atencion"
      className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <h2 id="h-atencion" className="font-semibold text-neutral-900">
          Requiere tu atención
        </h2>
        {pendientes.length > 0 && (
          <span className="text-xs tabular-nums text-neutral-500">
            {pendientes.length} {pendientes.length === 1 ? "tema" : "temas"}
          </span>
        )}
      </div>
      {extra && <div className="px-5 pb-3">{extra}</div>}
      {pendientes.length > 0 ? (
        <ul className="divide-y divide-neutral-100 border-t border-neutral-200">
          {pendientes.map((p) => (
            <li key={p.clave}>
              <Link
                href={p.href}
                className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-neutral-50"
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-2 w-2 shrink-0 ${
                    p.marca === "maquina" ? "rotate-45 bg-violet-600" : "rounded-full bg-amber-500"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-neutral-800">
                    <span className="font-semibold tabular-nums text-neutral-900">{NUM(p.cifra)}</span>{" "}
                    {p.texto}
                  </span>
                  {p.detalle && (
                    <span className="mt-0.5 block text-xs text-neutral-600">{p.detalle}</span>
                  )}
                </span>
                <span
                  aria-hidden
                  className="mt-0.5 text-sm text-neutral-400 transition-colors group-hover:text-blue-700"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 border-t border-neutral-200 px-5 py-4 text-sm text-neutral-700">
          <span aria-hidden className="font-semibold text-emerald-700">
            ✓
          </span>
          Nada esperando tu criterio en este recorte.
        </p>
      )}
    </section>
  );
}

// ── Últimas conciliaciones ─────────────────────────────────────────────────

export type FilaReciente = {
  id: string;
  desde: string;
  hasta: string;
  banco: string;
  estado: string;
  diferencia: number | null;
  moneda: string | null;
};

/** Tabla compacta: período, banco, cuadre y estado, como un libro de órdenes. */
export function UltimasConciliaciones({ filas }: { filas: FilaReciente[] }) {
  return (
    <section
      aria-labelledby="h-recientes"
      className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
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
      <ul className="divide-y divide-neutral-100 border-t border-neutral-200">
        {filas.map((f) => {
          const ok = f.diferencia != null && cuadra(f.diferencia);
          return (
            <li key={f.id}>
              <Link
                href={`/conciliacion/${f.id}`}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-5 py-2.5 transition-colors hover:bg-neutral-50"
              >
                <span className="min-w-0">
                  <span className="block text-[0.8125rem] tabular-nums text-neutral-900">
                    {f.desde === f.hasta
                      ? formatearFecha(f.desde)
                      : `${formatearFecha(f.desde)} – ${formatearFecha(f.hasta)}`}
                  </span>
                  <span className="block text-xs text-neutral-500">
                    {f.banco}
                    {f.diferencia != null && (
                      <>
                        {" · "}
                        <span
                          className={`font-medium tabular-nums ${ok ? "text-emerald-800" : "text-red-700"}`}
                        >
                          {ok ? "✓ Cuadra" : `✕ ${formatoDinero(f.diferencia, f.moneda)}`}
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <BadgeEstadoJob estado={f.estado} />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
