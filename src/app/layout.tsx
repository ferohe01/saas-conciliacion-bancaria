import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conciliación Bancaria",
  description:
    "Conciliación bancaria asistida por IA para PyMEs peruanas.",
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
