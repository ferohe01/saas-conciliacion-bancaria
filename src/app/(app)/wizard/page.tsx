import { createClient } from "@/lib/supabase/server";
import {
  WizardContainer,
  type CuentaOpcion,
} from "@/components/wizard/WizardContainer";

/**
 * Wizard de conciliación (Pasos 1-3). Server component: carga las cuentas de la
 * empresa (con su memoria de mapeos) vía RLS y las pasa al flujo interactivo.
 */
export default async function WizardPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cuentas_bancarias")
    .select("id, banco, numero_enmascarado, moneda, mapeo_columnas")
    .order("created_at", { ascending: true });

  const cuentas = (data ?? []) as CuentaOpcion[];

  return (
    <div className="space-y-6">
      {/* La ruta no tenía ningún h1: el stepper orientaba visualmente, pero un
          lector de pantalla entraba a la página sin título. */}
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Nueva conciliación
        </h1>
        <p className="mt-1 text-neutral-600">
          Tres pasos: cargas tus datos, verificas las columnas y conciliamos.
        </p>
      </div>
      <div className="flex justify-center">
        <WizardContainer cuentas={cuentas} />
      </div>
    </div>
  );
}
