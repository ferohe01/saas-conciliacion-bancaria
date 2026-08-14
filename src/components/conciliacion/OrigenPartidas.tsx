import Link from "next/link";
import { ResiduoExplicado } from "./ResiduoExplicado";
import {
  cascadaPartidas,
  resumenDiferencia,
  type OrigenPartidas as Origen,
  type ResultadoMotor,
} from "@/lib/origenPartidas";

/**
 * «De tu archivo a la conciliación»: dónde se quedó cada partida.
 *
 * ── Por qué esta pantalla existe ───────────────────────────────────────────
 *
 * En una demo, un cliente comparó su Excel (452.605 filas) con el panel
 * (452.177 registros internos) y preguntó por las 428 que faltaban. No había
 * respuesta que dar: las restas eran correctas —filas repetidas, comprobantes
 * de otro mes— pero vivían repartidas entre un mensaje que ya había
 * desaparecido y un filtro de fechas que nadie ve.
 *
 * ── Cómo se enseña ─────────────────────────────────────────────────────────
 *
 * Una cascada: se parte de un número que el usuario reconoce (las filas de SU
 * archivo) y cada resta lleva su motivo al lado. Deliberadamente **se enseñan
 * también los ceros**: "0 filas sin fecha ni importe" es lo que convierte la
 * lista en una cuenta comprobable, y sin ella un 296 suelto parece un fallo. Es
 * el mismo criterio del aviso de "se conservaron N por tener cobros
 * aplicados", que se muestra aunque sean cero.
 *
 * ⚠️ Las cifras salen de una foto tomada al conciliar, no de un recálculo. Tras
 * aprobar, los comprobantes casados pasan a `cobrado` y volver a contarlos daría
 * un número peor cada vez que alguien abriera la pantalla.
 */

const NUM = (n: number) => n.toLocaleString("es-PE");

function Fila({
  etiqueta,
  cantidad,
  tipo,
  explicacion,
  sinExplicar,
}: {
  etiqueta: string;
  cantidad: number;
  tipo: "inicio" | "resta" | "total";
  explicacion: string;
  sinExplicar?: boolean;
}) {
  const esResta = tipo === "resta";
  const cero = esResta && cantidad === 0;

  return (
    <li
      className={
        "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3" +
        (tipo === "total" ? " bg-neutral-50" : "")
      }
    >
      <div className="min-w-0 flex-1">
        <p
          className={
            "text-sm " +
            (tipo === "resta"
              ? cero
                ? "text-neutral-500"
                : "text-neutral-800"
              : "font-semibold text-neutral-900")
          }
        >
          {esResta && <span aria-hidden className="mr-1 text-neutral-400">−</span>}
          {etiqueta}
          {sinExplicar && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
              sin explicar
            </span>
          )}
        </p>
        <p className={"mt-0.5 text-xs " + (cero ? "text-neutral-400" : "text-neutral-600")}>
          {explicacion}
        </p>
      </div>
      <span
        className={
          "shrink-0 tabular-nums " +
          (tipo === "total"
            ? "text-lg font-bold text-neutral-900"
            : cero
              ? "text-sm text-neutral-400"
              : "text-sm font-medium text-neutral-800")
        }
      >
        {NUM(cantidad)}
      </span>
    </li>
  );
}

export function OrigenPartidas({
  origen,
  motor,
  periodo,
  jobId,
  compacto = false,
}: {
  origen: Origen | null;
  motor: ResultadoMotor | null;
  /** Etiqueta legible del período conciliado, para encabezar la cascada. */
  periodo?: string;
  jobId?: string;
  /** En el panel se abre plegado; en el resumen ejecutivo, desplegado. */
  compacto?: boolean;
}) {
  const bloques = cascadaPartidas(origen, motor);
  if (bloques.length === 0) return null;

  const dif = resumenDiferencia(origen, motor);

  const cuerpo = (
    <div className="space-y-4">
      {/* La foto no existe para las conciliaciones anteriores a esta función.
          Decirlo es mejor que enseñar media cascada sin avisar de qué falta. */}
      {origen === null && (
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          De esta conciliación solo se guardó el resultado del motor. El detalle
          de qué se quedó fuera al cargar se registra desde ahora: la próxima
          corrida lo traerá completo.
        </p>
      )}
      {origen?.alcance === "empresa" && (
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          No se pudo saber qué carga trajo cada comprobante, así que estos
          conteos son de <strong>todos</strong> los comprobantes de la empresa,
          no solo de los que subiste para este período.
        </p>
      )}

      {bloques.map((b) => (
        <section key={b.clave}>
          <h3 className="mb-2 text-xs font-medium tracking-[0.05em] text-neutral-500 uppercase">
            {b.titulo}
          </h3>
          <ul className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            {b.lineas.map((l) => (
              <Fila key={l.clave} {...l} />
            ))}
          </ul>
        </section>
      ))}

      {/* La cascada termina en «sin conciliar», que es donde empieza la
          pregunta de verdad. Va aquí y no en otra pantalla. */}
      {jobId && <ResiduoExplicado jobId={jobId} />}

      {jobId && (
        <p className="text-sm text-neutral-600">
          Y cada partida puede explicarse una a una en{" "}
          <Link
            href={`/conciliacion/${jobId}`}
            className="font-medium text-blue-700 hover:underline"
          >
            la conciliación
          </Link>
          , con el botón «¿Por qué?».
        </p>
      )}
    </div>
  );

  const encabezado = (
    <>
      <span className="font-semibold text-neutral-900">
        De tu archivo a la conciliación
      </span>
      {periodo && <span className="ml-2 text-neutral-600">· {periodo}</span>}
      {dif && (
        <span className="mt-1 block text-sm font-normal text-neutral-600">
          {NUM(dif.total)} partidas {dif.base} no acabaron conciliadas:{" "}
          {dif.frase}
        </span>
      )}
    </>
  );

  if (!compacto) {
    return (
      <section aria-label="Origen de las partidas" className="space-y-3">
        <div>{encabezado}</div>
        {cuerpo}
      </section>
    );
  }

  // En el panel va plegado: es la respuesta a una pregunta concreta, no algo
  // que haya que mirar a diario. Un `details` no necesita JavaScript y deja la
  // cifra visible sin abrirlo.
  return (
    <details className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <summary className="cursor-pointer list-none px-5 py-4 transition-colors hover:bg-neutral-50">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0 flex-1">{encabezado}</div>
          <span className="shrink-0 text-sm font-medium text-blue-700 group-open:hidden">
            Ver el detalle
          </span>
          <span className="hidden shrink-0 text-sm font-medium text-blue-700 group-open:inline">
            Ocultar
          </span>
        </div>
      </summary>
      <div className="border-t border-neutral-200 bg-neutral-50/50 px-5 py-4">
        {cuerpo}
      </div>
    </details>
  );
}
