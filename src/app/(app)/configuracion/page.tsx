import { getConfigEmpresa } from "@/lib/config";
import { ConfiguracionForm } from "@/components/app/ConfiguracionForm";
import { EncabezadoPagina } from "@/components/ui";

export default async function ConfiguracionPage() {
  const config = await getConfigEmpresa();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <EncabezadoPagina
        titulo="Cómo quieres que concilie"
        descripcion="Cuánta diferencia toleras y cuándo la IA puede decidir sola. Se aplica a las próximas conciliaciones."
      />
      <ConfiguracionForm config={config} />
    </div>
  );
}
