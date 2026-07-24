import { createClient } from "@/lib/supabase/server";
import { CuentaForm } from "@/components/app/CuentaForm";
import { CuentaItem, type Cuenta } from "@/components/app/CuentaItem";

export default async function CuentasPage() {
  const supabase = await createClient();
  const { data: cuentas } = await supabase
    .from("cuentas_bancarias")
    .select("id, banco, numero_enmascarado, moneda")
    .order("created_at", { ascending: true });

  const lista = (cuentas ?? []) as Cuenta[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Cuentas bancarias
        </h1>
        <p className="mt-1 text-neutral-500">
          Registra las cuentas que vas a conciliar.
        </p>
      </div>

      <CuentaForm />

      {lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
          Aún no tienes cuentas registradas.
        </p>
      ) : (
        <ul className="space-y-3">
          {lista.map((c) => (
            <CuentaItem key={c.id} cuenta={c} />
          ))}
        </ul>
      )}
    </div>
  );
}
