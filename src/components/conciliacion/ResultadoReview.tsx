"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatearPEN, formatearFecha } from "@/lib/parsing/resumen";
import { exportarResultadoExcel } from "@/lib/exportar";
import {
  registrarDecision,
  conciliarManual,
} from "@/app/(app)/conciliacion/[jobId]/actions";
import type { ResultadoConciliacion, Match } from "@/lib/contract/resultado";
import type {
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";
import type { MetodoMatch } from "@/lib/contract/enums";

type Props = {
  jobId: string;
  resultado: ResultadoConciliacion;
  internos: RegistroInterno[];
  bancarios: MovimientoBancario[];
  moneda: string;
};

const BADGE: Record<MetodoMatch, { texto: string; clase: string }> = {
  exacta: { texto: "Exacta", clase: "bg-emerald-100 text-emerald-700" },
  difusa: { texto: "Difusa", clase: "bg-blue-100 text-blue-700" },
  ia: { texto: "IA", clase: "bg-violet-100 text-violet-700" },
  manual: { texto: "Manual", clase: "bg-neutral-200 text-neutral-700" },
};

function Badge({ match }: { match: Match }) {
  const b = BADGE[match.metodo];
  const conf =
    match.metodo === "ia" && match.confianza != null
      ? ` ${Math.round(match.confianza * 100)}%`
      : "";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${b.clase}`}
    >
      {b.texto}
      {conf}
    </span>
  );
}

export function ResultadoReview({
  jobId,
  resultado,
  internos,
  bancarios,
  moneda,
}: Props) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [seleccion, setSeleccion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Selección para conciliación manual.
  const [selInt, setSelInt] = useState<Set<string>>(new Set());
  const [selMov, setSelMov] = useState<Set<string>>(new Set());

  const internoById = useMemo(
    () => new Map(internos.map((r) => [r.id_interno, r])),
    [internos],
  );
  const movById = useMemo(
    () => new Map(bancarios.map((m) => [m.id_movimiento, m])),
    [bancarios],
  );

  // Índices de match activo (no rechazado) por id.
  const { matchDeInterno, matchDeMov } = useMemo(() => {
    const mi = new Map<string, number>();
    const mm = new Map<string, number>();
    resultado.matches.forEach((match, idx) => {
      if (match.estado_revision === "rechazado") return;
      match.ids_internos.forEach((id) => mi.set(id, idx));
      match.ids_movimientos.forEach((id) => mm.set(id, idx));
    });
    return { matchDeInterno: mi, matchDeMov: mm };
  }, [resultado]);

  const colaIA = useMemo(
    () =>
      resultado.matches
        .map((m, idx) => ({ m, idx }))
        .filter(
          ({ m }) => m.metodo === "ia" && m.estado_revision === "pendiente",
        ),
    [resultado],
  );

  const idsSeleccionInt =
    seleccion != null
      ? new Set(resultado.matches[seleccion]?.ids_internos ?? [])
      : new Set<string>();
  const idsSeleccionMov =
    seleccion != null
      ? new Set(resultado.matches[seleccion]?.ids_movimientos ?? [])
      : new Set<string>();

  function ejecutar(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "No se pudo completar la acción.");
      else router.refresh();
    });
  }

  function toggle(set: Set<string>, id: string): Set<string> {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }

  function conciliarSeleccion() {
    const ids_internos = [...selInt];
    const ids_movimientos = [...selMov];
    if (ids_internos.length === 0 || ids_movimientos.length === 0) return;
    const sumaInt = ids_internos.reduce(
      (a, id) => a + (internoById.get(id)?.monto ?? 0),
      0,
    );
    const sumaMov = ids_movimientos.reduce(
      (a, id) => a + (movById.get(id)?.monto ?? 0),
      0,
    );
    const dif = Number((sumaInt - sumaMov).toFixed(2));
    ejecutar(async () => {
      const r = await conciliarManual(jobId, {
        ids_internos,
        ids_movimientos,
        diferencia_monto: dif,
        categoria_diferencia: Math.abs(dif) > 0.005 ? "ajuste_manual" : null,
      });
      if (r.ok) {
        setSelInt(new Set());
        setSelMov(new Set());
      }
      return r;
    });
  }

  const c = resultado.cuadre;
  const r = resultado.resumen;
  const cuadreCero = Math.abs(c.diferencia) < 0.005;

  return (
    <div className="space-y-6">
      {/* Resumen ejecutivo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tarjeta label="Exactos" valor={r.conciliados_exactos} />
        <Tarjeta label="Difusos" valor={r.conciliados_difusos} />
        <Tarjeta label="Sugeridos IA" valor={r.sugeridos_ia} tono="ia" />
        <Tarjeta
          label="Sin conciliar"
          valor={r.sin_conciliar_internos + r.sin_conciliar_bancarios}
          tono="alerta"
        />
      </div>

      {/* Cuadre */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-neutral-900">Cuadre de saldos</p>
          <button
            type="button"
            onClick={() => exportarResultadoExcel(resultado, jobId)}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Exportar a Excel
          </button>
        </div>
        <dl className="mt-3 space-y-1.5 text-sm">
          <Linea label="Saldo extracto final" valor={c.saldo_extracto_final} moneda={moneda} />
          <Linea label="+ Depósitos en tránsito" valor={c.depositos_en_transito} moneda={moneda} />
          <Linea label="− Cheques no cobrados" valor={c.cheques_no_cobrados} moneda={moneda} />
          <Linea label="± Cargos no registrados" valor={c.cargos_no_registrados} moneda={moneda} />
          <div className="my-2 border-t border-neutral-200" />
          <Linea label="Saldo banco ajustado" valor={c.saldo_banco_ajustado} moneda={moneda} fuerte />
          <Linea label="Saldo según libros" valor={c.saldo_libros_final} moneda={moneda} fuerte />
          <Linea label="Diferencia" valor={c.diferencia} moneda={moneda} fuerte resaltar />
        </dl>
        {cuadreCero ? (
          <p className="mt-2 text-sm font-medium text-emerald-700">
            ✓ El cuadre está balanceado.
          </p>
        ) : (
          <p className="mt-2 text-sm text-red-600">
            La diferencia no es cero: revisa las partidas no conciliadas.
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Cola de revisión IA */}
      {colaIA.length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5">
          <p className="font-semibold text-neutral-900">
            Sugerencias de IA por revisar ({colaIA.length})
          </p>
          <ul className="mt-3 space-y-3">
            {colaIA.map(({ m, idx }) => {
              const it = internoById.get(m.ids_internos[0] ?? "");
              const bc = movById.get(m.ids_movimientos[0] ?? "");
              return (
                <li
                  key={idx}
                  className="rounded-xl border border-neutral-200 bg-white p-4"
                >
                  <div className="flex items-center gap-2">
                    <Badge match={m} />
                    <span className="text-xs text-neutral-500">
                      {m.ids_internos.join(", ")} ↔ {m.ids_movimientos.join(", ")}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <p className="text-neutral-700">
                      <span className="text-neutral-400">Interno:</span>{" "}
                      {it ? `${formatearFecha(it.fecha)} · ${formatearPEN(it.monto, moneda)} · ${it.contraparte ?? ""}` : "—"}
                    </p>
                    <p className="text-neutral-700">
                      <span className="text-neutral-400">Banco:</span>{" "}
                      {bc ? `${formatearFecha(bc.fecha)} · ${formatearPEN(bc.monto, moneda)} · ${bc.glosa ?? ""}` : "—"}
                    </p>
                  </div>
                  {m.justificacion && (
                    <p className="mt-2 text-sm text-neutral-600">
                      {m.justificacion}
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={pendiente}
                      onClick={() =>
                        ejecutar(() => registrarDecision(jobId, idx, "aceptado"))
                      }
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Aceptar
                    </button>
                    <button
                      type="button"
                      disabled={pendiente}
                      onClick={() =>
                        ejecutar(() => registrarDecision(jobId, idx, "rechazado"))
                      }
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Dos paneles */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          titulo="Registros internos"
          items={internos.map((it) => ({
            id: it.id_interno,
            fecha: it.fecha,
            monto: it.monto,
            texto: it.contraparte ?? it.descripcion ?? "",
            ref: it.referencia,
          }))}
          matchDe={matchDeInterno}
          matches={resultado.matches}
          resaltados={idsSeleccionInt}
          moneda={moneda}
          onSeleccionarMatch={setSeleccion}
          seleccionManual={selInt}
          onToggleManual={(id) => setSelInt((s) => toggle(s, id))}
        />
        <Panel
          titulo="Movimientos bancarios"
          items={bancarios.map((bc) => ({
            id: bc.id_movimiento,
            fecha: bc.fecha,
            monto: bc.monto,
            texto: bc.glosa ?? "",
            ref: bc.referencia_banco,
          }))}
          matchDe={matchDeMov}
          matches={resultado.matches}
          resaltados={idsSeleccionMov}
          moneda={moneda}
          onSeleccionarMatch={setSeleccion}
          seleccionManual={selMov}
          onToggleManual={(id) => setSelMov((s) => toggle(s, id))}
        />
      </div>

      {/* Conciliación manual */}
      {(selInt.size > 0 || selMov.size > 0) && (
        <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-2xl border border-neutral-300 bg-white p-4 shadow-lg">
          <p className="text-sm text-neutral-600">
            Seleccionados: {selInt.size} interno(s) y {selMov.size} bancario(s).
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSelInt(new Set());
                setSelMov(new Set());
              }}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Limpiar
            </button>
            <button
              type="button"
              disabled={pendiente || selInt.size === 0 || selMov.size === 0}
              onClick={conciliarSeleccion}
              className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:bg-neutral-300"
            >
              Conciliar manualmente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type ItemPanel = {
  id: string;
  fecha: string;
  monto: number;
  texto: string;
  ref?: string | null;
};

function Panel({
  titulo,
  items,
  matchDe,
  matches,
  resaltados,
  moneda,
  onSeleccionarMatch,
  seleccionManual,
  onToggleManual,
}: {
  titulo: string;
  items: ItemPanel[];
  matchDe: Map<string, number>;
  matches: Match[];
  resaltados: Set<string>;
  moneda: string;
  onSeleccionarMatch: (idx: number | null) => void;
  seleccionManual: Set<string>;
  onToggleManual: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <p className="mb-3 font-semibold text-neutral-900">{titulo}</p>
      <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
        {items.map((it) => {
          const matchIdx = matchDe.get(it.id);
          const conciliado = matchIdx != null;
          const resaltado = resaltados.has(it.id);
          const seleccionado = seleccionManual.has(it.id);
          return (
            <li
              key={it.id}
              onClick={() =>
                conciliado
                  ? onSeleccionarMatch(matchIdx!)
                  : onToggleManual(it.id)
              }
              className={[
                "flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                resaltado
                  ? "border-blue-400 bg-blue-50"
                  : seleccionado
                    ? "border-neutral-800 bg-neutral-50"
                    : "border-transparent hover:bg-neutral-50",
              ].join(" ")}
            >
              <div className="min-w-0">
                <p className="truncate text-neutral-800">
                  {formatearFecha(it.fecha)} ·{" "}
                  <span
                    className={
                      it.monto < 0 ? "text-red-600" : "text-emerald-700"
                    }
                  >
                    {formatearPEN(it.monto, moneda)}
                  </span>
                </p>
                <p className="truncate text-xs text-neutral-500">
                  {it.id}
                  {it.texto ? ` · ${it.texto}` : ""}
                </p>
              </div>
              {conciliado ? (
                <Badge match={matches[matchIdx!]!} />
              ) : (
                <input
                  type="checkbox"
                  checked={seleccionado}
                  readOnly
                  className="h-4 w-4 shrink-0 rounded border-neutral-300"
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Tarjeta({
  label,
  valor,
  tono,
}: {
  label: string;
  valor: number;
  tono?: "ia" | "alerta";
}) {
  const color =
    tono === "ia"
      ? "text-violet-700"
      : tono === "alerta"
        ? "text-amber-700"
        : "text-neutral-900";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{valor}</p>
    </div>
  );
}

function Linea({
  label,
  valor,
  moneda,
  fuerte,
  resaltar,
}: {
  label: string;
  valor: number;
  moneda: string;
  fuerte?: boolean;
  resaltar?: boolean;
}) {
  const cero = Math.abs(valor) < 0.005;
  return (
    <div className="flex items-center justify-between">
      <dt className={fuerte ? "font-medium text-neutral-800" : "text-neutral-600"}>
        {label}
      </dt>
      <dd
        className={[
          "tabular-nums",
          fuerte ? "font-semibold" : "",
          resaltar
            ? cero
              ? "text-emerald-700"
              : "text-red-600"
            : "text-neutral-900",
        ].join(" ")}
      >
        {formatearPEN(valor, moneda)}
      </dd>
    </div>
  );
}
