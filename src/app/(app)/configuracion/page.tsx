import { getConfigEmpresa } from "@/lib/config";
import { ConfiguracionForm } from "@/components/app/ConfiguracionForm";

export default async function ConfiguracionPage() {
  const config = await getConfigEmpresa();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Configuración de conciliación
        </h1>
        <p className="mt-1 text-neutral-500">
          Ajusta las tolerancias que se envían al motor en cada conciliación.
          Aplican a las próximas corridas.
        </p>
      </div>

      <ConfiguracionForm config={config} />
    </div>
  );
}
