import Link from "next/link";
import {
  COLOR_METODO,
  type Kpis,
  type PuntoMensual,
  type FilaBanco,
  type FilaTipo,
} from "@/lib/reportes";
import { formatearFecha } from "@/lib/parsing/resumen";

/** Vista del reporte (server component, sin interacción salvo hover nativo). */

const NUM = (n: number) => n.toLocaleString("es-PE");

export function ReporteVista({
  kpis,
  mensual,
  bancos,
  tipos,
  recientes,
  filtroQuery,
}: {
  kpis: Kpis;
  mensual: PuntoMensual[];
  bancos: FilaBanco[];
  tipos: FilaTipo[];
  recientes: {
    id: string;
    periodo_desde: string;
    banco: string;
    numero: string | null;
    estado: string;
  }[];
  filtroQuery: string;
}) {
  return (
    <div className="space-y-6">
      <KpiFila kpis={kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        <GraficoMensual datos={mensual} />
        <DistribucionMetodos kpis={kpis} filtroQuery={filtroQuery} />
      </div>

      <TiposDiferencia tipos={tipos} />

      <TablaBancos bancos={bancos} />

      {recientes.length > 0 && <TablaRecientes recientes={recientes} />}
    </div>
  );
}

// ── KPIs (stat tiles) ───────────────────────────────────────────────────────
function KpiFila({ kpis }: { kpis: Kpis }) {
  const tiles = [
    { label: "Conciliaciones", valor: NUM(kpis.conciliaciones) },
    { label: "Registros procesados", valor: NUM(kpis.registros) },
    {
      label: "Automatización",
      valor: `${kpis.pctAutomatizacion}%`,
      hero: true,
      sub: `${NUM(kpis.autoConciliados)} conciliados sin intervención`,
    },
    {
      label: "Períodos cuadrados",
      valor: `${kpis.pctCuadre}%`,
      sub: `${NUM(kpis.jobsCuadrados)} de ${NUM(kpis.conciliaciones)}`,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={[
            "rounded-2xl border p-5",
            t.hero
              ? "border-emerald-200 bg-emerald-50"
              : "border-neutral-200 bg-white",
          ].join(" ")}
        >
          <p className="text-xs font-medium text-neutral-500">{t.label}</p>
          <p
            className={[
              "mt-1 text-3xl font-bold tabular-nums",
              t.hero ? "text-emerald-700" : "text-neutral-900",
            ].join(" ")}
          >
            {t.valor}
          </p>
          {t.sub && <p className="mt-1 text-xs text-neutral-500">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Barras: registros procesados por mes (una serie, un tono) ───────────────
function GraficoMensual({ datos }: { datos: PuntoMensual[] }) {
  const max = Math.max(1, ...datos.map((d) => d.registros));
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <p className="font-semibold text-neutral-900">Volumen por mes</p>
      <p className="text-xs text-neutral-500">Registros procesados</p>
      <div className="mt-4 flex h-40 items-end gap-1.5">
        {datos.map((d) => (
          <div
            key={d.mes}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${d.etiqueta}: ${NUM(d.registros)} registros · ${d.pctAutomatizacion}% automatizado`}
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-neutral-800"
                style={{
                  height: `${(d.registros / max) * 100}%`,
                  minHeight: d.registros > 0 ? "3px" : "0",
                }}
              />
            </div>
            <span className="text-[10px] text-neutral-400">{d.etiqueta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Distribución de métodos (barra apilada categórica + leyenda con enlaces) ─
function DistribucionMetodos({
  kpis,
  filtroQuery,
}: {
  kpis: Kpis;
  filtroQuery: string;
}) {
  const m = kpis.metodos;
  const total = m.exacta + m.difusa + m.ia + m.sin_conciliar || 1;
  const segs = [
    { k: "Exacta", slug: "exacta", v: m.exacta, c: COLOR_METODO.exacta },
    { k: "Difusa", slug: "difusa", v: m.difusa, c: COLOR_METODO.difusa },
    { k: "Sugerido IA", slug: "ia", v: m.ia, c: COLOR_METODO.ia },
    {
      k: "Sin conciliar",
      slug: "sin-conciliar",
      v: m.sin_conciliar,
      c: COLOR_METODO.sin_conciliar,
    },
  ];
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <p className="font-semibold text-neutral-900">Cómo se concilió</p>
      <p className="text-xs text-neutral-500">
        Distribución por método · haz clic para ver el detalle
      </p>

      <div className="mt-4 flex h-4 w-full gap-0.5 overflow-hidden rounded-full">
        {segs.map(
          (s) =>
            s.v > 0 && (
              <div
                key={s.k}
                title={`${s.k}: ${NUM(s.v)} (${Math.round((s.v / total) * 100)}%)`}
                style={{ width: `${(s.v / total) * 100}%`, background: s.c }}
              />
            ),
        )}
      </div>

      <ul className="mt-4 space-y-1">
        {segs.map((s) => (
          <li key={s.k}>
            <Link
              href={`/reportes/${s.slug}?${filtroQuery}`}
              className="group flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-neutral-50"
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ background: s.c }}
                  aria-hidden
                />
                <span className="text-neutral-700 group-hover:text-blue-600">
                  {s.k}
                </span>
              </span>
              <span className="flex items-center gap-2 tabular-nums text-neutral-900">
                {NUM(s.v)}{" "}
                <span className="text-neutral-400">
                  ({Math.round((s.v / total) * 100)}%)
                </span>
                <span className="text-neutral-300 group-hover:text-blue-600">
                  →
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Tipo de diferencia (reason codes) — barras ranqueadas, un solo tono ─────
function TiposDiferencia({ tipos }: { tipos: FilaTipo[] }) {
  if (tipos.length === 0) return null;
  const total = tipos.reduce((a, t) => a + t.valor, 0) || 1;
  const max = Math.max(...tipos.map((t) => t.valor), 1);
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <p className="font-semibold text-neutral-900">Tipo de diferencia</p>
      <p className="text-xs text-neutral-500">
        Cómo se distribuyen los pares conciliados por tipo (reason codes)
      </p>
      <ul className="mt-4 space-y-2.5">
        {tipos.map((t) => (
          <li key={t.tipo}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-700">{t.label}</span>
              <span className="tabular-nums text-neutral-900">
                {NUM(t.valor)}{" "}
                <span className="text-neutral-400">
                  ({Math.round((t.valor / total) * 100)}%)
                </span>
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-2 rounded-full bg-neutral-800"
                style={{ width: `${(t.valor / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Desglose por banco ──────────────────────────────────────────────────────
function TablaBancos({ bancos }: { bancos: FilaBanco[] }) {
  if (bancos.length === 0) return null;
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <p className="font-semibold text-neutral-900">Por banco</p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Banco</th>
              <th className="py-2 pr-4 font-medium">Conciliaciones</th>
              <th className="py-2 pr-4 font-medium">Registros</th>
              <th className="py-2 font-medium">Automatización</th>
            </tr>
          </thead>
          <tbody>
            {bancos.map((b) => (
              <tr key={b.banco} className="border-t border-neutral-100">
                <td className="py-2 pr-4 font-medium text-neutral-800">
                  {b.banco}
                </td>
                <td className="py-2 pr-4 tabular-nums">{NUM(b.conciliaciones)}</td>
                <td className="py-2 pr-4 tabular-nums">{NUM(b.registros)}</td>
                <td className="py-2 tabular-nums">{b.pctAutomatizacion}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Conciliaciones recientes ────────────────────────────────────────────────
function TablaRecientes({
  recientes,
}: {
  recientes: {
    id: string;
    periodo_desde: string;
    banco: string;
    numero: string | null;
    estado: string;
  }[];
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <p className="font-semibold text-neutral-900">Conciliaciones del filtro</p>
      <ul className="mt-3 divide-y divide-neutral-100">
        {recientes.map((j) => (
          <li key={j.id}>
            <Link
              href={`/conciliacion/${j.id}`}
              className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-blue-600"
            >
              <span className="text-neutral-700">
                {formatearFecha(j.periodo_desde)} · {j.banco}{" "}
                {j.numero ?? ""}
              </span>
              <span className="font-mono text-xs text-neutral-400">
                {j.id}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
