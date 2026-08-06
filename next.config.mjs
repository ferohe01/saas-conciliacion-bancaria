/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Servidor autocontenido para la imagen Docker (despliegue en Dokploy).
  output: "standalone",
  experimental: {
    // ⚠️ Las server actions traen 1 MB de límite por defecto, y la importación
    // de comprobantes manda hasta 5.000 filas de golpe: eso ronda justo ese
    // tamaño y falla con una "server-side exception" que no dice cuál es la
    // causa. Con 4 MB caben las 5.000 con margen.
    //
    // NO es la solución para archivos grandes de verdad: subir este número
    // indefinidamente es cargarse el servidor. Lo que toca a partir de aquí es
    // la ingesta en servidor por lotes (ver el plan de volumen).
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
