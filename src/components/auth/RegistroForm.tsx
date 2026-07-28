"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CampoTexto, CampoSelect } from "./AuthShell";
import { Boton } from "@/components/ui";
import { REGIONES } from "@/lib/peru";
import { DIAS_PRUEBA } from "@/lib/suscripcion";

/**
 * Alta de cuenta. El formulario creció a dos bloques —empresa y administrador—
 * porque nueve campos seguidos sin agrupar se leen como un trámite. Cada bloque
 * es un <fieldset> real, no un div con un título: es lo que hace que un lector
 * de pantalla anuncie "Datos de la empresa, campo 3 de 5".
 *
 * El correo del administrador ES el usuario con el que inicia sesión; se dice
 * en el propio campo para que nadie ponga el correo de facturación.
 */
export function RegistroForm() {
  const router = useRouter();

  const [empresa, setEmpresa] = useState({
    nombre: "",
    ruc: "",
    region: "",
    provincia: "",
    direccion: "",
    telefono: "",
  });
  const [admin, setAdmin] = useState({
    nombre: "",
    email: "",
    telefono: "",
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const campoEmpresa =
    (k: keyof typeof empresa) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setEmpresa((v) => ({ ...v, [k]: e.target.value }));
  const campoAdmin =
    (k: keyof typeof admin) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setAdmin((v) => ({ ...v, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    const res = await fetch("/api/auth/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre_empresa: empresa.nombre,
        ruc: empresa.ruc,
        region: empresa.region,
        provincia: empresa.provincia,
        direccion: empresa.direccion,
        telefono_empresa: empresa.telefono,
        admin_nombre: admin.nombre,
        admin_telefono: admin.telefono,
        email: admin.email,
        password,
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "No se pudo crear la cuenta.");
      setCargando(false);
      return;
    }

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: admin.email,
      password,
    });

    if (signInError) {
      // La cuenta se creó; si el login falla, al login manual.
      router.push("/login");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* El plazo va ARRIBA, antes de pedir nueve datos: quien va a rellenar un
          formulario largo merece saber qué obtiene antes de empezar, no al
          final. El número sale de DIAS_PRUEBA, la misma constante que aplica
          el bloqueo — no puede desincronizarse de lo que hace el sistema. */}
      <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
        <strong className="font-semibold text-neutral-900">
          {DIAS_PRUEBA} días de prueba gratis.
        </strong>{" "}
        Sin tarjeta de crédito: creas tu cuenta y empiezas a conciliar hoy
        mismo.
      </p>

      {/* Dos columnas desde md: empresa a la izquierda, administrador a la
          derecha. En móvil se apilan y el separador pasa de vertical a
          horizontal. */}
      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold text-neutral-900">
            Datos de la empresa
          </legend>

          <CampoTexto
            label="Razón social"
            name="nombre_empresa"
            type="text"
            required
            value={empresa.nombre}
            onChange={campoEmpresa("nombre")}
            placeholder="Mi Empresa SAC"
          />
          <CampoTexto
            label="RUC"
            name="ruc"
            type="text"
            inputMode="numeric"
            required
            pattern="\d{11}"
            title="El RUC tiene 11 dígitos"
            value={empresa.ruc}
            onChange={campoEmpresa("ruc")}
            placeholder="20123456789"
            ayuda="11 dígitos."
          />
          <CampoSelect
            label="Región"
            name="region"
            required
            opciones={REGIONES}
            placeholder="Selecciona…"
            value={empresa.region}
            onChange={campoEmpresa("region")}
          />
          <CampoTexto
            label="Provincia"
            name="provincia"
            type="text"
            required
            value={empresa.provincia}
            onChange={campoEmpresa("provincia")}
            placeholder="Lima"
          />
          <CampoTexto
            label="Dirección"
            name="direccion"
            type="text"
            required
            value={empresa.direccion}
            onChange={campoEmpresa("direccion")}
            placeholder="Av. Ejemplo 123, Of. 401"
          />
          <CampoTexto
            label="Teléfono de la empresa"
            name="telefono_empresa"
            type="tel"
            required
            value={empresa.telefono}
            onChange={campoEmpresa("telefono")}
            placeholder="01 234 5678"
          />
        </fieldset>

        <fieldset className="space-y-4 border-t border-neutral-200 pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8">
          <legend className="mb-1 text-sm font-semibold text-neutral-900">
            Administrador de la cuenta
          </legend>

          <CampoTexto
            label="Nombre completo"
            name="admin_nombre"
            type="text"
            autoComplete="name"
            required
            value={admin.nombre}
            onChange={campoAdmin("nombre")}
            placeholder="Ana Pérez Ramos"
          />
          <CampoTexto
            label="Correo electrónico"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={admin.email}
            onChange={campoAdmin("email")}
            placeholder="ana.perez@empresa.pe"
            ayuda="Con este correo iniciarás sesión."
          />
          <CampoTexto
            label="Teléfono"
            name="admin_telefono"
            type="tel"
            autoComplete="tel"
            required
            value={admin.telefono}
            onChange={campoAdmin("telefono")}
            placeholder="987 654 321"
          />
          <CampoTexto
            label="Contraseña"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            ayuda="Mínimo 8 caracteres."
          />
        </fieldset>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <Boton type="submit" tamano="lg" disabled={cargando} className="w-full">
        {cargando ? "Creando cuenta…" : "Crear cuenta"}
      </Boton>
    </form>
  );
}
