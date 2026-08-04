import { getConexionErp } from "@/lib/conexiones-servidor";
import { ConexionForm } from "@/components/app/ConexionForm";
import { EncabezadoPagina } from "@/components/ui";

/**
 * "Conectar sistema" — la pantalla existe antes que el motor.
 *
 * La sincronización con el sistema de facturación del cliente todavía no está
 * construida. La pantalla se publica igualmente porque sirve para dos cosas
 * reales: recoger qué sistema usa cada empresa (que es lo que decidirá por
 * dónde empezar a integrar) y validar el flujo con usuarios. Lo que NO hace es
 * fingir: en ningún momento dice que algo se esté trayendo.
 */
export default async function ConexionesPage() {
  const conexion = await getConexionErp();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <EncabezadoPagina
        titulo="Conectar tu sistema"
        descripcion="Para que tus comprobantes lleguen solos desde donde los emites, sin plantillas ni cargas manuales."
      />
      <ConexionForm conexion={conexion} />
    </div>
  );
}
