import Link from "next/link";
import { EncabezadoPagina, clasesBoton } from "@/components/ui";
import { FiltroPeriodos } from "@/components/resumen/FiltroPeriodos";
import { mesesRecientes, rangoDeMes } from "@/lib/periodo";
import { montoPEN } from "@/lib/suscripcion";
import { getResumenEjecutivo } from "@/lib/resumenEjecutivo-servidor";
import {
  porcentajeAutomatizado,
  posicionNeta,
} from "@/lib/resumenEjecutivo";

/**
 * RESUMEN EJECUTIVO
 *
 * THESIS: quien dirige no quiere saber cómo fue la conciliación — quiere saber
 * si puede pagar la planilla, a quién reclamar, y si puede fiarse de sus
 * propios saldos. Tres preguntas, y esta pantalla las responde en ese orden.
 *
 * STORY: primero el dinero (lo que entra, lo que sale, la posición), después la
 * confianza (¿está todo conciliado y aprobado?, ¿qué quedó sin explicar?), y
 * solo al final el detalle. Lo contrario —empezar por métricas de proceso— hace
 * que el gerente cierre la pestaña.
 *
 * ⚠️ DOS RELOJES, y la pantalla lo dice en voz alta: lo conciliado es del
 * período elegido; lo que te deben es una foto de hoy. Mezclarlos daría un "por
 * cobrar de junio" que no significa nada.
 */

const OPCIONES = mesesRecientes(24);

function Cifra({
  etiqueta,
  valor,
  detalle,
  tono = "neutral",
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  tono?: "neutral" | "bueno" | "alerta";
}) {
  const color =
    tono === "bueno"
      ? "text-emerald-700"
      : tono === "alerta"
        ? "text-amber-800"
        : "text-neutral-900";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <p className="text-sm text-neutral-600">{etiqueta}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{valor}</p>
      {detalle && <p className="mt-1 text-sm text-neutral-600">{detalle}</p>}
    </div>
  );
}

export default async function ResumenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const valores = OPCIONES.map((o) => o.valor);
  const hasta = valores.includes(sp.hasta ?? "") ? sp.hasta! : valores[0]!;
  const desde = valores.includes(sp.desde ?? "")
    ? sp.desde!
    : (valores[Math.min(2, valores.length - 1)] ?? hasta);

  const [ay, am] = desde.split("-").map(Number);
  const [by, bm] = hasta.split("-").map(Number);
  const r1 = rangoDeMes(ay!, am!);
  const r2 = rangoDeMes(by!, bm!);
  // El filtro se ordena solo: ver `FiltroPeriodos`.
  const rangoDesde = r1.desde <= r2.desde ? r1.desde : r2.desde;
  const rangoHasta = r1.hasta >= r2.hasta ? r1.hasta : r2.hasta;

  const r = await getResumenEjecutivo(rangoDesde, rangoHasta);
  const auto = porcentajeAutomatizado(r.periodo);
  const neta = posicionNeta(r.hoy);
  const sinConciliar = r.periodo.partidas - r.periodo.partidasConciliadas;

  const etiquetaRango =
    desde === hasta
      ? OPCIONES.find((o) => o.valor === desde)?.etiqueta
      : `${OPCIONES.find((o) => o.valor === (r1.desde <= r2.desde ? desde : hasta))?.etiqueta} – ${OPCIONES.find((o) => o.valor === (r1.desde <= r2.desde ? hasta : desde))?.etiqueta}`;

  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Resumen ejecutivo"
        descripcion="Las cifras para decidir: qué entra, qué sale y si puedes fiarte de tus saldos."
      />

      <FiltroPeriodos
        meses={OPCIONES.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta }))}
        desde={desde}
        hasta={hasta}
      />

      {/* ── 1. TU DINERO HOY ──────────────────────────────────────────────── */}
      <section aria-labelledby="h-dinero" className="space-y-3">
        <div>
          <h2 id="h-dinero" className="font-semibold text-neutral-900">
            Tu dinero, hoy
          </h2>
          <p className="text-sm text-neutral-600">
            Saldo vivo a día de hoy. No depende del período elegido: una factura
            de marzo sin cobrar sigue sin cobrarse en agosto.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Cifra
            etiqueta="Te deben"
            valor={montoPEN(r.hoy.porCobrar)}
            detalle={`${r.hoy.porCobrarDocs.toLocaleString("es-PE")} documentos · ${montoPEN(r.hoy.porCobrarVencido)} vencido`}
            tono={r.hoy.porCobrarVencido > 0 ? "alerta" : "neutral"}
          />
          <Cifra
            etiqueta="Debes"
            valor={montoPEN(r.hoy.porPagar)}
            detalle={`${r.hoy.porPagarDocs.toLocaleString("es-PE")} documentos · ${montoPEN(r.hoy.porPagarVencido)} vencido`}
          />
          <Cifra
            etiqueta="Posición neta"
            valor={montoPEN(neta)}
            detalle={neta >= 0 ? "A tu favor si todo se cobra" : "En contra"}
            tono={neta >= 0 ? "bueno" : "alerta"}
          />
        </div>
        {/* La posición neta no dice nada del calendario, y esa es justo la
            trampa: cobrar a 90 días y pagar a 30 da neto positivo y aun así te
            deja sin caja. */}
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          La posición neta no tiene en cuenta <strong>cuándo</strong> cobras y
          cuándo pagas. Si cobras a 90 días y pagas a 30, el neto puede salir a
          favor y aun así faltarte caja.{" "}
          <Link href="/cobranzas" className="font-medium text-blue-700 hover:underline">
            Ver la antigüedad
          </Link>
          .
        </p>
      </section>

      {/* ── 2. LO QUE SE MOVIÓ EN EL PERÍODO ──────────────────────────────── */}
      <section aria-labelledby="h-periodo" className="space-y-3">
        <div>
          <h2 id="h-periodo" className="font-semibold text-neutral-900">
            Movimiento del período · {etiquetaRango}
          </h2>
          <p className="text-sm text-neutral-600">
            Solo cuenta lo de las conciliaciones <strong>aprobadas</strong>: un
            borrador no mueve un céntimo.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Cifra
            etiqueta="Cobrado"
            valor={montoPEN(r.periodo.cobrado)}
            detalle={`${r.periodo.conciliaciones} ${r.periodo.conciliaciones === 1 ? "conciliación aprobada" : "conciliaciones aprobadas"}`}
            tono="bueno"
          />
          <Cifra etiqueta="Pagado" valor={montoPEN(r.periodo.pagado)} />
          <Cifra
            etiqueta="Conciliado automáticamente"
            valor={auto === null ? "—" : `${auto}%`}
            detalle={
              auto === null
                ? "No hubo partidas en el período"
                : `${r.periodo.partidasConciliadas.toLocaleString("es-PE")} de ${r.periodo.partidas.toLocaleString("es-PE")} partidas`
            }
            tono={auto !== null && auto >= 90 ? "bueno" : "neutral"}
          />
        </div>
      </section>

      {/* ── 3. ¿PUEDES FIARTE DE ESTOS NÚMEROS? ───────────────────────────── */}
      <section aria-labelledby="h-confianza" className="space-y-3">
        <h2 id="h-confianza" className="font-semibold text-neutral-900">
          ¿Puedes fiarte de estos números?
        </h2>

        {r.periodo.sinAprobar > 0 && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            ⚠️{" "}
            <strong>
              {r.periodo.sinAprobar}{" "}
              {r.periodo.sinAprobar === 1
                ? "conciliación terminada sin aprobar"
                : "conciliaciones terminadas sin aprobar"}
            </strong>{" "}
            en este rango. Su trabajo está hecho pero no cuenta en las cifras de
            arriba ni ha movido ningún saldo.{" "}
            <Link href="/conciliacion" className="font-medium underline">
              Revisarlas
            </Link>
            .
          </p>
        )}

        {Math.abs(r.periodo.diferenciaCuadre) > 0.005 ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Queda <strong>{montoPEN(Math.abs(r.periodo.diferenciaCuadre))}</strong> sin
            explicar entre tus libros y el banco, repartido en{" "}
            {sinConciliar.toLocaleString("es-PE")} partidas sin conciliar. No es
            un error necesariamente —suele ser cobros por otro canal o
            movimientos de otro mes— pero hasta aclararlo, tus saldos tienen ese
            margen.
          </p>
        ) : r.periodo.conciliaciones > 0 ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            ✓ Todo cuadra: no queda diferencia entre tus libros y el banco en
            este rango.
          </p>
        ) : (
          <p className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
            No hay conciliaciones aprobadas en este rango, así que no hay nada
            que contrastar todavía.{" "}
            <Link href="/wizard" className={clasesBoton("primario", "sm") + " ml-1"}>
              Conciliar un período
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
