import { pct, type MetricasAprendizaje } from "@/lib/aprendizajeMetricas";
import { formatearFecha } from "@/lib/parsing/resumen";

/**
 * ¿Está mejorando? — la cifra que sostiene la propuesta de valor.
 *
 * DECISIONES DE VISUALIZACIÓN (ver skill dataviz):
 *
 * - **Número protagonista + barras pequeñas.** La pregunta principal ("¿acierta
 *   más que antes?") se responde con una cifra y una frase; las barras solo dan
 *   la forma. Con pocas conciliaciones, una gráfica grande daría empaque de dato
 *   sólido a lo que todavía es anécdota.
 * - **Serie única → sin leyenda** (el título nombra la serie) y un solo tono:
 *   violeta 600, validado contra la superficie clara. No es categórico: la
 *   altura ya codifica la magnitud, un segundo color no añadiría nada.
 * - **Etiqueta directa solo en la última barra.** Un número sobre cada punto
 *   convierte la gráfica en una tabla mal maquetada.
 * - **Separación de 2px entre barras** y extremo redondeado de 4px anclado a la
 *   base.
 * - Cada barra lleva su lectura completa en `title`/`aria-label`, de modo que la
 *   información no depende de ver la altura.
 */

const VIOLETA = "#7c3aed"; // violet-600 — contraste ≥3:1 sobre superficie clara
const MAX_BARRAS = 12;

export function CurvaAprendizaje({ m }: { m: MetricasAprendizaje }) {
  const conRevision = m.puntos.filter((p) => p.revisadas > 0);
  const visibles = conRevision.slice(-MAX_BARRAS);

  return (
    <section
      aria-labelledby="h-curva"
      className="rounded-2xl border border-neutral-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id="h-curva" className="font-semibold text-neutral-900">
            ¿Está acertando más?
          </h2>
          <p className="mt-0.5 max-w-prose text-sm text-neutral-600">
            De las sugerencias que la IA te propuso y tú revisaste, cuántas
            diste por buenas sin corregir.
          </p>
        </div>
      </div>

      {m.revisadas === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          Todavía no has revisado ninguna sugerencia de la IA. En cuanto aceptes
          o rechaces las primeras, aquí aparecerá su tasa de acierto y si mejora
          con el tiempo.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
            <p className="flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums text-violet-800">
                {pct(m.tasa)}
              </span>
              <span className="text-sm text-neutral-600">
                de acierto
                <br />
                en {m.revisadas.toLocaleString("es-PE")}{" "}
                {m.revisadas === 1 ? "sugerencia revisada" : "sugerencias revisadas"}
              </span>
            </p>

            {/* La tendencia es la afirmación fuerte del módulo, así que solo
                aparece cuando hay datos que la sostengan. Si no, se dice por
                qué en vez de callar. */}
            {m.tendencia ? (
              <p className="text-sm text-neutral-700">
                Pasó de{" "}
                <span className="tabular-nums">{pct(m.tendencia.tasaAntes)}</span>{" "}
                a{" "}
                <span className="font-medium tabular-nums text-neutral-900">
                  {pct(m.tendencia.tasaDespues)}
                </span>{" "}
                <span
                  className={
                    m.tendencia.delta >= 0
                      ? "font-medium text-emerald-800"
                      : "font-medium text-rose-700"
                  }
                >
                  ({m.tendencia.delta >= 0 ? "+" : ""}
                  {m.tendencia.delta} puntos)
                </span>
              </p>
            ) : (
              m.motivoSinTendencia && (
                <p className="max-w-xs text-sm text-neutral-500">
                  {m.motivoSinTendencia}
                </p>
              )
            )}
          </div>

          {visibles.length > 0 && (
            <figure className="mt-5">
              <figcaption className="sr-only">
                Tasa de acierto por conciliación, de la más antigua a la más
                reciente
              </figcaption>
              {/* gap-0.5 = los 2px de separación entre barras */}
              <div className="flex h-24 items-end gap-0.5" role="img"
                aria-label={visibles
                  .map(
                    (p) =>
                      `${p.fecha ? formatearFecha(p.fecha) : "sin fecha"}: ${pct(p.tasa)}`,
                  )
                  .join("; ")}
              >
                {visibles.map((p, i) => {
                  const alto = Math.round((p.tasa ?? 0) * 100);
                  const ultima = i === visibles.length - 1;
                  return (
                    <div
                      key={p.jobId}
                      className="flex h-full flex-1 flex-col justify-end"
                      title={`${p.fecha ? formatearFecha(p.fecha) : "sin fecha"} · ${pct(p.tasa)} de acierto · ${p.aceptadas} aceptadas, ${p.rechazadas} rechazadas, ${p.modificadas} corregidas`}
                    >
                      {ultima && (
                        <span className="mb-1 text-center text-xs font-medium tabular-nums text-neutral-700">
                          {pct(p.tasa)}
                        </span>
                      )}
                      <div
                        className="rounded-t"
                        style={{
                          height: `${Math.max(alto, 2)}%`,
                          backgroundColor: VIOLETA,
                          opacity: ultima ? 1 : 0.55,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-neutral-500">
                <span>
                  {visibles[0]?.fecha ? formatearFecha(visibles[0].fecha) : ""}
                </span>
                <span>
                  {visibles[visibles.length - 1]?.fecha
                    ? formatearFecha(visibles[visibles.length - 1]!.fecha!)
                    : ""}
                </span>
              </div>
            </figure>
          )}

          <dl className="mt-5 grid gap-4 border-t border-neutral-200 pt-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-neutral-600">Aceptadas sin tocar</dt>
              <dd className="font-medium tabular-nums text-neutral-900">
                {m.aceptadas.toLocaleString("es-PE")}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-600">Corregidas</dt>
              <dd className="font-medium tabular-nums text-neutral-900">
                {m.modificadas.toLocaleString("es-PE")}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-600">Rechazadas</dt>
              <dd className="font-medium tabular-nums text-neutral-900">
                {m.rechazadas.toLocaleString("es-PE")}
              </dd>
            </div>
          </dl>

          {/* Honestidad de la métrica: lo auto-conciliado es el ahorro real de
              trabajo, pero NADIE lo revisó, así que no puede presentarse como
              precisión verificada. Se cuenta, y se dice qué es. */}
          {m.automaticas > 0 && (
            <p className="mt-3 text-xs text-neutral-500">
              Otras{" "}
              <span className="tabular-nums">
                {m.automaticas.toLocaleString("es-PE")}
              </span>{" "}
              se conciliaron solas por confianza alta y no entran en esta tasa:
              nadie las revisó, así que no son prueba de acierto.
            </p>
          )}
        </>
      )}
    </section>
  );
}
