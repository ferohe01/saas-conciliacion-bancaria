"use client";

import { useEffect, useRef, useState } from "react";
import {
  CONTACTO_SUSCRIPCION,
  DATOS_PAGO,
  PLANES_SUSCRIPCION,
  PLAN_POR_DEFECTO,
  ahorroAnual,
  montoPEN,
  type PlanId,
} from "@/lib/suscripcion";
import { clasesBoton } from "@/components/ui";

/**
 * Instrucciones de pago para activar la cuenta.
 *
 * Se usa <dialog> nativo en vez de un div con overlay: trae gratis el foco
 * atrapado, el cierre con Escape, el fondo inerte y el rol correcto para
 * lectores de pantalla. Reimplementar todo eso a mano es donde se rompen los
 * modales caseros.
 */

/**
 * Identificador del banco.
 *
 * ⚠️ NO es el logotipo oficial del BCP: es una marca de texto en sus colores,
 * porque el archivo oficial no se puede fabricar de memoria sin que salga una
 * imitación pobre. Para poner el real: guarda el SVG en `public/bcp.svg` y
 * sustituye este bloque por
 *   <img src="/bcp.svg" alt="Banco de Crédito del Perú" className="h-9 w-auto" />
 * (el proyecto aún no tiene carpeta `public/`; hay que crearla).
 */
function MarcaBanco() {
  return (
    <span
      className="inline-flex h-9 shrink-0 items-center rounded-md px-2.5 text-base font-bold tracking-tight text-white"
      style={{ backgroundColor: "#F87C00" }}
      aria-hidden
    >
      {DATOS_PAGO.bancoCorto}
    </span>
  );
}

function FilaDato({
  etiqueta,
  valor,
  copiable = false,
}: {
  etiqueta: string;
  valor: string;
  copiable?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles el número sigue visible y seleccionable.
      setCopiado(false);
    }
  }

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
      <dt className="text-sm text-neutral-600">{etiqueta}</dt>
      <dd className="flex items-center gap-2">
        <span
          className={`text-sm font-medium text-neutral-900 ${copiable ? "tabular-nums" : ""}`}
        >
          {valor}
        </span>
        {copiable && (
          <button
            type="button"
            onClick={copiar}
            className="rounded-md border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            {copiado ? "Copiado" : "Copiar"}
          </button>
        )}
      </dd>
    </div>
  );
}

export function ModalPago({
  variante = "primario",
  etiqueta = "Activar mi cuenta",
}: {
  variante?: "primario" | "enlace";
  etiqueta?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [plan, setPlan] = useState<PlanId>(PLAN_POR_DEFECTO);
  const elegido =
    PLANES_SUSCRIPCION.find((p) => p.id === plan) ?? PLANES_SUSCRIPCION[0];

  // <dialog> se abre por método, no por atributo: showModal() es lo que activa
  // el backdrop, la inercia del fondo y la trampa de foco.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={
          variante === "primario"
            ? `${clasesBoton("primario", "md")} shrink-0`
            : "rounded font-medium underline underline-offset-2 transition-colors hover:text-amber-950"
        }
      >
        {etiqueta}
      </button>

      <dialog
        ref={ref}
        onClose={() => setAbierto(false)}
        aria-labelledby="titulo-pago"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-3xl border border-neutral-200 bg-white p-0 text-neutral-900 shadow-flotante backdrop:bg-neutral-900/40"
      >
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5">
          <div>
            <h2 id="titulo-pago" className="text-lg font-semibold">
              Activar tu cuenta
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              Por el momento la activación se realiza solo por{" "}
              <strong className="font-medium text-neutral-900">
                transferencia bancaria
              </strong>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            aria-label="Cerrar"
            className="-mt-1 -mr-2 shrink-0 rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Primero cuánto, después a dónde: el usuario elige importe y luego
              transfiere. El filete lo dibuja el fondo asomando por el gap. */}
          {/* Radios nativos, no divs con onClick: traen gratis las flechas del
              teclado, el agrupado por `name` y el anuncio correcto en lectores
              de pantalla. El input va oculto y se dibuja el círculo, porque el
              color no puede ser el único indicador de qué está elegido. */}
          <fieldset>
            <legend className="text-[0.6875rem] font-medium tracking-[0.05em] text-neutral-500 uppercase">
              Elige tu plan
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200">
              {PLANES_SUSCRIPCION.map((p) => {
                const ahorro = p.id === "anual" ? ahorroAnual() : 0;
                return (
                  <label
                    key={p.id}
                    className="group block h-full cursor-pointer bg-white px-4 py-3.5 transition-colors hover:bg-neutral-50 has-[:checked]:bg-blue-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-200 has-[:focus-visible]:ring-inset"
                  >
                    <input
                      type="radio"
                      name="plan-suscripcion"
                      value={p.id}
                      checked={plan === p.id}
                      onChange={() => setPlan(p.id)}
                      className="sr-only"
                    />
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-neutral-400 group-has-[:checked]:border-blue-600"
                      >
                        <span className="h-2 w-2 rounded-full bg-transparent group-has-[:checked]:bg-blue-600" />
                      </span>
                      <span className="text-sm font-medium text-neutral-900">
                        {p.nombre}
                      </span>
                    </span>
                    <span className="mt-1 block text-xl font-bold tabular-nums text-neutral-900">
                      {montoPEN(p.monto)}
                    </span>
                    <span className="mt-0.5 block text-sm text-neutral-600">
                      {p.periodo}
                    </span>
                    {/* Sin verde: aquí el verde significa "conciliado", no
                        "bueno". El énfasis va por peso. */}
                    {ahorro > 0 && (
                      <span className="mt-1.5 block text-sm font-medium tabular-nums text-neutral-900">
                        Ahorras {montoPEN(ahorro)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <h3 className="mt-5 text-[0.6875rem] font-medium tracking-[0.05em] text-neutral-500 uppercase">
            Transfiere a esta cuenta
          </h3>
          <div className="mt-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center gap-3">
              <MarcaBanco />
              <div className="min-w-0">
                <p className="truncate font-semibold">{DATOS_PAGO.banco}</p>
                <p className="text-sm text-neutral-600">{DATOS_PAGO.tipo}</p>
              </div>
            </div>

            <dl className="mt-3 divide-y divide-neutral-200 border-t border-neutral-200">
              <FilaDato etiqueta="Número de cuenta" valor={DATOS_PAGO.numero} copiable />
              <FilaDato
                etiqueta="CCI (desde otro banco)"
                valor={DATOS_PAGO.cci}
                copiable
              />
              <FilaDato etiqueta="Moneda" valor={`Soles (${DATOS_PAGO.moneda})`} />
              <FilaDato
                etiqueta="Titular"
                valor={`${DATOS_PAGO.titular} · ${DATOS_PAGO.cargo}`}
              />
              {/* El importe cierra el bloque: es el último dato que el usuario
                  necesita antes de ir a su banca. Cambia con el plan elegido. */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <dt className="text-sm font-medium text-neutral-900">
                  Importe a pagar
                </dt>
                <dd className="text-lg font-bold tabular-nums text-neutral-900">
                  {montoPEN(elegido.monto)}{" "}
                  <span className="text-sm font-normal text-neutral-600">
                    ({elegido.nombre.toLowerCase()})
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          <p className="mt-4 text-sm text-neutral-700">
            Cuando hayas hecho la transferencia, envíanos el comprobante
            indicando que elegiste el{" "}
            <strong className="font-medium text-neutral-900">
              plan {elegido.nombre.toLowerCase()}
            </strong>{" "}
            y activamos tu cuenta. Conservas todas tus conciliaciones anteriores:
            la activación solo vuelve a habilitar la creación de nuevas.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-neutral-200 px-6 py-4">
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className={clasesBoton("secundario", "md")}
          >
            Cerrar
          </button>
          <a href={CONTACTO_SUSCRIPCION} className={clasesBoton("primario", "md")}>
            Enviar comprobante
          </a>
        </div>
      </dialog>
    </>
  );
}
