"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cambiarRol,
  invitarUsuario,
  quitarMiembro,
} from "@/app/(app)/usuarios/actions";
import { DESCRIPCION_ROL, NOMBRE_ROL, ROLES, type Rol } from "@/lib/roles";
import { formatearFecha } from "@/lib/parsing/resumen";
import { Boton, CLASES_ENTRADA, Tarjeta } from "@/components/ui";

export type Miembro = {
  usuarioId: string;
  email: string;
  nombre: string | null;
  rol: Rol;
  ultimoAcceso: string | null;
  sso: boolean;
};

export function UsuariosPanel({ miembros, yo }: { miembros: Miembro[]; yo: string }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enlace, setEnlace] = useState<{ enlace: string; email: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [quitando, setQuitando] = useState<string | null>(null);

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

  function invitar(formData: FormData) {
    setError(null);
    setAviso(null);
    setEnlace(null);
    setCopiado(false);
    startTransition(async () => {
      const r = await invitarUsuario({
        email: String(formData.get("email") ?? ""),
        rol: String(formData.get("rol") ?? "conciliador"),
      });
      if (!r.ok) setError(r.error);
      else {
        setEnlace({ enlace: r.enlace, email: r.email });
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <Tarjeta>
        <form action={invitar}>
          <h2 className="font-semibold text-neutral-900">Invitar a una persona</h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Se crea su acceso y te damos un enlace para que se lo envíes. Al
            abrirlo, elige su contraseña.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            <label className="block text-sm font-medium text-neutral-700">
              Correo
              <input
                name="email"
                type="email"
                required
                placeholder="nombre@empresa.com"
                className={`mt-1.5 ${CLASES_ENTRADA}`}
              />
            </label>
            <label className="block text-sm font-medium text-neutral-700">
              Rol
              <select name="rol" defaultValue="conciliador" className={`mt-1.5 ${CLASES_ENTRADA}`}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {NOMBRE_ROL[r]}
                  </option>
                ))}
              </select>
            </label>
            <Boton type="submit" disabled={pendiente}>
              {pendiente ? "Creando…" : "Crear invitación"}
            </Boton>
          </div>
        </form>

        {enlace && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm text-emerald-900">
              Listo. Envíale este enlace a <span className="font-medium">{enlace.email}</span>.
              Es de un solo uso y caduca: si no llega a usarlo, crea otra invitación.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={enlace.enlace}
                aria-label="Enlace de invitación"
                onFocus={(e) => e.currentTarget.select()}
                className={`min-w-0 flex-1 ${CLASES_ENTRADA} font-mono text-xs`}
              />
              <Boton
                variante="secundario"
                tamano="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(enlace.enlace).then(() => setCopiado(true));
                }}
              >
                {copiado ? "Copiado" : "Copiar"}
              </Boton>
            </div>
          </div>
        )}
      </Tarjeta>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {aviso && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {aviso}
        </p>
      )}

      <section aria-labelledby="h-equipo">
        <h2 id="h-equipo" className="mb-3 text-lg font-semibold text-neutral-900">
          Equipo <span className="tabular-nums text-neutral-500">({miembros.length})</span>
        </h2>
        <ul className="space-y-3">
          {miembros.map((m) => (
            <li
              key={m.usuarioId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-900">
                  {m.nombre ?? m.email}
                  {m.usuarioId === yo && (
                    <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                      Tú
                    </span>
                  )}
                  {m.sso && (
                    <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                      SSO
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-neutral-600">
                  {m.nombre ? `${m.email} · ` : ""}
                  {m.ultimoAcceso
                    ? `último acceso ${formatearFecha(m.ultimoAcceso.slice(0, 10))}`
                    : "aún no ha entrado"}
                </p>
                <p className="mt-1 text-xs text-neutral-500">{DESCRIPCION_ROL[m.rol]}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Rol de ${m.email}`}
                  value={m.rol}
                  disabled={pendiente}
                  onChange={(e) =>
                    correr(
                      () => cambiarRol(m.usuarioId, e.target.value),
                      `Rol de ${m.email} cambiado a ${NOMBRE_ROL[e.target.value as Rol]}.`,
                    )
                  }
                  className={`${CLASES_ENTRADA} w-44`}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {NOMBRE_ROL[r]}
                    </option>
                  ))}
                </select>
                {quitando === m.usuarioId ? (
                  <>
                    <Boton
                      variante="peligro"
                      tamano="sm"
                      disabled={pendiente}
                      onClick={() => {
                        setQuitando(null);
                        correr(() => quitarMiembro(m.usuarioId), `${m.email} ya no tiene acceso a la empresa.`);
                      }}
                    >
                      Confirmar
                    </Boton>
                    <Boton variante="sutil" tamano="sm" onClick={() => setQuitando(null)}>
                      Cancelar
                    </Boton>
                  </>
                ) : (
                  <Boton
                    variante="secundario"
                    tamano="sm"
                    disabled={pendiente}
                    onClick={() => setQuitando(m.usuarioId)}
                  >
                    Quitar
                  </Boton>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-neutral-600">
          Quitar a alguien le retira el acceso a la empresa; sus decisiones pasadas
          siguen firmadas con su nombre.
        </p>
      </section>
    </div>
  );
}
