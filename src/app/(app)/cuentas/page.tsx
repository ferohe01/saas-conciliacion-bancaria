import { createClient } from "@/lib/supabase/server";
import { CuentaForm } from "@/components/app/CuentaForm";
import { CuentaItem, type Cuenta } from "@/components/app/CuentaItem";
import { BancoIcon } from "@/components/wizard/icons";
import { EncabezadoPagina, EstadoVacio } from "@/components/ui";

export default async function CuentasPage() {
  const supabase = await createClient();
  const { data: cuentas } = await supabase
    .from("cuentas_bancarias")
    .select("id, banco, numero_enmascarado, moneda")
    .order("created_at", { ascending: true });

  const lista = (cuentas ?? []) as Cuenta[];

  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Cuentas bancarias"
        descripcion="Cada cuenta recuerda el formato de columnas de su banco, para que no vuelvas a mapearlo."
      />

      <CuentaForm />

      {lista.length === 0 ? (
        <EstadoVacio
          icono={<BancoIcon className="h-6 w-6" />}
          titulo="Sin cuentas registradas"
          texto="Agrega arriba la cuenta cuyo extracto vas a conciliar. Puedes tener varias: una por banco o por moneda."
        />
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
