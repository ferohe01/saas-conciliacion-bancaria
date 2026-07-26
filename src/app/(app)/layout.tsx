import { redirect } from "next/navigation";
import { AppNav } from "@/components/app/AppNav";
import { getEmpresaActual } from "@/lib/auth";

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

  return (
    <div className="min-h-screen bg-neutral-100">
      <a
        href="#contenido"
        className="ci-skip rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Saltar al contenido
      </a>
      <AppNav empresaNombre={empresa.nombre} />
      <main id="contenido" className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
