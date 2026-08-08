"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CLASES_ENTRADA } from "@/components/ui";

/**
 * Rango de períodos del resumen ejecutivo.
 *
 * Meses, no fechas sueltas: quien mira esta pantalla piensa en «el trimestre» o
 * «lo que va del año», no en el 14 de marzo. Los atajos están porque son
 * literalmente las tres preguntas que se hacen, y obligar a elegir dos meses
 * para responderlas sería trabajo sin motivo.
 */
export function FiltroPeriodos({
  meses,
  desde,
  hasta,
}: {
  meses: { valor: string; etiqueta: string }[];
  desde: string;
  hasta: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pendiente, startTransition] = useTransition();

  const ir = (d: string, h: string) => {
    const p = new URLSearchParams(params.toString());
    p.set("desde", d);
    // ⚠️ Un rango al revés no se rechaza con un error: se ordena. El usuario
    // quería un rango, y decirle "la fecha inicial no puede ser posterior" para
    // algo que la pantalla puede resolver sola es hacerle trabajo.
    p.set("hasta", h);
    if (d > h) {
      p.set("desde", h);
      p.set("hasta", d);
    }
    startTransition(() => router.push(`/resumen?${p.toString()}`));
  };

  const atajo = (n: number) => {
    const fin = meses[0]!.valor;
    const ini = meses[Math.min(n - 1, meses.length - 1)]!.valor;
    ir(ini, fin);
  };

  return (
    <section
      aria-label="Período"
      className="rounded-2xl border border-neutral-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            Desde
          </span>
          <select
            className={CLASES_ENTRADA}
            value={desde}
            disabled={pendiente}
            onChange={(e) => ir(e.target.value, hasta)}
          >
            {meses.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-neutral-700">
            Hasta
          </span>
          <select
            className={CLASES_ENTRADA}
            value={hasta}
            disabled={pendiente}
            onChange={(e) => ir(desde, e.target.value)}
          >
            {meses.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2 pb-1">
          {[
            { n: 1, t: "Este mes" },
            { n: 3, t: "Últimos 3" },
            { n: 12, t: "Últimos 12" },
          ].map((a) => (
            <button
              key={a.n}
              type="button"
              disabled={pendiente}
              onClick={() => atajo(a.n)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
            >
              {a.t}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
