"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SSO_ACTIVO } from "@/lib/sso";
import { Boton, CLASES_ENTRADA, Tarjeta } from "@/components/ui";

/** Fija la contraseña de quien entró con un enlace de invitación. */
export function FormContrasena() {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function guardar(formData: FormData) {
    const clave = String(formData.get("clave") ?? "");
    const repetida = String(formData.get("repetida") ?? "");
    setError(null);
    if (clave.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (clave !== repetida) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    startTransition(async () => {
      const { error: e } = await createClient().auth.updateUser({ password: clave });
      if (e) {
        setError("No se pudo guardar la contraseña. Vuelve a intentarlo.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <Tarjeta>
      <form action={guardar} className="space-y-4">
        <label className="block text-sm font-medium text-neutral-700">
          Contraseña
          <input name="clave" type="password" autoComplete="new-password" required minLength={8} className={`mt-1.5 ${CLASES_ENTRADA}`} />
        </label>
        <label className="block text-sm font-medium text-neutral-700">
          Repite la contraseña
          <input name="repetida" type="password" autoComplete="new-password" required minLength={8} className={`mt-1.5 ${CLASES_ENTRADA}`} />
        </label>
        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
            {error}
          </p>
        )}
        <Boton type="submit" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar y entrar"}
        </Boton>
        {SSO_ACTIVO && (
          <p className="text-xs text-neutral-500">
            Si tu empresa entra con su cuenta corporativa (SSO), puedes saltarte este paso.
          </p>
        )}
      </form>
    </Tarjeta>
  );
}
