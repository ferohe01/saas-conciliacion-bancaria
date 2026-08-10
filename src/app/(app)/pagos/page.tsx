import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerResumenSaldos } from "@/lib/comprobantesSaldo";
import { accesoModulo } from "@/lib/modulos-servidor";
import { ModuloBloqueado } from "@/components/app/ModuloBloqueado";
import { VistaAgingMonedas } from "@/components/app/VistaAging";
import { FiltrosSaldo } from "@/components/comprobantes/FiltrosSaldo";
import {
  FILTRO_SALDO_VACIO,
  filtroSaldoDesdeParams,
  hayFiltroSaldo,
} from "@/lib/filtrosSaldo";
import { EncabezadoPagina, EstadoVacio, clasesBoton } from "@/components/ui";
import { DocumentoIcon } from "@/components/wizard/icons";

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
  // Durante la prueba gratuita el módulo está abierto (ver `estadoModulo`).
  const acceso = await accesoModulo("cobranzas");

  if (!acceso.permitido) {
    return (
      <ModuloBloqueado
        titulo="Cuentas por pagar"
        modulo="cobranzas"
        pruebaVencida={acceso.pruebaVencida}
      />
    );
  }

  const supabase = await createClient();
  // Ver la nota de `lib/comprobantesSaldo.ts`: el filtro va en la consulta.
  // Sin él, esta pantalla recorría los 51.427 comprobantes de la empresa para
  // acabar sin un solo pago que enseñar.
  const hoy = new Date();

  // El filtro viaja a la BASE y la suma la hace Postgres: la pantalla enseña
  // unas decenas de filas y antes se traían las 452.309 pendientes para
  // sumarlas aquí. Ver `lib/comprobantesSaldo.ts` y la migración 0021.
  //
  // Se filtra ANTES de agregar, no después: filtrar la tabla dejando arriba el
  // total de todo daría dos cifras que no cuadran entre sí.
  const filtro = filtroSaldoDesdeParams(sp);
  const aging = await traerResumenSaldos(supabase, "pago", filtro, hoy);

  // Sin filtro, para distinguir "no hay deuda" de "el filtro no encuentra
  // nada", que son dos mensajes muy distintos. Solo se pide si hace falta.
  const agingTotal = hayFiltroSaldo(filtro)
    ? await traerResumenSaldos(supabase, "pago", FILTRO_SALDO_VACIO, hoy)
    : aging;

  const docsTotal = agingTotal.reduce((n, b) => n + b.aging.documentos, 0);
  const docsFiltrados = aging.reduce((n, b) => n + b.aging.documentos, 0);

  if (docsTotal === 0) {
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

      {docsFiltrados === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-600">
          Ninguno de los {docsTotal.toLocaleString("es-PE")}{" "}
          documentos por pagar coincide con este filtro. Prueba a quitar alguno.
        </p>
      ) : (
      /* Un bloque por moneda, sin sumar entre ellas. Ver `agingPorMoneda`. */
      <VistaAgingMonedas
        bloques={aging}
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
