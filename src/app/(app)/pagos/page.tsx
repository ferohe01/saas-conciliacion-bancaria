import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/supabase/paginado";
import { empresaTieneModulo } from "@/lib/modulos-servidor";
import { buscarModulo } from "@/lib/modulos";
import { CONTACTO_SUSCRIPCION, montoPEN } from "@/lib/suscripcion";
import { calcularAging, type ComprobanteCobrar } from "@/lib/aging";
import { VistaAging } from "@/components/app/VistaAging";
import { FiltrosSaldo } from "@/components/comprobantes/FiltrosSaldo";
import {
  filtrarSaldo,
  filtroSaldoDesdeParams,
  hayFiltroSaldo,
} from "@/lib/filtrosSaldo";
import { COLUMNAS_SALDO } from "@/app/(app)/cobranzas/page";
import { EncabezadoPagina, EstadoVacio, clasesBoton } from "@/components/ui";
import { DocumentoIcon, CandadoIcon } from "@/components/wizard/icons";

/**
 * Cuentas por pagar: el lado espejo de las cobranzas.
 *
 * Mismo cálculo y misma vista; cambia el tipo de comprobante y las palabras.
 * Se mantienen en pantallas separadas a propósito: sumar lo que te deben con lo
 * que debes da un número que no responde a ninguna pregunta, y cada lado se
 * gestiona distinto — a los clientes los persigues, a los proveedores los
 * programas.
 */
export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const permitido = await empresaTieneModulo("cobranzas");
  const modulo = buscarModulo("cobranzas")!;

  if (!permitido) {
    return (
      <div className="space-y-6">
        <EncabezadoPagina titulo="Cuentas por pagar" />
        <EstadoVacio
          icono={<CandadoIcon className="h-6 w-6" />}
          titulo="Este módulo no está contratado"
          texto={modulo.descripcion}
          accion={
            <a href={CONTACTO_SUSCRIPCION} className={clasesBoton("primario", "md")}>
              {modulo.precioMensual === null
                ? "Consúltanos"
                : `Activar por ${montoPEN(modulo.precioMensual)}/mes`}
            </a>
          }
        />
      </div>
    );
  }

  const supabase = await createClient();
  // Paginado: PostgREST corta en 1.000 filas y la antigüedad de deuda se
  // calcula sobre TODO lo pendiente. Con más comprobantes, los totales de
  // arriba habrían mentido sin avisar.
  const todas = (await traerTodo((d, h) =>
    supabase
      .from("comprobantes")
      .select(COLUMNAS_SALDO)
      .order("fecha", { ascending: true })
      .range(d, h),
  )) as unknown as ComprobanteCobrar[];
  const hoy = new Date();

  // Se filtra ANTES de agregar: filtrar la tabla dejando arriba el total de
  // todo mostraría dos cifras que no cuadran entre sí.
  const filtro = filtroSaldoDesdeParams(sp);
  const aging = calcularAging(filtrarSaldo(todas, filtro, hoy), hoy, "pago");

  const agingTotal = hayFiltroSaldo(filtro)
    ? calcularAging(todas, hoy, "pago")
    : aging;

  if (agingTotal.documentos === 0) {
    return (
      <div className="space-y-6">
        <EncabezadoPagina
          titulo="Cuentas por pagar"
          descripcion="A quién le debes y para cuándo."
        />
        <EstadoVacio
          icono={<DocumentoIcon className="h-6 w-6" />}
          titulo="No debes nada"
          texto="Aquí aparecen las facturas de tus proveedores pendientes de pago. Cárgalas como comprobantes de tipo «pago» y, al conciliar, lo pagado se descuenta solo."
          accion={
            <Link href="/comprobantes" className={clasesBoton("primario", "md")}>
              Cargar comprobantes
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Cuentas por pagar"
        descripcion="A quién le debes y para cuándo. Cada conciliación descuenta lo pagado."
      />
      <FiltrosSaldo valores={filtro} etiquetaBusqueda="Proveedor, RUC o serie" />

      {aging.documentos === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-600">
          Ninguno de los {agingTotal.documentos.toLocaleString("es-PE")}{" "}
          documentos por pagar coincide con este filtro. Prueba a quitar alguno.
        </p>
      ) : (
      <VistaAging
        aging={aging}
        textos={{
          total: "Total por pagar",
          notaVencido: "ya deberías haberlo pagado",
          contraparte: "Proveedor",
          tituloTabla: "Por proveedor",
          subtituloTabla:
            "Ordenado por lo vencido: eso es lo que más urge programar.",
          pie: "Estos saldos se actualizan solos: cada vez que se concilia un cargo con una factura de proveedor, lo pagado se descuenta del comprobante.",
        }}
      />
      )}
    </div>
  );
}
