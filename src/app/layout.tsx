import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Conciliaciones Inteligentes",
    template: "%s · Conciliaciones Inteligentes",
  },
  // Sale en Google y en la vista previa al compartir el enlace, así que pesa
  // tanto como la portada para decidir a quién se dirige el producto.
  description:
    "Conciliación bancaria asistida por IA para empresas peruanas: desde decenas hasta cientos de miles de movimientos al mes.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-PE">
      <body>{children}</body>
    </html>
  );
}
