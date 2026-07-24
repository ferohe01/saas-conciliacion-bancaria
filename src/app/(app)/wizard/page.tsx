import { createClient } from "@/lib/supabase/server";
import { WizardPaso1, type CuentaOpcion } from "@/components/wizard/WizardPaso1";

/**
 * Wizard de conciliación — Paso 1 (Cargar datos). Server component: carga las
 * cuentas de la empresa (vía RLS) y las pasa al componente interactivo.
 */
export default async function WizardPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cuentas_bancarias")
    .select("id, banco, numero_enmascarado, moneda")
    .order("created_at", { ascending: true });

  const cuentas = (data ?? []) as CuentaOpcion[];

  return (
    <div className="flex justify-center">
      <WizardPaso1 cuentas={cuentas} />
    </div>
  );
}
