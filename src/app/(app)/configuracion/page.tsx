import { getConfigEmpresa } from "@/lib/config";
import { getSuscripcionesModulo, getAccesoCuenta } from "@/lib/modulos-servidor";
import { ConfiguracionForm } from "@/components/app/ConfiguracionForm";
import { PanelModulos } from "@/components/app/PanelModulos";
import { PanelModoCarga } from "@/components/app/PanelModoCarga";
import { getEmpresaActual } from "@/lib/auth";
import { modoCarga } from "@/lib/modoCarga";
import { EncabezadoPagina } from "@/components/ui";

export default async function ConfiguracionPage() {
  const [config, suscripciones, cuenta, empresa] = await Promise.all([
    getConfigEmpresa(),
    getSuscripcionesModulo(),
    getAccesoCuenta(),
    getEmpresaActual(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <EncabezadoPagina
        titulo="Cómo quieres que concilie"
        descripcion="Cuánta diferencia toleras y cuándo la IA puede decidir sola. Se aplica a las próximas conciliaciones."
      />
      <ConfiguracionForm config={config} />
      <PanelModoCarga actual={modoCarga(empresa?.modo_carga)} />
      <PanelModulos suscripciones={suscripciones} cuenta={cuenta} />
    </div>
  );
}
