import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { traerResumenSaldos } from "@/lib/comprobantesSaldo";
import { empresaTieneModulo } from "@/lib/modulos-servidor";
import { buscarModulo } from "@/lib/modulos";
import { CONTACTO_SUSCRIPCION, montoPEN } from "@/lib/suscripcion";
import { VistaAging } from "@/components/app/VistaAging";
import { FiltrosSaldo } from "@/components/comprobantes/FiltrosSaldo";
import {
  FILTRO_SALDO_VACIO,
  filtroSaldoDesdeParams,
  hayFiltroSaldo,
} from "@/lib/filtrosSaldo";
import { EncabezadoPagina, EstadoVacio, clasesBoton } from "@/components/ui";
import { DocumentoIcon, CandadoIcon } from "@/components/wizard/icons";


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
  // Paginado + filtrado EN LA CONSULTA: la antigüedad se calcula sobre todo lo
  // pendiente, pero traer además lo cobrado y lo del otro lado era trabajo que
  // se tiraba. Ver `lib/comprobantesSaldo.ts`.
  const hoy = new Date();

  // El filtro viaja a la BASE y la suma la hace Postgres: la pantalla enseña
  // unas decenas de filas y antes se traían las 452.309 pendientes para
  // sumarlas aquí. Ver `lib/comprobantesSaldo.ts` y la migración 0021.
  //
  // Se filtra ANTES de agregar, no después: filtrar la tabla dejando arriba el
  // total de todo daría dos cifras que no cuadran entre sí.
  const filtro = filtroSaldoDesdeParams(sp);
  const aging = await traerResumenSaldos(supabase, "cobranza", filtro, hoy);

  // Sin filtro, para distinguir "no hay deuda" de "el filtro no encuentra
  // nada", que son dos mensajes muy distintos. Solo se pide si hace falta.
  const agingTotal = hayFiltroSaldo(filtro)
    ? await traerResumenSaldos(supabase, "cobranza", FILTRO_SALDO_VACIO, hoy)
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
