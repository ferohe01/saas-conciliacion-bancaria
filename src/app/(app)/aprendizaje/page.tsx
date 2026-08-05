import Link from "next/link";
import { getDatosAprendizaje } from "@/lib/aprendizaje-servidor";
import { PanelAprendizaje } from "@/components/aprendizaje/PanelAprendizaje";
import { CurvaAprendizaje } from "@/components/aprendizaje/CurvaAprendizaje";
import { MotivosRechazo } from "@/components/aprendizaje/MotivosRechazo";
import { CriteriosIniciales } from "@/components/aprendizaje/CriteriosIniciales";
import { EncabezadoPagina, Tarjeta } from "@/components/ui";

/**
 * Aprendizaje IA — sección propia.
 *
 * Antes vivía repartido: un panel en `/reportes` y una tarjeta en `/dashboard`,
 * ambos hospedados dentro de `ReporteVista.tsx`. Es el diferenciador del
 * producto, así que deja de ser el tercer bloque de otra pantalla.
 *
 * NO es un módulo contratable (no pasa por `suscripciones_modulo`): es núcleo.
 * Poner detrás de una puerta la razón por la que alguien compra el sistema
 * debilitaría el argumento principal.
 *
 * Paso 1 de dos: aquí está la mudanza y la estructura. Lo que de verdad
 * sostiene la propuesta de valor —qué criterios concretos aprendió, la curva de
 * mejora y poder descartar un ejemplo que enseña mal— es el paso 2, y hay que
 * calcularlo: hoy ese dato no existe en ninguna parte.
 */
export default async function AprendizajePage() {
  const { resumen, metricas, criterios } = await getDatosAprendizaje();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <EncabezadoPagina
        titulo="Aprendizaje IA"
        descripcion="El sistema aprende cómo concilia tu empresa. No es un modelo genérico: se calibra con las decisiones que tomas tú."
      />

      {/* La curva va PRIMERO: responde "¿esto funciona?", que es la pregunta
          del que decide si paga. El tamaño del pool responde "¿con qué está
          aprendiendo?", que interesa después. */}
      <CurvaAprendizaje m={metricas} />

      {/* Va arriba del todo cuando aún no hay historial: durante la prueba es
          lo único que la empresa puede hacer para que la IA sepa algo de ella. */}
      <CriteriosIniciales
        seleccionados={criterios}
        decisiones={metricas.revisadas}
      />

      <MotivosRechazo motivos={metricas.motivosRechazo} />

      <PanelAprendizaje ap={resumen} />

      <Tarjeta>
        <h2 className="font-semibold text-neutral-900">Cómo aprende</h2>
        <ol className="mt-3 space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-800"
            >
              1
            </span>
            <span>
              Cada vez que <strong>aceptas, rechazas o corriges</strong> una
              sugerencia, esa decisión se guarda con tu usuario y la fecha. No se
              descarta ninguna.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-800"
            >
              2
            </span>
            <span>
              Al iniciar una conciliación, el sistema elige un puñado de esas
              decisiones —equilibrando aciertos y correcciones— y se las muestra
              a la IA como ejemplos de <em>tu</em> criterio.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-800"
            >
              3
            </span>
            <span>
              Con eso calibra lo que a tu empresa le parece aceptable: cuánta
              comisión bancaria tolera, cuándo un nombre distinto sigue siendo el
              mismo cliente, qué cobros llegan siempre con retraso.
            </span>
          </li>
        </ol>

        {/* Decir qué NO hace evita la decepción del cliente que asume otra cosa
            —y la promesa exagerada del vendedor—. */}
        <p className="mt-4 border-t border-neutral-200 pt-4 text-sm text-neutral-600">
          <strong className="text-neutral-800">Qué no hace:</strong> no reentrena
          ningún modelo ni envía tus datos a entrenar a nadie. El aprendizaje
          vive en tu historial y se usa como contexto en cada corrida. Tus
          decisiones son tuyas y salen de tu base de datos.
        </p>
      </Tarjeta>

      <Tarjeta>
        <h2 className="font-semibold text-neutral-900">Ajustes</h2>
        <p className="mt-1 max-w-prose text-sm text-neutral-600">
          Cuándo la IA puede conciliar sola y cuánta diferencia tolera se
          configuran hoy junto al resto del motor.
        </p>
        <Link
          href="/configuracion"
          className="mt-3 inline-block rounded text-sm font-medium text-blue-700 underline underline-offset-2 transition-colors hover:text-blue-800"
        >
          Ir a la configuración del motor →
        </Link>
      </Tarjeta>
    </div>
  );
}
