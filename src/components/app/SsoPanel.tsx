"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quitarSso, registrarSso } from "@/app/(app)/usuarios/sso-actions";
import { NOMBRE_ROL, ROLES, type Rol } from "@/lib/roles";
import { Boton, CLASES_ENTRADA, Tarjeta } from "@/components/ui";

export type ProveedorVista = { id: string; dominio: string; rol: Rol };

/**
 * SSO corporativo (SAML). El administrador da de alta la aplicación en su
 * proveedor de identidad con los datos de arriba, y aquí pega la URL de
 * metadatos que ese proveedor le devuelve.
 */
export function SsoPanel({
  proveedores,
  datos,
}: {
  proveedores: ProveedorVista[];
  datos: { entityId: string; acsUrl: string; metadataUrl: string };
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function correr(fn: () => Promise<{ ok: boolean; error?: string }>, exito: string) {
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "No se pudo completar la acción.");
      else {
        setAviso(exito);
        router.refresh();
      }
    });
  }

  const fila = (etiqueta: string, valor: string) => (
    <div>
      <dt className="text-xs font-medium text-neutral-600">{etiqueta}</dt>
      <dd className="mt-0.5 break-all font-mono text-xs text-neutral-800">{valor}</dd>
    </div>
  );

  return (
    <Tarjeta>
      <h2 className="font-semibold text-neutral-900">Acceso corporativo (SSO)</h2>
      <p className="mt-0.5 text-sm text-neutral-600">
        Tu equipo entra con su cuenta de la empresa (Microsoft Entra ID, Okta,
        Google Workspace u otro proveedor SAML). Quien entra por primera vez se
        da de alta solo, con el rol que elijas.
      </p>

      <details className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-neutral-800">
          1. Datos para tu proveedor de identidad
        </summary>
        <p className="mt-2 text-sm text-neutral-600">
          Crea una aplicación SAML en tu proveedor con estos datos. Usa el correo
          del usuario como identificador (NameID).
        </p>
        <dl className="mt-3 space-y-2">
          {fila("Identificador (Entity ID)", datos.entityId)}
          {fila("URL de respuesta (ACS)", datos.acsUrl)}
          {fila("Metadatos de esta aplicación", datos.metadataUrl)}
        </dl>
      </details>

      <form
        className="mt-4"
        action={(fd) =>
          correr(
            () =>
              registrarSso({
                dominio: String(fd.get("dominio") ?? ""),
                metadataUrl: String(fd.get("metadataUrl") ?? ""),
                rol: String(fd.get("rol") ?? "consulta"),
              }),
            "Proveedor registrado. Tu equipo ya puede entrar con «Ingresar con el SSO de mi empresa».",
          )
        }
      >
        <p className="text-sm font-medium text-neutral-800">2. Registra tu proveedor</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-neutral-700">
            Dominio de correo
            <input name="dominio" required placeholder="empresa.com.pe" className={`mt-1.5 ${CLASES_ENTRADA}`} />
          </label>
          <label className="block text-sm font-medium text-neutral-700">
            Rol de quien entra por primera vez
            <select name="rol" defaultValue="consulta" className={`mt-1.5 ${CLASES_ENTRADA}`}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {NOMBRE_ROL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-neutral-700 sm:col-span-2">
            URL de metadatos SAML de tu proveedor
            <input
              name="metadataUrl"
              type="url"
              required
              placeholder="https://login.microsoftonline.com/…/federationmetadata.xml"
              className={`mt-1.5 ${CLASES_ENTRADA}`}
            />
          </label>
        </div>
        <Boton type="submit" className="mt-3" disabled={pendiente}>
          {pendiente ? "Registrando…" : "Registrar proveedor"}
        </Boton>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {error}
        </p>
      )}
      {aviso && (
        <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {aviso}
        </p>
      )}

      {proveedores.length > 0 && (
        <ul className="mt-4 space-y-2">
          {proveedores.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 px-4 py-3"
            >
              <span className="text-sm text-neutral-800">
                <span className="font-medium">@{p.dominio}</span> · entran como{" "}
                {NOMBRE_ROL[p.rol]}
              </span>
              <Boton
                variante="secundario"
                tamano="sm"
                disabled={pendiente}
                onClick={() => correr(() => quitarSso(p.id), `SSO de @${p.dominio} desactivado.`)}
              >
                Quitar
              </Boton>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
