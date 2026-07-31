"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boton, CLASES_ENTRADA } from "@/components/ui";
import { formatearFecha, formatearPEN } from "@/lib/parsing/resumen";
import { revertirCobro, deshacerReversion } from "@/app/(app)/comprobantes/actions";

/**
 * Los cobros aplicados a un comprobante, con la posibilidad de anular uno.
 *
 * Se muestran las dos caras: lo que la conciliación aplicó y, si la hubo, la
 * reversión posterior. No se oculta el cobro revertido —eso reescribiría la
 * historia y dejaría un hueco inexplicable en una conciliación aprobada—; se
 * marca como anulado y se explica por qué.
 */

type Aplicacion = {
  job_id: string;
  id_movimiento: string;
  monto_aplicado: number;
  created_at: string;
  jobs_conciliacion: {
    periodo_desde: string;
    periodo_hasta: string;
    estado_contable: string | null;
    cuentas_bancarias: { banco: string; numero_enmascarado: string | null } | null;
  } | null;
};

type Reversion = {
  job_id: string;
  id_movimiento: string;
  monto_revertido: number;
  motivo: string | null;
  created_at: string;
};

const clave = (jobId: string, mov: string) => `${jobId}|${mov}`;

export function CobrosDelComprobante({
  comprobanteId,
  esPago,
  aplicaciones,
  reversiones,
}: {
  comprobanteId: string;
  esPago: boolean;
  aplicaciones: Aplicacion[];
  reversiones: Reversion[];
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const porClave = new Map(reversiones.map((r) => [clave(r.job_id, r.id_movimiento), r]));
  const palabra = esPago ? "pago" : "cobro";

  function anular(a: Aplicacion) {
    setError(null);
    startTransition(async () => {
      const r = await revertirCobro({
        comprobante_id: comprobanteId,
        job_id: a.job_id,
        id_movimiento: a.id_movimiento,
        motivo,
      });
      if (!r.ok) {
        setError(r.error ?? "No se pudo anular.");
        return;
      }
      setAnulando(null);
      setMotivo("");
      router.refresh();
    });
  }

  function deshacer(a: Aplicacion) {
    setError(null);
    startTransition(async () => {
      const r = await deshacerReversion(comprobanteId, a.job_id, a.id_movimiento);
      if (!r.ok) {
        setError(r.error ?? "No se pudo deshacer.");
        return;
      }
      router.refresh();
    });
  }

  if (aplicaciones.length === 0) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold text-neutral-900">
          {esPago ? "Pagos aplicados" : "Cobros aplicados"}
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          Todavía no se ha aplicado ningún {palabra}. Aparecerán aquí cuando
          concilies un movimiento del banco contra este documento.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-5 py-4">
        <h2 className="font-semibold text-neutral-900">
          {esPago ? "Pagos aplicados" : "Cobros aplicados"}
        </h2>
        <p className="mt-0.5 text-sm text-neutral-600">
          Si el banco revirtió alguno, anúlalo aquí: el saldo vuelve sin tocar el
          resto de la conciliación.
        </p>
      </div>

      <ul className="divide-y divide-neutral-200">
        {aplicaciones.map((a) => {
          const rev = porClave.get(clave(a.job_id, a.id_movimiento));
          const cuenta = a.jobs_conciliacion?.cuentas_bancarias;
          const abierto = anulando === clave(a.job_id, a.id_movimiento);

          return (
            <li key={clave(a.job_id, a.id_movimiento)} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p
                    className={`font-medium tabular-nums ${
                      rev ? "text-neutral-500 line-through" : "text-neutral-900"
                    }`}
                  >
                    {formatearPEN(Number(a.monto_aplicado), "PEN")}
                  </p>
                  <p className="mt-0.5 text-sm text-neutral-600">
                    {a.jobs_conciliacion && (
                      <>
                        Conciliación de{" "}
                        <span className="tabular-nums">
                          {formatearFecha(a.jobs_conciliacion.periodo_desde)} –{" "}
                          {formatearFecha(a.jobs_conciliacion.periodo_hasta)}
                        </span>
                        {cuenta && ` · ${cuenta.banco} ${cuenta.numero_enmascarado ?? ""}`}
                        {" · "}
                      </>
                    )}
                    <span className="font-mono text-xs">{a.id_movimiento}</span>
                  </p>
                  <Link
                    href={`/conciliacion/${a.job_id}`}
                    className="mt-1 inline-block rounded text-sm font-medium text-blue-700 transition-colors hover:text-blue-800"
                  >
                    Ver la conciliación
                  </Link>
                </div>

                <div className="shrink-0">
                  {rev ? (
                    <Boton
                      variante="secundario"
                      tamano="sm"
                      disabled={pendiente}
                      onClick={() => deshacer(a)}
                    >
                      Deshacer la anulación
                    </Boton>
                  ) : (
                    <Boton
                      variante="peligro"
                      tamano="sm"
                      disabled={pendiente}
                      onClick={() =>
                        setAnulando(abierto ? null : clave(a.job_id, a.id_movimiento))
                      }
                    >
                      Anular este {palabra}
                    </Boton>
                  )}
                </div>
              </div>

              {rev && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Anulado el{" "}
                  <span className="tabular-nums">
                    {new Date(rev.created_at).toLocaleDateString("es-PE")}
                  </span>
                  {rev.motivo ? `: ${rev.motivo}` : "."} El saldo volvió a estar
                  pendiente.
                </p>
              )}

              {abierto && !rev && (
                <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-neutral-700">
                      ¿Por qué se anula? (opcional, pero ayuda a entenderlo dentro
                      de seis meses)
                    </span>
                    <input
                      type="text"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Cheque devuelto, transferencia revertida…"
                      maxLength={500}
                      className={CLASES_ENTRADA}
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Boton
                      variante="peligro"
                      tamano="sm"
                      disabled={pendiente}
                      onClick={() => anular(a)}
                    >
                      Confirmar la anulación
                    </Boton>
                    <Boton
                      variante="sutil"
                      tamano="sm"
                      disabled={pendiente}
                      onClick={() => {
                        setAnulando(null);
                        setMotivo("");
                      }}
                    >
                      Cancelar
                    </Boton>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
