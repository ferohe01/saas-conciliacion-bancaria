import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <AuthShell
      titulo="Ingresar"
      subtitulo="Accede a tu cuenta para conciliar."
      pie={{
        texto: "¿No tienes cuenta?",
        enlaceTexto: "Crea una",
        href: "/registro",
      }}
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
