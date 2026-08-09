import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app/AppSidebar";
import { ScrollAlInicio } from "@/components/app/ScrollAlInicio";
import { getEmpresaActual } from "@/lib/auth";
import { estadoSuscripcion } from "@/lib/suscripcion";
import { getSuscripcionesModulo, getAccesoCuenta } from "@/lib/modulos-servidor";
import { MODULOS, tieneModulo } from "@/lib/modulos";

/**
 * Layout del área autenticada. El middleware ya protege estas rutas; aquí se
 * añade una segunda barrera y se obtiene la empresa para la navegación.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let empresa = null;
  try {
    empresa = await getEmpresaActual();
  } catch {
    // Supabase no configurado o sesión inválida → al login.
    redirect("/login");
  }

  if (!empresa) redirect("/login");

  // Módulos a la vista. Con la cuenta al día —de pago o en prueba— salen
  // TODOS: el sistema se vende entero (ver `estadoModulo`). Cada pantalla
  // vuelve a comprobarlo por su cuenta —esto orienta, no protege.
  const [suscripciones, cuenta] = await Promise.all([
    getSuscripcionesModulo(),
    getAccesoCuenta(),
  ]);
  const ahora = new Date();
  const modulosActivos = MODULOS.filter((m) =>
    tieneModulo(m.id, suscripciones, ahora, cuenta),
  ).map((m) => m.id as string);

  return (
    <div className="min-h-screen bg-neutral-100">
      <a
        href="#contenido"
        className="ci-skip rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Saltar al contenido
      </a>
      <ScrollAlInicio />
      <AppSidebar
        empresaNombre={empresa.nombre}
        puedeConciliar={estadoSuscripcion(empresa).puedeConciliar}
        modulos={modulosActivos}
      />
      {/* La guarda es fija a partir de lg; el lienzo se desplaza para no quedar
          debajo. Cada pantalla fija su propio ancho por tarea dentro de él. */}
      <div className="lg:pl-64">
        <main
          id="contenido"
          className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
