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
      <AppNav empresaNombre={empresa.nombre} />
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}
