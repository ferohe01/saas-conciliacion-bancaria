"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatearPEN, formatearFecha } from "@/lib/parsing/resumen";
import { etiquetaTipo } from "@/lib/reportes";
import { exportarResultadoExcel } from "@/lib/exportar";
import {
  registrarDecision,
  registrarDecisiones,
  reabrirDecision,
  conciliarManual,
} from "@/app/(app)/conciliacion/[jobId]/actions";
import type { ResultadoConciliacion, Match } from "@/lib/contract/resultado";
import type {
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";
import { clavePrecedente, type Precedente } from "@/lib/precedentes";
import { FichaPrecedente } from "./FichaPrecedente";
import { SelectorMotivo } from "./SelectorMotivo";
import { PorQueNoSeConcilio } from "./PorQueNoSeConcilio";
import type { MotivoRechazo } from "@/lib/motivosRechazo";
import { Boton, Tarjeta, BadgeMetodo, BadgeAgrupacion } from "@/components/ui";

/**
 * Revisión humana de una conciliación.
 *
 * Construida sobre el principio "a dos mil movimientos, revisar es triaje"
 * (PRODUCT.md § Product Principles). Con 500–2000+ partidas por período nadie
 * lee cada fila, así que la pantalla ordena el trabajo en tres bloques por
 * urgencia decreciente:
 *
 *   1. Por revisar   — lo que la IA propuso y espera tu criterio. Ordenado por
 *                      confianza ASCENDENTE: primero lo dudoso. Despachable en
 *                      lote.
 *   2. Sin conciliar — lo que nadie logró emparejar. Requiere trabajo manual.
 *   3. Ya conciliado — colapsado. Está resuelto; se consulta, no se revisa.
 */

const PAGINA = 50;
const UMBRAL_LOTE = 0.95;

type Props = {
  jobId: string;
  resultado: ResultadoConciliacion;
  internos: RegistroInterno[];
  bancarios: MovimientoBancario[];
  moneda: string;
};

type ItemLado = {
  id: string;
  fecha: string;
  monto: number;
  texto: string;
  ref?: string | null;
};

export function ResultadoReview({
  jobId,
  resultado,
  internos,
  bancarios,
  moneda,
  precedentes = {},
  totalPares,
}: Props & {
  precedentes?: Record<string, Precedente>;
  /**
   * Pares que existen de verdad. En modo tabla la pantalla solo carga mil, así
   * que contarlos aquí subestimaría el trabajo hecho por dos órdenes de
   * magnitud.
   */
  totalPares?: number;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // El aviso lleva su propio "deshacer": el momento en que alguien se da cuenta
  // del error es el segundo siguiente a cometerlo, no cuando abre otra sección.
  const [aviso, setAviso] = useState<{
    texto: string;
    deshacer?: () => void;
  } | null>(null);

  // Selección para despacho en lote de la cola de revisión.
  const [enLote, setEnLote] = useState<Set<number>>(new Set());
  // Qué rechazo está esperando motivo: el índice de una sugerencia, "lote", o
  // nada. Un solo estado porque nunca hay dos preguntas abiertas a la vez.
  const [pidiendoMotivo, setPidiendoMotivo] = useState<number | "lote" | null>(
    null,
  );
  // Selección para conciliación manual.
  const [selInt, setSelInt] = useState<Set<string>>(new Set());
  const [selMov, setSelMov] = useState<Set<string>>(new Set());
  // Búsquedas y paginación.
  const [buscaPend, setBuscaPend] = useState("");
  const [buscaConc, setBuscaConc] = useState("");
  const [topeSin, setTopeSin] = useState(PAGINA);
  const [topeConc, setTopeConc] = useState(PAGINA);
  // La cola tambien pagina: con 500-2000 movimientos podia pintar cientos de
  // fichas de golpe, mientras sus dos secciones hermanas si paginaban.
  const [topeCola, setTopeCola] = useState(PAGINA);

  const internoById = useMemo(
    () => new Map(internos.map((r) => [r.id_interno, r])),
    [internos],
  );
  const movById = useMemo(
    () => new Map(bancarios.map((m) => [m.id_movimiento, m])),
    [bancarios],
  );

  const itemInterno = (id: string): ItemLado => {
    const it = internoById.get(id);
    return {
      id,
      fecha: it?.fecha ?? "",
      monto: it?.monto ?? 0,
      texto: it?.contraparte ?? it?.descripcion ?? "",
      ref: it?.referencia,
    };
  };
  const itemMov = (id: string): ItemLado => {
    const bc = movById.get(id);
    return {
      id,
      fecha: bc?.fecha ?? "",
      monto: bc?.monto ?? 0,
      texto: bc?.glosa ?? "",
      ref: bc?.referencia_banco,
    };
  };

  // ── Particionado del trabajo ─────────────────────────────────────────────
  const { cola, conciliados, idsConciliados } = useMemo(() => {
    const cola: { m: Match; idx: number }[] = [];
    const conciliados: { m: Match; idx: number }[] = [];
    const ids = new Set<string>();
    resultado.matches.forEach((m, idx) => {
      if (m.estado_revision === "rechazado") return;
      if (m.estado_revision === "pendiente") cola.push({ m, idx });
      else conciliados.push({ m, idx });
      m.ids_internos.forEach((id) => ids.add(id));
      m.ids_movimientos.forEach((id) => ids.add(id));
    });
    // Triaje: primero lo que la máquina menos sabe. Sin score va al final —
    // la agrupación 1:N es determinística, no una apuesta.
    cola.sort((a, b) => (a.m.confianza ?? 2) - (b.m.confianza ?? 2));
    return { cola, conciliados, idsConciliados: ids };
  }, [resultado]);

  const colaVisible = useMemo(() => cola.slice(0, topeCola), [cola, topeCola]);

  const sinConciliarInt = useMemo(
    () => internos.filter((r) => !idsConciliados.has(r.id_interno)),
    [internos, idsConciliados],
  );
  const sinConciliarMov = useMemo(
    () => bancarios.filter((m) => !idsConciliados.has(m.id_movimiento)),
    [bancarios, idsConciliados],
  );

  const altaConfianza = useMemo(
    () => cola.filter(({ m }) => (m.confianza ?? 0) >= UMBRAL_LOTE),
    [cola],
  );

  // ── Ejecución ────────────────────────────────────────────────────────────
  function ejecutar(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    exito?: string,
    deshacer?: () => void,
  ) {
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "No se pudo completar la acción.");
      else {
        if (exito) setAviso({ texto: exito, deshacer });
        router.refresh();
      }
    });
  }

  /** Devuelve un par a la cola. Compartido por el aviso y la tabla de resueltos. */
  function reabrir(idx: number) {
    ejecutar(() => reabrirDecision(jobId, idx), "Devuelto a la cola de revisión.");
  }

  function decidirLote(
    indices: number[],
    accion: "aceptado" | "rechazado",
    motivo?: MotivoRechazo,
  ) {
    if (indices.length === 0) return;
    ejecutar(
      async () => {
        const r = await registrarDecisiones(jobId, indices, accion, motivo);
        if (r.ok) {
          setEnLote(new Set());
          setPidiendoMotivo(null);
        }
        return r;
      },
      `${indices.length} ${indices.length === 1 ? "sugerencia" : "sugerencias"} ${
        accion === "aceptado" ? "aceptadas" : "rechazadas"
      }.`,
    );
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
    }, "Conciliado manualmente.");
  }

  const c = resultado.cuadre;
  const cuadreCero = Math.abs(c.diferencia) < 0.005;
  /**
   * ⚠️ Los totales salen del RESUMEN del job, no de los arrays cargados.
   *
   * En modo tabla la pantalla trae mil pares y las partidas que esos pares
   * tocan: contar sobre eso daba "1.000 pares resueltos · 21% emparejado" en
   * una conciliación de 447.796 pares al 99%. Dos cifras contradictorias en la
   * misma pantalla —el aviso de arriba decía 447.796— y la mala era la grande y
   * en negrita.
   *
   * El resumen sí es del período completo: la absorción lo actualiza sumando
   * los pares que resolvió el SQL a los que devolvió n8n.
   */
  const totalPartidas =
    (resultado.resumen?.total_internos ?? internos.length) +
    (resultado.resumen?.total_bancarios ?? bancarios.length);

  return (
    <div className="space-y-6">
      <CuadreBarra
        cuadre={c}
        cuadreCero={cuadreCero}
        moneda={moneda}
        onExportar={() => void exportarResultadoExcel(resultado, jobId)}
      />

      <ResumenTriaje
        porRevisar={cola.length}
        sinConciliar={sinConciliarInt.length + sinConciliarMov.length}
        conciliados={totalPares ?? conciliados.length}
        totalPartidas={totalPartidas}
      />

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {aviso && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <span>{aviso.texto}</span>
          {aviso.deshacer && (
            <button
              type="button"
              disabled={pendiente}
              onClick={aviso.deshacer}
              className="min-h-9 shrink-0 rounded-lg px-2 font-medium text-emerald-900 underline underline-offset-2 transition-colors hover:bg-emerald-100 disabled:opacity-60"
            >
              Deshacer
            </button>
          )}
        </div>
      )}

      {/* ── 1. Por revisar ──────────────────────────────────────────────── */}
      <section aria-labelledby="h-revisar">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="h-revisar"
              className="text-lg font-semibold text-neutral-900"
            >
              Por revisar{" "}
              <span className="tabular-nums text-neutral-500">
                ({cola.length})
              </span>
            </h2>
            <p className="text-sm text-neutral-600">
              {cola.length > 0
                ? "Ordenadas de menor a mayor confianza: lo dudoso primero."
                : "No queda nada esperando tu criterio."}
            </p>
          </div>
        </div>

        {cola.length === 0 ? (
          <Tarjeta tono="cuadre">
            <p className="text-sm font-medium text-emerald-800">
              ✓ Revisión al día. Ninguna sugerencia pendiente.
            </p>
          </Tarjeta>
        ) : (
          <div className="space-y-3">
            {/* Un lote se rechaza por UN motivo comun: si hicieran falta
                motivos distintos, no era un lote. Preguntarlo una vez por
                sugerencia aqui destruiria la razon de ser del despacho masivo. */}
            {pidiendoMotivo === "lote" && (
              <SelectorMotivo
                titulo={`¿Por qué rechazas estas ${enLote.size} sugerencias?`}
                onElegir={(motivo) => decidirLote([...enLote], "rechazado", motivo)}
                onCancelar={() => setPidiendoMotivo(null)}
                disabled={pendiente}
              />
            )}
            <BarraLote
              cola={colaVisible}
              enLote={enLote}
              altaConfianza={altaConfianza}
              pendiente={pendiente}
              onToggleTodo={(marcar) =>
                // Solo lo VISIBLE: seleccionar en bloque partidas que no caben
                // en pantalla es pedirle a alguien que decida a ciegas.
                setEnLote(marcar ? new Set(colaVisible.map((x) => x.idx)) : new Set())
              }
              onAceptarSeleccion={() => decidirLote([...enLote], "aceptado")}
              onRechazarSeleccion={() => setPidiendoMotivo("lote")}
              onAceptarAltas={() =>
                decidirLote(
                  altaConfianza.map((x) => x.idx),
                  "aceptado",
                )
              }
            />

            <ul className="space-y-3">
              {colaVisible.map(({ m, idx }) => (
                <li key={idx}>
                  <FichaSugerencia
                    precedente={
                      precedentes[
                        clavePrecedente(
                          m.ids_internos ?? [],
                          m.ids_movimientos ?? [],
                        )
                      ] ?? null
                    }
                    match={m}
                    moneda={moneda}
                    seleccionada={enLote.has(idx)}
                    pendiente={pendiente}
                    internos={m.ids_internos.map(itemInterno)}
                    movimientos={m.ids_movimientos.map(itemMov)}
                    onToggle={() =>
                      setEnLote((s) => {
                        const n = new Set(s);
                        if (n.has(idx)) n.delete(idx);
                        else n.add(idx);
                        return n;
                      })
                    }
                    onAceptar={() =>
                      ejecutar(
                        () => registrarDecision(jobId, idx, "aceptado"),
                        "Sugerencia aceptada.",
                        () => reabrir(idx),
                      )
                    }
                    pidiendoMotivo={pidiendoMotivo === idx}
                    onPedirMotivo={() => setPidiendoMotivo(idx)}
                    onCancelarMotivo={() => setPidiendoMotivo(null)}
                    onRechazar={(motivo) =>
                      ejecutar(
                        async () => {
                          const r = await registrarDecision(
                            jobId,
                            idx,
                            "rechazado",
                            undefined,
                            motivo,
                          );
                          if (r.ok) setPidiendoMotivo(null);
                          return r;
                        },
                        "Sugerencia rechazada.",
                        () => reabrir(idx),
                      )
                    }
                  />
                </li>
              ))}
            </ul>

            {cola.length > colaVisible.length && (
              <div className="flex justify-center">
                <Boton
                  variante="secundario"
                  tamano="sm"
                  onClick={() => setTopeCola((t) => t + PAGINA)}
                >
                  Ver {Math.min(PAGINA, cola.length - colaVisible.length)} más
                  de {cola.length - colaVisible.length} pendientes
                </Boton>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── 2. Sin conciliar ────────────────────────────────────────────── */}
      <section aria-labelledby="h-sin">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="h-sin" className="text-lg font-semibold text-neutral-900">
              Sin conciliar{" "}
              <span className="tabular-nums text-neutral-500">
                ({sinConciliarInt.length + sinConciliarMov.length})
              </span>
            </h2>
            <p className="text-sm text-neutral-600">
              Marca una o más partidas de cada lado y concílialas a mano.
            </p>
          </div>
          {sinConciliarInt.length + sinConciliarMov.length > 0 && (
            <BuscadorPartidas
              valor={buscaPend}
              onCambio={(v) => {
                setBuscaPend(v);
                setTopeSin(PAGINA);
              }}
              etiqueta="Buscar entre las partidas sin conciliar"
            />
          )}
        </div>

        {sinConciliarInt.length + sinConciliarMov.length === 0 ? (
          <Tarjeta tono="cuadre">
            <p className="text-sm font-medium text-emerald-800">
              ✓ Todas las partidas del período quedaron emparejadas.
            </p>
          </Tarjeta>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <PanelSinConciliar
              titulo="Tus registros"
              items={sinConciliarInt.map((r) => itemInterno(r.id_interno))}
              busqueda={buscaPend}
              tope={topeSin}
              onMas={() => setTopeSin((t) => t + PAGINA)}
              moneda={moneda}
              jobId={jobId}
              seleccion={selInt}
              onToggle={(id) =>
                setSelInt((s) => {
                  const n = new Set(s);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                })
              }
            />
            <PanelSinConciliar
              titulo="Tu banco"
              items={sinConciliarMov.map((m) => itemMov(m.id_movimiento))}
              busqueda={buscaPend}
              tope={topeSin}
              onMas={() => setTopeSin((t) => t + PAGINA)}
              moneda={moneda}
              seleccion={selMov}
              onToggle={(id) =>
                setSelMov((s) => {
                  const n = new Set(s);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                })
              }
            />
          </div>
        )}
      </section>

      {/* ── 3. Ya conciliado (colapsado) ────────────────────────────────── */}
      <section aria-labelledby="h-conc">
        <h2 id="h-conc" className="sr-only">
          Partidas ya conciliadas
        </h2>
        <details className="group rounded-2xl border border-neutral-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4">
            <span>
              <span className="font-semibold text-neutral-900">
                Ya conciliado{" "}
                <span className="tabular-nums text-neutral-500">
                  ({conciliados.length})
                </span>
              </span>
              <span className="mt-0.5 block text-sm text-neutral-600">
                Resuelto. Ábrelo solo si necesitas consultar un par.
              </span>
            </span>
            <span
              aria-hidden
              className="shrink-0 text-neutral-500 transition-transform group-open:rotate-180"
            >
              ▾
            </span>
          </summary>

          <div className="border-t border-neutral-200 p-5">
            <BuscadorPartidas
              valor={buscaConc}
              onCambio={(v) => {
                setBuscaConc(v);
                setTopeConc(PAGINA);
              }}
              etiqueta="Buscar entre los pares conciliados"
            />
            <TablaPares
              pares={conciliados}
              itemInterno={itemInterno}
              itemMov={itemMov}
              busqueda={buscaConc}
              tope={topeConc}
              onMas={() => setTopeConc((t) => t + PAGINA)}
              moneda={moneda}
              pendiente={pendiente}
              onReabrir={reabrir}
            />
          </div>
        </details>
      </section>

      {/* Barra flotante de conciliación manual */}
      {(selInt.size > 0 || selMov.size > 0) && (
        <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-300 bg-white p-4 shadow-flotante">
          <p className="text-sm text-neutral-700">
            <span className="font-medium tabular-nums text-neutral-900">
              {selInt.size}
            </span>{" "}
            de tus registros y{" "}
            <span className="font-medium tabular-nums text-neutral-900">
              {selMov.size}
            </span>{" "}
            del banco.
            {selInt.size > 0 && selMov.size > 0 && (
              <DiferenciaSeleccion
                selInt={selInt}
                selMov={selMov}
                internoById={internoById}
                movById={movById}
                moneda={moneda}
              />
            )}
          </p>
          <div className="flex gap-2">
            <Boton
              variante="secundario"
              tamano="sm"
              onClick={() => {
                setSelInt(new Set());
                setSelMov(new Set());
              }}
            >
              Limpiar
            </Boton>
            <Boton
              tamano="sm"
              disabled={pendiente || selInt.size === 0 || selMov.size === 0}
              onClick={conciliarSeleccion}
            >
              {pendiente ? "Conciliando…" : "Conciliar manualmente"}
            </Boton>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cuadre: el veredicto del período ────────────────────────────────────────
function CuadreBarra({
  cuadre,
  cuadreCero,
  moneda,
  onExportar,
}: {
  cuadre: ResultadoConciliacion["cuadre"];
  cuadreCero: boolean;
  moneda: string;
  onExportar: () => void;
}) {
  return (
    <Tarjeta tono={cuadreCero ? "cuadre" : "atencion"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p
            className={`text-xs font-medium ${cuadreCero ? "text-emerald-700" : "text-amber-800"}`}
          >
            Cuadre del período
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-3xl font-bold tabular-nums ${cuadreCero ? "text-emerald-800" : "text-amber-900"}`}
            >
              {formatearPEN(cuadre.diferencia, moneda)}
            </span>
            <span
              className={`text-sm font-medium ${cuadreCero ? "text-emerald-700" : "text-amber-800"}`}
            >
              {cuadreCero ? "✓ Cuadra" : "de diferencia"}
            </span>
          </p>
          <p
            className={`mt-1 text-sm ${cuadreCero ? "text-emerald-700" : "text-amber-800"}`}
          >
            {cuadreCero
              ? "Banco y libros coinciden."
              : "Revisa las partidas sin conciliar para cerrar la diferencia."}
          </p>
        </div>
        <Boton variante="secundario" tamano="sm" onClick={onExportar}>
          Exportar a Excel
        </Boton>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-neutral-700">
          Ver el detalle del cuadre
        </summary>
        <dl className="mt-3 space-y-1.5 rounded-xl bg-white/70 p-4 text-sm">
          {/* Los signos de las etiquetas describen el EFECTO sobre el saldo,
              no la operación aritmética: las partidas ya vienen firmadas (un
              cheque es negativo, así que "+ cheques" restaría y confundiría). */}
          <LineaCuadre label="Saldo extracto final" valor={cuadre.saldo_extracto_final} moneda={moneda} />
          <LineaCuadre label="+ Depósitos en tránsito" valor={cuadre.depositos_en_transito} moneda={moneda} />
          <LineaCuadre label="− Cheques no cobrados" valor={cuadre.cheques_no_cobrados} moneda={moneda} />
          <LineaCuadre label="− Abonos no registrados en libros" valor={cuadre.abonos_no_registrados} moneda={moneda} />
          <LineaCuadre label="+ Cargos no registrados en libros" valor={cuadre.cargos_no_registrados} moneda={moneda} />
          <LineaCuadre label="± Diferencias en pares emparejados" valor={cuadre.diferencias_emparejadas} moneda={moneda} />
          <div className="my-2 border-t border-neutral-300" />
          <LineaCuadre label="Saldo banco ajustado" valor={cuadre.saldo_banco_ajustado} moneda={moneda} fuerte />
          <LineaCuadre label="Saldo según libros" valor={cuadre.saldo_libros_final} moneda={moneda} fuerte />
          <LineaCuadre label="Diferencia" valor={cuadre.diferencia} moneda={moneda} fuerte resaltar />
        </dl>
      </details>
    </Tarjeta>
  );
}

function LineaCuadre({
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
    <div className="flex items-center justify-between gap-4">
      <dt className={fuerte ? "font-medium text-neutral-800" : "text-neutral-600"}>
        {label}
      </dt>
      <dd
        className={[
          "tabular-nums",
          fuerte ? "font-semibold" : "",
          resaltar ? (cero ? "text-emerald-800" : "text-red-700") : "text-neutral-900",
        ].join(" ")}
      >
        {formatearPEN(valor, moneda)}
      </dd>
    </div>
  );
}

// ── Resumen del triaje: cuánto trabajo queda, no cuánto se hizo ─────────────
function ResumenTriaje({
  porRevisar,
  sinConciliar,
  conciliados,
  totalPartidas,
}: {
  porRevisar: number;
  sinConciliar: number;
  conciliados: number;
  totalPartidas: number;
}) {
  const pendiente = porRevisar + sinConciliar;
  const pctListo =
    totalPartidas > 0
      ? Math.round(((totalPartidas - sinConciliar) / totalPartidas) * 100)
      : 100;
  return (
    <Tarjeta>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-neutral-500">
            Trabajo que te queda
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-900">
            {pendiente === 0 ? "Nada pendiente" : `${pendiente} partidas`}
          </p>
          <p className="mt-1 text-sm text-neutral-600">
            <span className="tabular-nums">{porRevisar}</span> por revisar ·{" "}
            <span className="tabular-nums">{sinConciliar}</span> sin conciliar ·{" "}
            <span className="tabular-nums">{conciliados}</span> pares resueltos
          </p>
        </div>
        <div className="min-w-[10rem] flex-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-neutral-600">Emparejado</span>
            <span className="font-semibold tabular-nums text-neutral-900">
              {pctListo}%
            </span>
          </div>
          <div
            className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-100"
            role="img"
            aria-label={`${pctListo}% de las partidas emparejadas`}
          >
            <div
              className="h-2 rounded-full bg-emerald-500"
              style={{ width: `${pctListo}%` }}
            />
          </div>
        </div>
      </div>
    </Tarjeta>
  );
}

// ── Barra de despacho en lote ───────────────────────────────────────────────
function BarraLote({
  cola,
  enLote,
  altaConfianza,
  pendiente,
  onToggleTodo,
  onAceptarSeleccion,
  onRechazarSeleccion,
  onAceptarAltas,
}: {
  cola: { m: Match; idx: number }[];
  enLote: Set<number>;
  altaConfianza: { m: Match; idx: number }[];
  pendiente: boolean;
  onToggleTodo: (marcar: boolean) => void;
  onAceptarSeleccion: () => void;
  onRechazarSeleccion: () => void;
  onAceptarAltas: () => void;
}) {
  const todas = enLote.size === cola.length && cola.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <label className="flex min-h-9 items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={todas}
          onChange={(e) => onToggleTodo(e.target.checked)}
          className="h-4 w-4 rounded border-neutral-400 text-neutral-900"
        />
        Seleccionar todas
      </label>

      {enLote.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm tabular-nums text-neutral-600">
            {enLote.size} seleccionadas
          </span>
          <Boton
            variante="confirmar"
            tamano="sm"
            disabled={pendiente}
            onClick={onAceptarSeleccion}
          >
            Aceptar
          </Boton>
          <Boton
            variante="secundario"
            tamano="sm"
            disabled={pendiente}
            onClick={onRechazarSeleccion}
          >
            Rechazar
          </Boton>
        </div>
      ) : (
        altaConfianza.length > 0 && (
          <Boton
            variante="confirmar"
            tamano="sm"
            disabled={pendiente}
            onClick={onAceptarAltas}
          >
            Aceptar las {altaConfianza.length} de confianza ≥ 95%
          </Boton>
        )
      )}
    </div>
  );
}

// ── Ficha de una sugerencia ─────────────────────────────────────────────────
function FichaSugerencia({
  match,
  moneda,
  precedente,
  seleccionada,
  pendiente,
  pidiendoMotivo,
  internos,
  movimientos,
  onToggle,
  onAceptar,
  onPedirMotivo,
  onCancelarMotivo,
  onRechazar,
}: {
  match: Match;
  moneda: string;
  precedente: Precedente | null;
  seleccionada: boolean;
  pendiente: boolean;
  pidiendoMotivo: boolean;
  internos: ItemLado[];
  movimientos: ItemLado[];
  onToggle: () => void;
  onAceptar: () => void;
  onPedirMotivo: () => void;
  onCancelarMotivo: () => void;
  onRechazar: (motivo: MotivoRechazo) => void;
}) {
  const esGrupo = internos.length > 1 || movimientos.length > 1;
  const dif = match.diferencia_monto ?? 0;
  const hayDif = Math.abs(dif) > 0.005;

  return (
    <div
      className={[
        "rounded-2xl border p-4 transition-colors",
        seleccionada
          ? "border-blue-400 bg-blue-50"
          : "border-violet-200 bg-violet-50/50",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-9 items-center gap-2">
          <input
            type="checkbox"
            checked={seleccionada}
            onChange={onToggle}
            className="h-4 w-4 rounded border-neutral-400 text-neutral-900"
          />
          <span className="sr-only">Seleccionar esta sugerencia</span>
        </label>
        <BadgeMetodo metodo={match.metodo} confianza={match.confianza} />
        {esGrupo && (
          <BadgeAgrupacion
            internos={internos.length}
            movimientos={movimientos.length}
          />
        )}
        {match.categoria_diferencia && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
            {etiquetaTipo(match.categoria_diferencia)}
          </span>
        )}
        {hayDif && (
          <span className="text-xs tabular-nums text-amber-800">
            Diferencia {formatearPEN(dif, moneda)}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <ColumnaPartidas
          rotulo="Tus registros"
          items={internos}
          moneda={moneda}
        />
        <span
          aria-hidden
          className="hidden h-6 w-6 shrink-0 place-items-center self-center rounded-full bg-violet-600 text-xs text-white sm:grid"
        >
          ↔
        </span>
        <ColumnaPartidas
          rotulo="Tu banco"
          items={movimientos}
          moneda={moneda}
          alineadoDerecha
        />
      </div>

      {match.justificacion && (
        <p className="mt-3 border-l-2 border-violet-300 pl-3 text-sm text-neutral-700">
          {match.justificacion}
        </p>
      )}

      {precedente && <FichaPrecedente p={precedente} moneda={moneda} />}

      {/* Rechazar abre la pregunta en vez de ejecutar: el motivo es la senal
          mas informativa del ciclo y se perdia entera. Aceptar no pregunta
          nada — "por que aceptaste" no es una duda que nadie tenga. */}
      {pidiendoMotivo ? (
        <SelectorMotivo
          onElegir={onRechazar}
          onCancelar={onCancelarMotivo}
          disabled={pendiente}
        />
      ) : (
        <div className="mt-4 flex gap-2">
          <Boton
            variante="confirmar"
            tamano="sm"
            disabled={pendiente}
            onClick={onAceptar}
          >
            Aceptar
          </Boton>
          <Boton
            variante="secundario"
            tamano="sm"
            disabled={pendiente}
            onClick={onPedirMotivo}
          >
            Rechazar
          </Boton>
        </div>
      )}
    </div>
  );
}

function ColumnaPartidas({
  rotulo,
  items,
  moneda,
  alineadoDerecha,
}: {
  rotulo: string;
  items: ItemLado[];
  moneda: string;
  alineadoDerecha?: boolean;
}) {
  return (
    <div className={`min-w-0 ${alineadoDerecha ? "sm:text-right" : ""}`}>
      <p className="text-[11px] font-medium tracking-wide text-neutral-600 uppercase">
        {rotulo}
      </p>
      {items.map((it) => (
        <div key={it.id} className="mt-1">
          <p className="truncate text-sm font-medium text-neutral-800">
            {it.texto || it.id}
          </p>
          <p className="text-sm tabular-nums text-neutral-600">
            {it.fecha ? `${formatearFecha(it.fecha)} · ` : ""}
            <MontoConSigno monto={it.monto} moneda={moneda} />
          </p>
        </div>
      ))}
    </div>
  );
}

function MontoConSigno({ monto, moneda }: { monto: number; moneda: string }) {
  return (
    <span className={monto < 0 ? "text-red-700" : "text-emerald-800"}>
      {formatearPEN(monto, moneda)}
    </span>
  );
}

// ── Buscador compartido ─────────────────────────────────────────────────────
function BuscadorPartidas({
  valor,
  onCambio,
  etiqueta,
}: {
  valor: string;
  onCambio: (v: string) => void;
  etiqueta: string;
}) {
  return (
    <input
      type="search"
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      placeholder="Buscar por monto, fecha o descripción…"
      aria-label={etiqueta}
      className="h-10 w-full rounded-xl border border-neutral-300 bg-white px-3 text-sm text-neutral-800 shadow-asiento transition-colors placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none sm:w-72"
    />
  );
}

function coincide(it: ItemLado, q: string): boolean {
  if (!q) return true;
  const t = q.toLowerCase();
  return (
    it.id.toLowerCase().includes(t) ||
    it.texto.toLowerCase().includes(t) ||
    String(it.monto).includes(t) ||
    it.fecha.includes(t) ||
    (it.ref ?? "").toLowerCase().includes(t)
  );
}

// ── Panel de partidas sin conciliar (selección para match manual) ───────────
function PanelSinConciliar({
  titulo,
  items,
  busqueda,
  tope,
  onMas,
  moneda,
  seleccion,
  onToggle,
  jobId,
}: {
  titulo: string;
  items: ItemLado[];
  busqueda: string;
  tope: number;
  onMas: () => void;
  moneda: string;
  seleccion: Set<string>;
  onToggle: (id: string) => void;
  /**
   * Con `jobId`, cada fila puede explicar por qué no se concilió. Solo lo
   * recibe el lado interno: son las facturas del cliente, que es lo que le
   * importa. El lado del banco se puede añadir después sin tocar esto.
   */
  jobId?: string;
}) {
  const filtrados = items.filter((it) => coincide(it, busqueda));
  const visibles = filtrados.slice(0, tope);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-neutral-900">{titulo}</h3>
        <span className="text-sm tabular-nums text-neutral-600">
          {filtrados.length}
          {filtrados.length !== items.length && ` de ${items.length}`}
        </span>
      </div>

      {filtrados.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-600">
          {items.length === 0
            ? "Nada pendiente de este lado."
            : "Ninguna partida coincide con la búsqueda."}
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {visibles.map((it) => {
              const marcado = seleccion.has(it.id);
              return (
                <li key={it.id}>
                  <label
                    className={[
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                      marcado
                        ? "border-neutral-800 bg-neutral-50"
                        : "border-transparent hover:bg-neutral-50",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => onToggle(it.id)}
                      className="h-4 w-4 shrink-0 rounded border-neutral-400 text-neutral-900"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-neutral-800">
                        {it.fecha ? `${formatearFecha(it.fecha)} · ` : ""}
                        <MontoConSigno monto={it.monto} moneda={moneda} />
                      </span>
                      <span className="block truncate text-xs text-neutral-600">
                        {it.id}
                        {it.texto ? ` · ${it.texto}` : ""}
                      </span>
                    </span>
                  </label>
                  {/* FUERA del <label> a propósito: dentro, pulsar el botón
                      activaría también la casilla y seleccionaría la partida
                      sin querer. */}
                  {jobId && (
                    <div className="pl-10">
                      <PorQueNoSeConcilio
                        jobId={jobId}
                        partidaId={it.id}
                        moneda={moneda}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {filtrados.length > visibles.length && (
            <Boton
              variante="sutil"
              tamano="sm"
              onClick={onMas}
              className="mt-2 w-full"
            >
              Ver {Math.min(PAGINA, filtrados.length - visibles.length)} más
              (quedan {filtrados.length - visibles.length})
            </Boton>
          )}
        </>
      )}
    </div>
  );
}

// ── Tabla de pares ya conciliados ───────────────────────────────────────────
function TablaPares({
  pares,
  itemInterno,
  itemMov,
  busqueda,
  tope,
  onMas,
  moneda,
  pendiente,
  onReabrir,
}: {
  pares: { m: Match; idx: number }[];
  itemInterno: (id: string) => ItemLado;
  itemMov: (id: string) => ItemLado;
  busqueda: string;
  tope: number;
  onMas: () => void;
  moneda: string;
  pendiente: boolean;
  onReabrir: (idx: number) => void;
}) {
  const filtrados = pares.filter(({ m }) => {
    if (!busqueda) return true;
    const todos = [
      ...m.ids_internos.map(itemInterno),
      ...m.ids_movimientos.map(itemMov),
    ];
    return todos.some((it) => coincide(it, busqueda));
  });
  const visibles = filtrados.slice(0, tope);

  if (pares.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-neutral-600">
        Todavía no hay ningún par conciliado.
      </p>
    );
  }

  return (
    <>
      <p className="mt-3 text-sm tabular-nums text-neutral-600">
        {filtrados.length}
        {filtrados.length !== pares.length && ` de ${pares.length}`} pares
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">
            Pares conciliados: tus registros emparejados con los movimientos del
            banco
          </caption>
          <thead className="text-xs text-neutral-600">
            <tr className="border-b border-neutral-200">
              <th scope="col" className="py-2 pr-4 font-medium">
                Tus registros
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Tu banco
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Monto
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Método
              </th>
              {/* Sin esta columna la decision era irreversible desde la
                  interfaz: el par caia aqui y no habia vuelta. */}
              <th scope="col" className="py-2 text-right font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.map(({ m, idx }) => {
              const ints = m.ids_internos.map(itemInterno);
              const movs = m.ids_movimientos.map(itemMov);
              const monto = ints.reduce((a, it) => a + it.monto, 0);
              return (
                <tr key={idx} className="border-b border-neutral-100 align-top">
                  <td className="max-w-[16rem] py-2 pr-4">
                    {ints.map((it) => (
                      <p key={it.id} className="truncate text-neutral-800">
                        {it.texto || it.id}
                      </p>
                    ))}
                  </td>
                  <td className="max-w-[16rem] py-2 pr-4">
                    {movs.map((it) => (
                      <p key={it.id} className="truncate text-neutral-800">
                        {it.texto || it.id}
                      </p>
                    ))}
                  </td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
                    <MontoConSigno monto={monto} moneda={moneda} />
                  </td>
                  <td className="py-2 pr-4">
                    <BadgeMetodo metodo={m.metodo} confianza={m.confianza} />
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={pendiente}
                      onClick={() => onReabrir(idx)}
                      className="min-h-9 rounded-lg px-2 text-xs font-medium text-blue-700 underline underline-offset-2 transition-colors hover:bg-blue-50 hover:text-blue-800 disabled:opacity-50"
                    >
                      Volver a revisar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtrados.length > visibles.length && (
        <Boton
          variante="sutil"
          tamano="sm"
          onClick={onMas}
          className="mt-3 w-full"
        >
          Ver {Math.min(PAGINA, filtrados.length - visibles.length)} más (quedan{" "}
          {filtrados.length - visibles.length})
        </Boton>
      )}
    </>
  );
}

// ── Diferencia en vivo de la selección manual ───────────────────────────────
function DiferenciaSeleccion({
  selInt,
  selMov,
  internoById,
  movById,
  moneda,
}: {
  selInt: Set<string>;
  selMov: Set<string>;
  internoById: Map<string, RegistroInterno>;
  movById: Map<string, MovimientoBancario>;
  moneda: string;
}) {
  const sumaInt = [...selInt].reduce(
    (a, id) => a + (internoById.get(id)?.monto ?? 0),
    0,
  );
  const sumaMov = [...selMov].reduce(
    (a, id) => a + (movById.get(id)?.monto ?? 0),
    0,
  );
  const dif = Number((sumaInt - sumaMov).toFixed(2));
  const cero = Math.abs(dif) < 0.005;
  return (
    <>
      {" "}
      <span
        className={`font-medium tabular-nums ${cero ? "text-emerald-800" : "text-amber-800"}`}
      >
        {cero ? "Cuadran exacto." : `Diferencia ${formatearPEN(dif, moneda)}.`}
      </span>
    </>
  );
}
