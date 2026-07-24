"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CampoTexto } from "./AuthShell";

export function RegistroForm() {
  const router = useRouter();

  const [nombreEmpresa, setNombreEmpresa] = useState("");
  const [ruc, setRuc] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    // 1) Crear cuenta + empresa + membresía en el servidor.
    const res = await fetch("/api/auth/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre_empresa: nombreEmpresa,
        ruc,
        email,
        password,
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "No se pudo crear la cuenta.");
      setCargando(false);
      return;
    }

    // 2) Iniciar sesión con las credenciales recién creadas.
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // La cuenta se creó; si el login falla, mandar a login manual.
      router.push("/login");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <CampoTexto
        label="Nombre de la empresa"
        type="text"
        required
        value={nombreEmpresa}
        onChange={(e) => setNombreEmpresa(e.target.value)}
        placeholder="Mi Empresa SAC"
      />
      <CampoTexto
        label="RUC (opcional)"
        type="text"
        inputMode="numeric"
        value={ruc}
        onChange={(e) => setRuc(e.target.value)}
        placeholder="20123456789"
      />
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
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Mínimo 8 caracteres"
      />

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={cargando}
        className="h-12 w-full rounded-xl bg-neutral-900 font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        {cargando ? "Creando cuenta…" : "Crear cuenta"}
      </button>
    </form>
  );
}
