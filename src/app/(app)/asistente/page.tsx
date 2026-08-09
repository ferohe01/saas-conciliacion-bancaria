import { asistenteDisponible } from "@/lib/ia/cliente";
import { ChatApp } from "@/components/ia/ChatApp";
import { EncabezadoPagina } from "@/components/ui";

/**
 * El asistente general.
 *
 * ⚠️ Convive con los dos acotados (Paso 3 y «¿Por qué?» de una partida) y no
 * los sustituye: aquellos explican algo que ya está calculado en pantalla, y
 * este consulta. Son garantías distintas — allí la respuesta va debajo de un
 * análisis que la respalda; aquí es lo único que se ve, y por eso el modelo no
 * puede responder de memoria: si no lo consultó, no lo sabe.
 */
export default async function AsistentePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <EncabezadoPagina
        titulo="Asistente"
        descripcion="Pregunta por tus cobros, tus pagos y tus conciliaciones. Consulta tus datos reales; no inventa cifras y no hace cambios."
      />
      <ChatApp disponible={asistenteDisponible()} />
    </div>
  );
}
