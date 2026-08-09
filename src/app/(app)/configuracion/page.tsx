import { getConfigEmpresa } from "@/lib/config";
import { getSuscripcionesModulo, getAccesoCuenta } from "@/lib/modulos-servidor";
import { ConfiguracionForm } from "@/components/app/ConfiguracionForm";
import { PanelModulos } from "@/components/app/PanelModulos";
import { EncabezadoPagina } from "@/components/ui";

export default async function ConfiguracionPage() {
  const [config, suscripciones, cuenta] = await Promise.all([
    getConfigEmpresa(),
    getSuscripcionesModulo(),
    getAccesoCuenta(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <EncabezadoPagina
        titulo="Cómo quieres que concilie"
        descripcion="Cuánta diferencia toleras y cuándo la IA puede decidir sola. Se aplica a las próximas conciliaciones."
      />
      <ConfiguracionForm config={config} />
      <PanelModulos suscripciones={suscripciones} cuenta={cuenta} />
    </div>
  );
}
