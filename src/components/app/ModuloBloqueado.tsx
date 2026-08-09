import Link from "next/link";
import { buscarModulo, type ModuloId } from "@/lib/modulos";
import { ModalPago } from "@/components/app/ModalPago";
import { EncabezadoPagina, Tarjeta, clasesBoton } from "@/components/ui";

/**
 * Pantalla de un módulo al que la empresa no tiene acceso.
 *
 * Vive en un solo sitio porque el texto importa y estaba duplicado en dos
 * pantallas: Por cobrar y Por pagar son el mismo módulo, y que una dijera algo
 * distinto de la otra sería un fallo difícil de notar.
 *
 * ⚠️ Lo que se ofrece es **activar la cuenta**, no comprar este módulo. El
 * sistema se vende entero (ver `estadoModulo`), así que un botón de "activar
 * cuentas por cobrar" prometería una compra que no existe y dejaría al cliente
 * esperando una factura aparte.
 *
 * ⚠️ Y quien llega aquí NO está descubriendo una función nueva: durante la
 * prueba la estuvo usando y acaba de perderla. Decirle "no está contratado" a
 * secas, como si nunca la hubiera tenido, desperdicia el único momento en que ya
 * sabe exactamente lo que se pierde.
 */
export function ModuloBloqueado({
  titulo,
  modulo,
  pruebaVencida,
}: {
  titulo: string;
  modulo: ModuloId;
  pruebaVencida: boolean;
}) {
  const m = buscarModulo(modulo);
  const nombre = m?.nombre ?? "Esta sección";
  const descripcion = m?.descripcion ?? "";

  return (
    <div className="space-y-6">
      <EncabezadoPagina titulo={titulo} />

      <Tarjeta tono="atencion">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-neutral-900">
              {pruebaVencida
                ? "Tu período de prueba terminó"
                : `${nombre} no está disponible`}
            </h2>
            <p className="mt-1 max-w-prose text-sm text-neutral-700">
              {pruebaVencida
                ? `Durante la prueba tuviste el sistema completo. Activa tu cuenta y vuelves a tenerlo, esta sección incluida. ${descripcion}`
                : descripcion}
            </p>
          </div>
          <ModalPago />
        </div>
      </Tarjeta>

      <p className="text-sm text-neutral-600">
        Mientras tanto, tus{" "}
        <Link
          href="/comprobantes"
          className="rounded font-medium text-blue-700 underline underline-offset-2 transition-colors hover:text-blue-800"
        >
          comprobantes
        </Link>{" "}
        y tus{" "}
        <Link
          href="/conciliacion"
          className="rounded font-medium text-blue-700 underline underline-offset-2 transition-colors hover:text-blue-800"
        >
          conciliaciones anteriores
        </Link>{" "}
        se siguen consultando sin límite.
      </p>

      <div>
        <Link href="/dashboard" className={clasesBoton("secundario", "md")}>
          Volver al panel
        </Link>
      </div>
    </div>
  );
}
