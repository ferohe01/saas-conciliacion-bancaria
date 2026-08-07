import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

/**
 * ⚠️ Las rutas que reciben CUERPOS GRANDES quedan fuera del matcher.
 *
 * Cuando hay middleware, Next **clona** el cuerpo de la petición para dárselo
 * (`getCloneableBody` → `cloneBodyStream` en `next/dist/server/body-streams.js`).
 * Ese clonado tiene un tope de 10 MB —`DEFAULT_BODY_CLONE_SIZE_LIMIT`— y al
 * pasarse **deja de reenviar bytes en silencio**: no lanza, no responde 413,
 * entrega un cuerpo TRUNCADO. El handler recibe JSON cortado y lo único que se
 * ve es "JSON inválido", que apunta al sitio equivocado.
 *
 * No es configurable: `serverActions.bodySizeLimit` no alimenta ese `sizeLimit`
 * (con 4 MB ahí, 9 MB pasaban y 10 MB no). La única palanca es no clonar.
 *
 * Costó un día de depuración con el corte de 36.000 partidas (payload de
 * 13,3 MB). Y lo más caro no era ese: `/api/comprobantes/importar` recibe el
 * ARCHIVO, así que un CSV de 30 MB se habría importado a medias **sin error**,
 * que es pérdida de datos silenciosa.
 *
 * Las tres se autentican solas (sesión por cookie o token compartido) y no
 * dependen del refresco del middleware, así que sacarlas no cambia nada más.
 *
 * **Regla:** toda ruta nueva que reciba un archivo o un payload que crezca con
 * los datos del cliente se añade aquí. Hay un test que lo vigila.
 */
// El matcher va LITERAL: Next lo analiza estáticamente en build y no admite
// variables ni plantillas. Las tres rutas excluidas son las de arriba.
export const config = {
  // Ejecuta en todas las rutas salvo estáticos, imágenes y las de cuerpo grande.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/conciliacion/iniciar|api/comprobantes/importar|api/webhooks/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
