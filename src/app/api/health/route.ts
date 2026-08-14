import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Health check para el orquestador (Docker Swarm / Dokploy).
 * No toca Supabase ni n8n: solo confirma que el server responde.
 *
 * ── Y dice QUÉ build está sirviendo ────────────────────────────────────────
 *
 * ⚠️ Tres veces seguidas el síntoma fue «lo desplegué y sigue igual», y las tres
 * la causa estuvo en el despliegue, no en el código: una vez porque nada se
 * había commiteado, dos porque la imagen no se reconstruyó. Averiguarlo exigía
 * comparar a mano los hashes de los chunks que sirve producción contra los de un
 * build local — quince minutos para responder a «¿llegó o no llegó?».
 *
 * `build` es el BUILD_ID que Next genera en cada compilación: **cambia siempre
 * que se reconstruye**. Si tras un redespliegue sigue valiendo lo mismo, la
 * imagen es la de antes y no hay nada que buscar en el código.
 *
 * `commit` sale de un build arg opcional (`GIT_SHA`). Si el orquestador no lo
 * pasa queda `null`, y `build` sigue respondiendo la pregunta importante.
 */
export const dynamic = "force-dynamic";

/** Se lee UNA vez: el fichero no cambia mientras el proceso viva. */
const BUILD = (() => {
  try {
    return readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return null;
  }
})();

export function GET() {
  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    build: BUILD,
    commit: process.env.GIT_SHA ?? null,
  });
}
