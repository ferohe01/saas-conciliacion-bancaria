"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/ui";
import { deshacerImportacion } from "@/app/(app)/wizard/actions";

/**
 * Las cargas de comprobantes hechas, cada una con su deshacer.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * "Deshacer esta importación" ya funcionaba, pero solo aparecía en el instante
 * de subir: vivía en el estado del componente de carga. Al recargar la página
 * desaparecía y la única salida era "Empezar de cero", que borra TODO y exige
 * escribir una palabra.
 *
 * Es decir: quitar la última carga para volver a subirla —lo más normal del
 * mundo mientras se preparan los datos— obligaba a borrarlo todo y volver a
 * empezar. Aquí cada carga tiene su propia salida y sobrevive a la recarga.
 */

export type Carga = { lote: string; filas: number; cargado: string };

export function CargasRealizadas({ cargas }: { cargas: Carga[] }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  if (cargas.length === 0) return null;

  const deshacer = (lote: string) => {
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const r = await deshacerImportacion(lote);
      if (!r.ok) {
        setError(r.error ?? "No se pudo deshacer la carga.");
        return;
      }
      setConfirmando(null);
      // Lo protegido se dice siempre, aunque sea cero: si se omitiera, un
      // "borrados 900 de 1.000" parecería un fallo en vez de la regla.
      const borrados = (r.borrados ?? 0).toLocaleString("es-PE");
      setAviso(
        r.protegidos
          ? `Se quitaron ${borrados} comprobantes. ${r.protegidos.toLocaleString("es-PE")} se conservaron porque ya tienen cobros aplicados: eso se anula desde la conciliación, no borrando.`
          : `Se quitaron ${borrados} comprobantes.`,
      );
      router.refresh();
    });
  };

  return (
    <section
      aria-labelledby="h-cargas"
      className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"
    >
      <div className="border-b border-neutral-200 px-5 py-4">
        <h2 id="h-cargas" className="font-semibold text-neutral-900">
          Cargas realizadas
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Puedes quitar una carga concreta sin tocar las demás — por ejemplo si
          subiste el archivo equivocado.
        </p>
      </div>

      <ul className="divide-y divide-neutral-200">
        {cargas.map((c) => (
          <li
            key={c.lote}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium tabular-nums text-neutral-900">
                {c.filas.toLocaleString("es-PE")}{" "}
                {c.filas === 1 ? "comprobante" : "comprobantes"}
              </p>
              <p className="text-xs tabular-nums text-neutral-600">
                {new Date(c.cargado).toLocaleString("es-PE", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            </div>

            {confirmando === c.lote ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-neutral-700">
                  ¿Quitar estos {c.filas.toLocaleString("es-PE")}?
                </span>
                <Boton
                  variante="peligro"
                  tamano="sm"
                  disabled={pendiente}
                  onClick={() => deshacer(c.lote)}
                >
                  {pendiente ? "Quitando…" : "Sí, quitar"}
                </Boton>
                <Boton
                  variante="secundario"
                  tamano="sm"
                  disabled={pendiente}
                  onClick={() => setConfirmando(null)}
                >
                  Cancelar
                </Boton>
              </div>
            ) : (
              // Confirmación en dos pasos, pero SIN escribir nada: quitar una
              // carga es reversible volviéndola a subir. La palabra escrita se
              // reserva para "Empezar de cero", que se lleva lo que no se sabe
              // de dónde salió.
              <Boton
                variante="secundario"
                tamano="sm"
                disabled={pendiente}
                onClick={() => setConfirmando(c.lote)}
              >
                Quitar esta carga
              </Boton>
            )}
          </li>
        ))}
      </ul>

      {aviso && (
        <p role="status" className="border-t border-neutral-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">
          {aviso}
        </p>
      )}
      {error && (
        <p role="alert" className="border-t border-neutral-200 bg-red-50 px-5 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
