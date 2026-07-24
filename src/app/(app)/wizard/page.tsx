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
    <div className="flex justify-center">
      <WizardContainer cuentas={cuentas} />
    </div>
  );
}
