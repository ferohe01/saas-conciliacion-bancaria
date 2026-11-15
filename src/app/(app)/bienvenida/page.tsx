import { getEmpresaActual } from "@/lib/auth";
import { NOMBRE_ROL, rolDe } from "@/lib/roles";
import { EncabezadoPagina } from "@/components/ui";
import { FormContrasena } from "@/components/app/FormContrasena";

/**
 * Adonde llega quien abre un enlace de invitación (/auth/confirmar ya dejó la
 * sesión iniciada). Elige su contraseña para las próximas veces.
 */
export default async function BienvenidaPage() {
  const empresa = await getEmpresaActual();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <EncabezadoPagina
        titulo={`Bienvenido${empresa ? ` a ${empresa.nombre}` : ""}`}
        descripcion={
          empresa
            ? `Tu rol es ${NOMBRE_ROL[rolDe(empresa.rol)]}. Elige una contraseña para entrar las próximas veces.`
            : "Elige una contraseña para entrar las próximas veces."
        }
      />
      <FormContrasena />
    </div>
  );
}
