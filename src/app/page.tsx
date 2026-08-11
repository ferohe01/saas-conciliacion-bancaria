import Link from "next/link";
import { Marca, NOMBRE_MARCA } from "@/components/ui/Marca";
import { ERPS_PORTADA } from "@/lib/conexiones";

/*
 * HOME — "Conciliación en vivo" (Persuade)
 *
 * THESIS: probar el producto mostrando una conciliación real cuadrando en el
 *   primer viewport; se niega al scaffold "titular + tarjetas de features".
 * OWN-WORLD: azul marca como campo comprometido (media página en desktop),
 *   workspace blanco, verde esmeralda SOLO como semántica de "conciliado/cuadra",
 *   números tabulares, el par ledger Tus registros ↔ Tu banco.
 * STORY: una empresa —o su contador— ve sus ventas emparejadas al banco por IA,
 *   con confianza y "Cuadre S/ 0.00 ✓" → entiende que concilia por ella y crea
 *   cuenta. Sirve igual a quien mueve 50 comprobantes al mes que a quien mueve
 *   cientos de miles, y la página lo dice en vez de dejarlo a la fe.
 * FIRST VIEWPORT: izq. marca + H1 + subtítulo + CTAs; der. panel de conciliación.
 * FORM: hero dividido, producto-como-héroe. Datos del panel: ilustrativos.
 */

type Par = {
  registro: string;
  banco: string;
  monto: string;
  metodo: "Exacta" | "IA 96%" | "Difusa";
};

const PARES: Par[] = [
  { registro: "Venta 012", banco: "ABONO YAPE", monto: "450.00", metodo: "Exacta" },
  { registro: "Venta 013", banco: "TRANSF. INTERB.", monto: "120.00", metodo: "IA 96%" },
  { registro: "Servicio 007", banco: "DEPÓSITO EFECT.", monto: "890.00", metodo: "Difusa" },
];

const METODO_ESTILO: Record<Par["metodo"], string> = {
  Exacta: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  "IA 96%": "bg-violet-50 text-violet-800 ring-violet-200",
  Difusa: "bg-blue-50 text-blue-800 ring-blue-200",
};

const PASOS = [
  {
    titulo: "Sube tus datos",
    // Los dos caminos de carga son el diferenciador real entre segmentos —la
    // plantilla para quien no tiene sistema, su propio archivo para quien
    // exporta de un ERP— y ya están construidos (0039/0040). Nombrarlos aquí es
    // lo que hace creíble que sirva a una empresa de cualquier tamaño.
    texto:
      "Tus comprobantes y el extracto del banco. Usa nuestra plantilla o sube el archivo que exporte tu sistema, con las columnas que tenga.",
  },
  {
    titulo: "La IA concilia",
    texto: "Empareja movimientos y explica cada diferencia: comisiones, pagos parciales, agrupaciones.",
  },
  {
    titulo: "Revisa y exporta",
    texto: "Aceptas o ajustas las sugerencias y descargas el cuadre listo en Excel.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-clip bg-neutral-50 text-neutral-900">
      <a
        href="#como-funciona"
        className="ci-skip rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Saltar al contenido
      </a>

      {/* Barra superior */}
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <Marca className="text-[15px] text-neutral-900" compacta />
        <nav aria-label="Acceso" className="flex items-center gap-2 text-sm">
          <Link
            href="/login"
            className="rounded-lg px-3 py-2 font-medium text-neutral-700 transition-colors hover:text-neutral-900"
          >
            Ingresar
          </Link>
          <Link
            href="/registro"
            className="rounded-lg bg-neutral-900 px-3.5 py-2 font-medium text-white transition-colors hover:bg-neutral-800"
          >
            Crear cuenta
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-8 pb-20 lg:grid-cols-[1.02fr_1fr] lg:gap-16 lg:pt-16">
          {/* Columna de mensaje */}
          <div className="ci-rise">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Para empresas peruanas de cualquier tamaño
            </span>

            <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-[-0.03em] text-balance text-neutral-900 sm:text-5xl lg:text-6xl">
              {NOMBRE_MARCA}
            </h1>

            <p className="mt-4 max-w-md text-lg leading-relaxed text-neutral-600">
              Conciliación bancaria asistida por IA para empresas peruanas.
            </p>

            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-neutral-500">
              Sube tus ventas y el extracto del banco. La IA empareja, detecta las
              diferencias y te deja el cuadre listo para revisar — en minutos, no en
              días.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/registro"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 font-semibold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700"
              >
                Crear cuenta
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <Link
                href="#como-funciona"
                className="inline-flex items-center rounded-xl border border-neutral-300 bg-white px-6 py-3.5 font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
              >
                Ver cómo funciona
              </Link>
            </div>

            {/* "Cualquier tamaño" es una afirmación, y sin nada que la sostenga
                suena a eslogan. Estas tres líneas la prueban con lo que el
                sistema hace de verdad —los bancos, los sistemas y la escala—
                sin nombrar a ningún cliente ni citar sus cifras, que son suyas.

                ⚠️ La de los sistemas dice "con el archivo que exporte", NO "nos
                conectamos con tu ERP": hoy no hay ninguna sincronización
                construida, y la portada es el peor sitio para prometerla. */}
            <ul className="mt-6 space-y-2 text-sm text-neutral-500">
              {[
                "Funciona con el extracto de cualquier banco en Excel, CSV o PDF.",
                `Con el archivo que exporte tu sistema —${ERPS_PORTADA.join(", ")} o el que uses—, con las columnas que traiga.`,
                "Desde unas decenas de comprobantes al mes hasta cientos de miles.",
              ].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Columna de prueba: panel de conciliación en vivo */}
          <div className="relative">
            {/* Campo azul comprometido detrás del panel */}
            <div
              aria-hidden
              className="absolute -inset-x-6 -inset-y-8 rounded-[2rem] bg-gradient-to-br from-blue-600 to-blue-800 sm:-inset-x-10 lg:-inset-x-8"
              style={{
                backgroundImage:
                  "linear-gradient(to bottom right, #2563eb, #1e40af), repeating-linear-gradient(0deg, rgba(255,255,255,.06) 0 1px, transparent 1px 28px)",
              }}
            />
            <PanelConciliacion />
          </div>
        </section>

        {/* Cómo funciona */}
        <section
          id="como-funciona"
          className="scroll-mt-8 border-t border-neutral-200 bg-white"
        >
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="max-w-xl">
              <h2 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
                Tres pasos y tu conciliación queda lista
              </h2>
              <p className="mt-2 text-neutral-500">
                Tú controlas cada decisión; la IA hace el trabajo repetitivo.
              </p>
            </div>

            <ol className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-3">
              {PASOS.map((p, i) => (
                <li key={p.titulo} className="relative">
                  {i < PASOS.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute left-9 top-4 hidden h-px w-[calc(100%-1rem)] bg-neutral-200 sm:block"
                    />
                  )}
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                      {i + 1}
                    </span>
                    <h3 className="font-semibold text-neutral-900">{p.titulo}</h3>
                  </div>
                  <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">
                    {p.texto}
                  </p>
                </li>
              ))}
            </ol>

            <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-neutral-200 pt-8">
              <p className="text-neutral-700">
                <span className="font-semibold text-neutral-900">
                  ¿Listo para dejar de conciliar a mano?
                </span>{" "}
                Empieza con tu primer período gratis.
              </p>
              <Link
                href="/registro"
                className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-neutral-800"
              >
                Crear cuenta
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-neutral-50">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-8 sm:flex-row sm:items-center">
          <Marca className="text-sm text-neutral-800" />
          <p className="text-sm text-neutral-600">
            Hecho en Perú · {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}

function PanelConciliacion() {
  return (
    <div className="ci-pop relative rounded-2xl bg-white p-5 shadow-heroe ring-1 ring-black/5 sm:p-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-medium text-neutral-500">Conciliación</p>
          <p className="text-sm font-semibold text-neutral-900">Julio 2026 · BCP</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          Automático
        </span>
      </div>

      {/* Etiquetas de columnas */}
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        <span>Tus registros</span>
        <span className="px-1" aria-hidden>
          ↔
        </span>
        <span className="text-right">Tu banco</span>
      </div>

      {/* Pares emparejados */}
      <ul className="mt-2 space-y-2">
        {PARES.map((p, i) => (
          <li
            key={p.registro}
            className="ci-rise grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl bg-neutral-50 p-2.5 ring-1 ring-neutral-100"
            style={{ animationDelay: `${0.15 + i * 0.12}s` }}
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-neutral-800">
                {p.registro}
              </p>
              <p className="text-[13px] tabular-nums text-neutral-500">
                S/ {p.monto}
              </p>
            </div>
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white shadow-sm"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <div className="min-w-0 text-right">
              <p className="truncate text-[13px] font-medium text-neutral-800">
                {p.banco}
              </p>
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-[13px] tabular-nums text-neutral-500">
                  S/ {p.monto}
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${METODO_ESTILO[p.metodo]}`}
                >
                  {p.metodo}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Cuadre */}
      <div
        className="ci-pop mt-4 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200"
        style={{ animationDelay: "0.6s" }}
      >
        <span className="text-sm font-medium text-emerald-800">Cuadre</span>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <span className="tabular-nums">S/ 0.00</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2 py-0.5 text-xs text-white">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Conciliado
          </span>
        </span>
      </div>
    </div>
  );
}
