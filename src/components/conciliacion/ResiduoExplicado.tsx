"use client";

import { useState } from "react";
import { explicarResiduo } from "@/app/(app)/conciliacion/[jobId]/actions";
import {
  leerResiduo,
  lineasDeLado,
  seriesDesiguales,
  hayResiduo,
  type ResiduoExplicado as Datos,
} from "@/lib/residuoExplicado";
import { formatearPEN } from "@/lib/parsing/resumen";

/**
 * «¿Y esas 4.384 partidas qué son?»
 *
 * La cascada de `OrigenPartidas` termina en «sin conciliar», y ahí empieza la
 * pregunta de verdad. Hasta ahora contestarla exigía abrir los dos Excel y
 * cruzarlos a mano; el cruce está en la base desde la 0044.
 *
 * ⚠️ **Se pide al pulsar.** La consulta recorre las dos tablas enteras y el
 * panel se abre a diario: cobrarle segundos a cada carga por una pregunta que
 * se hace de vez en cuando sería un mal negocio. Mismo criterio que el
 * «¿Por qué?» de cada partida.
 *
 * ⚠️ **El hecho y la lectura van separados.** El sistema puede comprobar que el
 * código de un recibo no está en el extracto; que «se cobró por otro canal» es
 * una interpretación probable, no un dato. Se enseña como tal.
 */

const NUM = (n: number) => n.toLocaleString("es-PE");

function Lado({
  titulo,
  lineas,
  moneda,
}: {
  titulo: string;
  lineas: ReturnType<typeof lineasDeLado>;
  moneda: string;
}) {
  if (lineas.length === 0) return null;
  return (
    <section>
      <h4 className="mb-2 text-xs font-medium tracking-[0.05em] text-neutral-500 uppercase">
        {titulo}
      </h4>
      <ul className="space-y-2">
        {lineas.map((l) => (
          <li
            key={l.clave}
            className="rounded-xl border border-neutral-200 bg-white px-4 py-3"
          >
            <p className="text-sm text-neutral-900">
              <strong className="tabular-nums">{NUM(l.partidas)}</strong> {l.hecho}
              {Math.abs(l.importe) > 0.005 && (
                <span className="text-neutral-600">
                  {" "}
                  · {formatearPEN(Math.abs(l.importe), moneda)}
                </span>
              )}
              .
            </p>
            <p className="mt-1 text-xs text-neutral-600">{l.lectura}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ResiduoExplicado({ jobId }: { jobId: string }) {
  const [estado, setEstado] = useState<"inicial" | "cargando" | "listo" | "error">(
    "inicial",
  );
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pedir = async () => {
    setEstado("cargando");
    setError(null);
    const r = await explicarResiduo(jobId);
    if (!r.ok) {
      setError(r.error ?? "No se pudo analizar.");
      setEstado("error");
      return;
    }
    setDatos(leerResiduo(r.datos));
    setEstado("listo");
  };

  if (estado === "inicial" || estado === "cargando" || estado === "error") {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white px-5 py-4">
        <p className="text-sm font-medium text-neutral-900">
          ¿Y lo que quedó sin conciliar, qué es?
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          Cruzamos cada partida suelta contra el otro lado y te decimos cuántas
          tienen su código allí y cuántas no aparecen en absoluto.
        </p>
        {error && (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={pedir}
          disabled={estado === "cargando"}
          className="mt-3 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {estado === "cargando" ? "Analizando…" : "Analizar"}
        </button>
      </div>
    );
  }

  // Sin datos: modo payload, o no quedó nada suelto. Se dice cuál de las dos.
  if (!hayResiduo(datos)) {
    return (
      <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-700">
        {datos === null
          ? "Esta conciliación guardó sus partidas dentro del propio resultado, así que el detalle se ve abriéndola."
          : "No quedó ninguna partida suelta: todo encontró pareja."}
      </p>
    );
  }

  const desiguales = seriesDesiguales(datos);

  return (
    <div className="space-y-4">
      <Lado
        titulo="Tus registros sin conciliar"
        lineas={lineasDeLado(datos, "interno")}
        moneda={datos!.moneda}
      />
      <Lado
        titulo="Movimientos del banco sin conciliar"
        lineas={lineasDeLado(datos, "banco")}
        moneda={datos!.moneda}
      />

      {/* ⚠️ La línea que cambia la conversación: cuando a una serie le faltan
          documentos de un lado, ninguna mejora del motor lo va a arreglar. */}
      {desiguales.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-medium tracking-[0.05em] text-neutral-500 uppercase">
            Series descompensadas
          </h4>
          <ul className="space-y-2">
            {desiguales.map((s) => (
              <li
                key={s.serie}
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                De los códigos que empiezan por <strong>{s.serie}</strong>, el
                banco trae <strong className="tabular-nums">{NUM(s.banco)}</strong>{" "}
                y tus registros{" "}
                <strong className="tabular-nums">{NUM(s.libros)}</strong>.{" "}
                {s.faltanEn === "libros"
                  ? `Faltan ${NUM(s.faltan)} documentos de esa serie en tus libros: no es un problema de emparejamiento.`
                  : `Hay ${NUM(s.faltan)} documentos de esa serie que el banco no cobró por esta cuenta.`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-neutral-500">
        Calculado ahora mismo sobre las partidas que siguen sueltas. Si concilias
        alguna a mano, vuelve a pulsar y el recuento cambia.
      </p>
    </div>
  );
}
