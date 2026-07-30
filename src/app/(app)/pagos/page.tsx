import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { empresaTieneModulo } from "@/lib/modulos-servidor";
import { buscarModulo } from "@/lib/modulos";
import { CONTACTO_SUSCRIPCION, montoPEN } from "@/lib/suscripcion";
import { calcularAging, type ComprobanteCobrar } from "@/lib/aging";
import { VistaAging } from "@/components/app/VistaAging";
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
export default async function PagosPage() {
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
  const { data } = await supabase
    .from("comprobantes")
    .select(COLUMNAS_SALDO)
    .order("fecha", { ascending: true });

  const aging = calcularAging((data ?? []) as ComprobanteCobrar[], new Date(), "pago");

  if (aging.documentos === 0) {
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
    </div>
  );
}
