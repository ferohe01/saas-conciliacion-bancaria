import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";
import { estadoSuscripcion } from "@/lib/suscripcion";
import { asistenteDisponible } from "@/lib/ia/cliente";
import { getConexionErp } from "@/lib/conexiones-servidor";
import { nombreSistema, estadoConexion } from "@/lib/conexiones";
import { PruebaVencida } from "@/components/app/AvisoPrueba";
import { clasesBoton } from "@/components/ui";
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
  const empresa = await getEmpresaActual();
  const suscripcion = estadoSuscripcion(empresa ?? {});

  // Prueba vencida: no se carga el wizard. El endpoint lo rechazaría igual
  // (route.ts), pero dejar entrar al flujo para fallar al final sería cruel:
  // el usuario habría subido y mapeado sus archivos para nada.
  if (!suscripcion.puedeConciliar) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Nueva conciliación
          </h1>
        </div>
        <PruebaVencida />
        <p className="text-center text-sm text-neutral-600">
          Mientras tanto,{" "}
          <Link
            href="/conciliacion"
            className="rounded font-medium text-blue-700 underline underline-offset-2 transition-colors hover:text-blue-800"
          >
            revisa tus conciliaciones anteriores
          </Link>{" "}
          o{" "}
          <Link
            href="/reportes"
            className="rounded font-medium text-blue-700 underline underline-offset-2 transition-colors hover:text-blue-800"
          >
            consulta tus reportes
          </Link>
          .
        </p>
        <div className="text-center">
          <Link href="/dashboard" className={clasesBoton("secundario", "md")}>
            Volver al panel
          </Link>
        </div>
      </div>
    );
  }

  const [{ data }, conexion] = await Promise.all([
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, numero_enmascarado, moneda, mapeo_columnas")
      .order("created_at", { ascending: true }),
    getConexionErp(),
  ]);

  const cuentas = (data ?? []) as CuentaOpcion[];

  // El wizard solo necesita saber qué contar bajo la opción "Conectar sistema";
  // los datos de la conexión se administran en /conexiones.
  const resumenConexion = conexion
    ? {
        sistema: nombreSistema(conexion),
        estadoLabel: estadoConexion(conexion.estado).label,
      }
    : null;

  return (
    <div className="space-y-6">
      {/* La ruta no tenía ningún h1: el stepper orientaba visualmente, pero un
          lector de pantalla entraba a la página sin título. */}
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Nueva conciliación
        </h1>
        <p className="mt-1 text-neutral-600">
          Tres pasos: cargas tus datos, verificas las columnas y conciliamos.
        </p>
      </div>
      <div className="flex justify-center">
        <WizardContainer
          cuentas={cuentas}
          conexion={resumenConexion}
          asistente={asistenteDisponible()}
          mapeoConfigurado={empresa?.mapeo_comprobantes != null}
        />
      </div>
    </div>
  );
}
