import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { EstadoJob } from "@/lib/contract/enums";
import { ResultadoConciliacion } from "@/lib/contract/resultado";

/**
 * POST /api/webhooks/resultado-conciliacion
 *
 * Callback opcional para que n8n reporte progreso/resultado (alternativa a
 * escribir directo en Supabase). Protegido por el token compartido: se rechaza
 * cualquier request sin token válido.
 */

const CallbackSchema = z.object({
  job_id: z.string().min(1),
  estado: EstadoJob.optional(),
  fase_actual: z.string().optional(),
  resultado: ResultadoConciliacion.partial().optional(),
  error_detalle: z.string().optional(),
});

function tokenValido(request: Request): boolean {
  const esperado = process.env.N8N_WEBHOOK_TOKEN;
  if (!esperado) return false;
  const header =
    request.headers.get("x-n8n-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return header === esperado;
}

export async function POST(request: Request) {
  if (!tokenValido(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = CallbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const { job_id, estado, fase_actual, resultado, error_detalle } = parsed.data;

  const campos: Record<string, unknown> = {};
  if (estado) campos.estado = estado;
  if (fase_actual) campos.fase_actual = fase_actual;
  if (resultado) campos.resultado = resultado;
  if (error_detalle) campos.error_detalle = error_detalle;
  if (estado === "completado") campos.completed_at = new Date().toISOString();

  const admin = createAdminClient();
  const { error } = await admin
    .from("jobs_conciliacion")
    .update(campos)
    .eq("id", job_id);

  if (error) {
    return NextResponse.json(
      { error: "No se pudo actualizar el job." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
