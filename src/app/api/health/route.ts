import { NextResponse } from "next/server";

/**
 * Health check para el orquestador (Docker Swarm / Dokploy).
 * No toca Supabase ni n8n: solo confirma que el server responde.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
