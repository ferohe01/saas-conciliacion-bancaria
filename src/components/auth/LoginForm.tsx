"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SSO_ACTIVO, esDominioPublico } from "@/lib/sso";
import { CampoTexto } from "./AuthShell";
import { Boton } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Un enlace de invitación caducado o un SSO fallido vuelven aquí con el
  // motivo en `?error=`: decirlo, en vez de enseñar un login sin explicación.
  const [error, setError] = useState<string | null>(searchParams.get("error"));
  const [cargando, setCargando] = useState(false);

  /**
   * SSO corporativo (SAML). Se usa el dominio del correo para encontrar el
   * proveedor de la empresa; el proveedor de identidad hace el resto y vuelve a
   * /auth/callback.
   */
  async function onSso() {
    setError(null);
    const dominio = email.trim().toLowerCase().split("@")[1];
    if (!dominio) {
      setError("Escribe tu correo corporativo para entrar con el SSO de tu empresa.");
      return;
    }
    // Un correo personal nunca tiene SSO: se dice qué hacer, en vez del
    // «no hay SSO configurado», que invita a pedírselo a un administrador.
    if (esDominioPublico(dominio)) {
      setError(
        `El acceso corporativo (SSO) es para cuentas de empresa. Con un correo personal como @${dominio}, entra con tu contraseña.`,
      );
      return;
    }
    setCargando(true);
    const { data, error: e } = await createClient().auth.signInWithSSO({
      domain: dominio,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (e || !data?.url) {
      setError(
        `No hay acceso corporativo (SSO) configurado para ${dominio}. Entra con tu contraseña o pídele a tu administrador que lo active.`,
      );
      setCargando(false);
      return;
    }
    window.location.href = data.url;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // La contraseña ya no es `required` en el campo, para que el botón de SSO
    // funcione con solo el correo; se comprueba aquí para el acceso normal.
    if (!password) {
      setError(
        SSO_ACTIVO
          ? "Escribe tu contraseña, o entra con el SSO de tu empresa."
          : "Escribe tu contraseña.",
      );
      return;
    }
    setCargando(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError("Correo o contraseña incorrectos.");
      setCargando(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <CampoTexto
        label="Correo electrónico"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tucorreo@empresa.pe"
      />
      <CampoTexto
        label="Contraseña"
        type="password"
        autoComplete="current-password"
        // Obligatoria como siempre; con SSO activo deja de serlo en el campo
        // para que el botón corporativo funcione con solo el correo.
        required={!SSO_ACTIVO}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
      />

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <Boton type="submit" tamano="lg" disabled={cargando} className="w-full">
        {cargando ? "Ingresando…" : "Ingresar"}
      </Boton>
      {/* SSO corporativo: implementado pero desactivado (SSO_ACTIVO en
          src/lib/sso.ts). Se mostrará cuando una empresa grande lo solicite. */}
      {SSO_ACTIVO && (
        <Boton
          type="button"
          variante="secundario"
          tamano="lg"
          disabled={cargando}
          onClick={() => void onSso()}
          className="w-full"
        >
          Ingresar con el SSO de mi empresa
        </Boton>
      )}
    </form>
  );
}
