import Link from "next/link";
import { EncabezadoPagina, EstadoVacio, clasesBoton } from "@/components/ui";
import { getPosicionCaja } from "@/lib/posicionCaja-servidor";
import {
  hayPosicion,
  etiquetaMovimientos,
  type BloqueMoneda,
  type CuentaCaja,
  type Frescura,
} from "@/lib/posicionCaja";
import { formatearPEN, formatearFecha } from "@/lib/parsing/resumen";

/**
 * POSICIÓN DE CAJA
 *
 * THESIS: es la primera pantalla del producto que puede afirmar algo sobre el
 * dinero de la empresa **porque está probado contra el extracto del banco**.
 * Cualquiera pinta un saldo sumando movimientos; lo que aquí lo hace creíble es
 * que cada cifra viene de un período conciliado y APROBADO.
 *
 * STORY: primero si te puedes fiar (la fecha del corte), después cuánto hay.
 * Ese orden es deliberado: un saldo grande con una fecha vieja es peor que no
 * enseñar nada, porque se usa para decidir.
 *
 * ⚠️⚠️ NINGUNA CIFRA SIN SU FECHA DE CORTE. El sistema solo conoce el saldo al
 * cierre del último período conciliado; a mitad de agosto eso puede ser el 31
 * de julio. No es un defecto —es la naturaleza del dato— pero callarlo sí lo
 * sería.
 */

export const dynamic = "force-dynamic";

const TONO_FRESCURA: Record<string, string> = {
  al_dia: "border-emerald-200 bg-emerald-50 text-emerald-900",
  retraso: "border-amber-200 bg-amber-50 text-amber-900",
  desfasado: "border-amber-300 bg-amber-50 text-amber-900",
  sin_datos: "border-neutral-200 bg-neutral-50 text-neutral-700",
};

function AvisoFrescura({ f }: { f: Frescura }) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
        TONO_FRESCURA[f.estado] ?? TONO_FRESCURA.sin_datos
      }`}
    >
      <p>
        {f.estado === "al_dia" ? "✓ " : "⚠️ "}
        {f.texto}
      </p>
      {/* ⚠️ El aviso NO bloquea nada: las cifras siguen siendo verdad sobre su
          fecha. Lo que cambia es cuál es el botón que conviene pulsar. */}
      {f.estado !== "al_dia" && (
        <Link href="/wizard" className={clasesBoton("primario", "sm")}>
          Conciliar el último período
        </Link>
      )}
    </div>
  );
}

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

function nombreCuenta(c: CuentaCaja): string {
  return c.numero ? `${c.banco} ${c.numero}` : c.banco;
}

function Bloque({ b }: { b: BloqueMoneda }) {
  const m = (n: number) => formatearPEN(n, b.moneda);

  return (
    <section
      aria-labelledby={`h-${b.moneda}`}
      className="space-y-4 rounded-3xl border border-neutral-200 bg-neutral-50 p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`h-${b.moneda}`} className="font-semibold text-neutral-900">
          {b.moneda === "USD" ? "Dólares" : b.moneda === "PEN" ? "Soles" : b.moneda}
        </h2>
        <p className="text-sm text-neutral-600">
          {b.corteMasAntiguo
            ? `Corte al ${formatearFecha(b.corteMasAntiguo)}`
            : "Sin corte aprobado"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Cifra
          etiqueta="En bancos"
          valor={m(b.saldo)}
          detalle={`${b.cuentas.length - b.sinConciliar.length - b.sinSaldo.length} de ${b.cuentas.length} ${b.cuentas.length === 1 ? "cuenta" : "cuentas"}`}
        />
        <Cifra
          etiqueta="Entradas"
          valor={m(b.entradas)}
          detalle={etiquetaMovimientos(b)}
          tono="bueno"
        />
        <Cifra etiqueta="Salidas" valor={m(b.salidas)} detalle={etiquetaMovimientos(b)} />
        <Cifra
          etiqueta="Disponible"
          valor={m(b.disponible)}
          detalle="Descontando lo que ya debes y venció"
          tono={b.disponible < 0 ? "alerta" : "neutral"}
        />
      </div>

      {/* ⚠️ «Disponible» lleva SIEMPRE su fórmula al lado. Un número llamado así
          sin decir qué se le restó invita a gastárselo. */}
      <p className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
        Disponible = <strong>{m(b.saldo)}</strong> en bancos −{" "}
        <strong>{m(b.vencido)}</strong> que ya debías y venció ={" "}
        <strong className="tabular-nums">{m(b.disponible)}</strong>.{" "}
        <Link href="/pagos" className="font-medium text-blue-700 hover:underline">
          Ver a quién
        </Link>
        .
      </p>

      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="border-b border-neutral-200 text-left text-neutral-600">
            <tr>
              <th className="px-4 py-2.5 font-medium">Cuenta</th>
              <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
              <th className="px-4 py-2.5 font-medium">Corte</th>
              <th className="px-4 py-2.5 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {b.cuentas.map((c) => (
              <tr key={c.cuentaId} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5 text-neutral-900">{nombreCuenta(c)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">
                  {c.saldoFinal == null ? "—" : m(c.saldoFinal)}
                </td>
                <td className="px-4 py-2.5 text-neutral-700">
                  {c.corteHasta ? formatearFecha(c.corteHasta) : "—"}
                </td>
                <td className="px-4 py-2.5 text-neutral-600">
                  {c.jobId == null ? (
                    "Sin conciliar"
                  ) : c.saldoFinal == null ? (
                    "Sin saldo declarado"
                  ) : (
                    <Link
                      href={`/conciliacion/${c.jobId}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      Ver la conciliación
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Las dos formas de quedarse fuera del total se explican distinto, porque
          lo que hay que hacer con cada una es distinto. */}
      {b.sinConciliar.length > 0 && (
        <p className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
          {b.sinConciliar.map(nombreCuenta).join(", ")}{" "}
          {b.sinConciliar.length === 1 ? "no tiene" : "no tienen"} ninguna
          conciliación aprobada, así que su saldo{" "}
          {b.sinConciliar.length === 1 ? "no entra" : "no entran"} en el total.
        </p>
      )}
      {b.sinSaldo.length > 0 && (
        <p className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
          En {b.sinSaldo.map(nombreCuenta).join(", ")} no se declaró el saldo
          final del extracto, así que no suma. Contarlo como cero rebajaría el
          total sin que nadie lo hubiera dicho.
        </p>
      )}
    </section>
  );
}

export default async function CajaPage() {
  const { bloques, cobrosIncompletos } = await getPosicionCaja();

  if (!hayPosicion(bloques)) {
    return (
      <div className="space-y-6">
        <EncabezadoPagina
          titulo="Posición de caja"
          descripcion="Cuánta plata tienes, con la fecha de la que sale cada cifra."
        />
        {/* ⚠️ Un estado vacío, no ceros: «S/ 0,00» diría que no tienes dinero,
            que es una afirmación que nadie ha hecho. */}
        <EstadoVacio
          titulo="Todavía no hay ninguna conciliación aprobada"
          texto="La posición de caja sale de tus conciliaciones aprobadas: es lo que hace que estas cifras estén probadas contra el extracto del banco y no sean una suma más. En cuanto apruebes la primera, aparecerá aquí."
          accion={
            <Link href="/wizard" className={clasesBoton("primario")}>
              Conciliar un período
            </Link>
          }
        />
      </div>
    );
  }

  // La frescura que preside la pantalla es la PEOR de todos los bloques: un
  // encabezado solo vale lo que valga su parte más vieja.
  const peor =
    [...bloques]
      .map((b) => b.frescura)
      .sort((a, z) => (z.dias ?? -1) - (a.dias ?? -1))[0] ?? null;

  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Posición de caja"
        descripcion="Cuánta plata tienes, con la fecha de la que sale cada cifra. Solo cuenta lo conciliado y aprobado."
      />

      {peor && <AvisoFrescura f={peor} />}

      {cobrosIncompletos.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⚠️ En{" "}
          {cobrosIncompletos.length === 1
            ? "una conciliación aprobada"
            : `${cobrosIncompletos.length} conciliaciones aprobadas`}{" "}
          el reparto de cobros quedó a medias, así que lo vencido sale más alto
          de lo que es y el <strong>disponible</strong> se queda corto. El saldo
          en bancos no se ve afectado.{" "}
          <Link
            href={`/conciliacion/${cobrosIncompletos[0]!.jobId}`}
            className="font-medium underline"
          >
            Reintentar la aplicación de cobros
          </Link>
          .
        </p>
      )}

      {/* ⚠️ Un bloque por moneda, sin sumar entre ellas y sin filtrar a una
          sola: un total que mezcla soles y dólares no responde a ninguna
          pregunta, y esconder el resto tampoco. */}
      {bloques.map((b) => (
        <Bloque key={b.moneda} b={b} />
      ))}

      <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-sm text-neutral-600">
        Estas cifras no proyectan nada: dicen, con fecha, lo que hay. Lo que
        entra y sale a futuro —cuotas, planilla, impuestos— todavía no vive en
        el sistema.
      </p>
    </div>
  );
}
