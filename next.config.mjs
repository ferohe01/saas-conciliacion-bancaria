/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Servidor autocontenido para la imagen Docker (despliegue en Dokploy).
  output: "standalone",
};

export default nextConfig;
