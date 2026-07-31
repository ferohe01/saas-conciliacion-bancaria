import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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
import { EncabezadoPagina, EstadoVacio, clasesBoton } from "@/components/ui";
import { DocumentoIcon, CandadoIcon } from "@/components/wizard/icons";

export const COLUMNAS_SALDO =
  "id, fecha, fecha_vencimiento, monto, saldo, tipo, estado, serie_numero, ruc_contraparte, razon_social_contraparte";

export default async function CobranzasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // El límite se hace cumplir AQUÍ, en el servidor. Ocultar el enlace en la
  // barra lateral orienta, pero no protege: esta ruta se alcanza escribiéndola.
  const permitido = await empresaTieneModulo("cobranzas");
  const modulo = buscarModulo("cobranzas")!;

  if (!permitido) {
    return (
      <div className="space-y-6">
        <EncabezadoPagina titulo="Cuentas por cobrar" />
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

  const supabase = await createClient(); // RLS: solo la empresa del usuario
  const { data } = await supabase
    .from("comprobantes")
    .select(COLUMNAS_SALDO)
    .order("fecha", { ascending: true });

  const todas = (data ?? []) as ComprobanteCobrar[];
  const hoy = new Date();

  // Se filtra ANTES de agregar: si se filtrara la tabla dejando arriba el total
  // de todo, la pantalla mostraría dos cifras que no cuadran entre sí.
  const filtro = filtroSaldoDesdeParams(sp);
  const aging = calcularAging(filtrarSaldo(todas, filtro, hoy), hoy, "cobranza");

  // Sin filtro, para saber si el vacío es "no te deben nada" o "el filtro no
  // encuentra nada", que son dos mensajes muy distintos.
  const agingTotal = hayFiltroSaldo(filtro)
    ? calcularAging(todas, hoy, "cobranza")
    : aging;

  if (agingTotal.documentos === 0) {
    return (
      <div className="space-y-6">
        <EncabezadoPagina
          titulo="Cuentas por cobrar"
          descripcion="Quién te debe y desde cuándo."
        />
        <EstadoVacio
          icono={<DocumentoIcon className="h-6 w-6" />}
          titulo="Nadie te debe nada"
          texto="Aquí aparecen tus facturas pendientes de cobro. Carga tus comprobantes y, cada vez que concilies, lo cobrado se descuenta solo."
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
        titulo="Cuentas por cobrar"
        descripcion="Quién te debe y desde cuándo. Cada conciliación descuenta lo cobrado."
      />
      <FiltrosSaldo valores={filtro} etiquetaBusqueda="Cliente, RUC o serie" />

      {aging.documentos === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-600">
          Ninguno de los {agingTotal.documentos.toLocaleString("es-PE")}{" "}
          documentos por cobrar coincide con este filtro. Prueba a quitar alguno.
        </p>
      ) : (
      <VistaAging
        aging={aging}
        textos={{
          total: "Total por cobrar",
          notaVencido: "conviene reclamar",
          contraparte: "Cliente",
          tituloTabla: "Por cliente",
          subtituloTabla:
            "Ordenado por lo vencido: por ahí conviene empezar a cobrar.",
          pie: "Estos saldos se actualizan solos: cada vez que se concilia un depósito con una factura, lo cobrado se descuenta del comprobante.",
        }}
      />
      )}
    </div>
  );
}
