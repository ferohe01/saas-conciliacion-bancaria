import { AuthShell } from "@/components/auth/AuthShell";
import { RegistroForm } from "@/components/auth/RegistroForm";

export default function RegistroPage() {
  return (
    <AuthShell
      titulo="Crear cuenta"
      subtitulo="Registra tu empresa y empieza a conciliar."
      pie={{
        texto: "¿Ya tienes cuenta?",
        enlaceTexto: "Ingresa",
        href: "/login",
      }}
    >
      <RegistroForm />
    </AuthShell>
  );
}
