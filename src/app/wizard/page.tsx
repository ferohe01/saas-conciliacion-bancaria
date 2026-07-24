import { Paso1CargarDatos } from "@/components/wizard/Paso1CargarDatos";

/**
 * Prototipo visual del wizard (Paso 1). Ruta temporal para validar el diseño;
 * en la Fase 3 pasa a ser el flujo real con datos de Supabase.
 */
export default function WizardPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 py-10">
      <Paso1CargarDatos />
    </main>
  );
}
