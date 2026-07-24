import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsuarioActual, getEmpresaActual } from "@/lib/auth";
import { generarJobId } from "@/lib/jobs";
import { enviarAN8n } from "@/lib/n8n/cliente";
import { simularConciliacion } from "@/lib/n8n/mock";
import {
  PayloadConciliacion,
  Periodo,
  Saldos,
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";
import {
  ConfigConciliacion,
  CONFIG_CONCILIACION_DEFAULT,
} from "@/lib/contract/config";

/**
 * POST /api/conciliacion/iniciar
 *
 * Backend delgado que orquesta el arranque de una conciliación (§7.1):
 *  1) autentica al usuario y valida el payload,
 *  2) genera job_id e inserta el job (estado 'pendiente'),
 *  3) recién entonces dispara n8n (real o mock) con el token,
 *  4) compara los conteos recibidos vs. enviados.
 * El frontend nunca contacta a n8n ni conoce el token.
 */

const IniciarReq = z.object({
  cuenta_id: z.string().uuid(),
  periodo: Periodo,
  saldos: Saldos,
  config: ConfigConciliacion.partial().optional(),
  registros_internos: z.array(RegistroInterno).min(1),
  movimientos_bancarios: z.array(MovimientoBancario).min(1),
});

export async function POST(request: Request) {
  const usuario = await getUsuarioActual();
  const empresa = await getEmpresaActual();
  if (!usuario || !empresa) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = IniciarReq.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const req = parsed.data;

  // La cuenta debe pertenecer a la empresa del usuario (RLS lo garantiza).
  const supabase = await createClient();
  const { data: cuenta } = await supabase
    .from("cuentas_bancarias")
    .select("id, banco, numero_enmascarado, moneda")
    .eq("id", req.cuenta_id)
    .maybeSingle();
  if (!cuenta) {
    return NextResponse.json(
      { error: "Cuenta no encontrada." },
      { status: 404 },
    );
  }

  const admin = createAdminClient();

  // Idempotencia: no crear dos jobs activos iguales (misma cuenta+período).
  const { data: activo } = await admin
    .from("jobs_conciliacion")
    .select("id")
    .eq("empresa_id", empresa.empresa_id)
    .eq("cuenta_id", req.cuenta_id)
    .eq("periodo_desde", req.periodo.desde)
    .eq("periodo_hasta", req.periodo.hasta)
    .in("estado", ["pendiente", "procesando"])
    .maybeSingle();
  if (activo) {
    return NextResponse.json({ job_id: activo.id, idempotente: true });
  }

  const jobId = generarJobId(req.periodo.desde);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const payload = {
    job_id: jobId,
    metadata: {
      empresa_id: empresa.empresa_id,
      usuario_id: usuario.id,
      periodo: req.periodo,
      cuenta: {
        banco: cuenta.banco,
        numero: cuenta.numero_enmascarado ?? "****",
        moneda: cuenta.moneda,
      },
      saldos: req.saldos,
      callback_url: `${appUrl}/api/webhooks/resultado-conciliacion`,
    },
    config: { ...CONFIG_CONCILIACION_DEFAULT, ...(req.config ?? {}) },
    registros_internos: req.registros_internos,
    movimientos_bancarios: req.movimientos_bancarios,
  };

  const validado = PayloadConciliacion.safeParse(payload);
  if (!validado.success) {
    return NextResponse.json(
      { error: "El payload no cumple el contrato.", detalle: validado.error.issues[0]?.message },
      { status: 400 },
    );
  }

  // Insertar el job antes de disparar n8n.
  const { error: insError } = await admin.from("jobs_conciliacion").insert({
    id: jobId,
    empresa_id: empresa.empresa_id,
    cuenta_id: req.cuenta_id,
    usuario_id: usuario.id,
    periodo_desde: req.periodo.desde,
    periodo_hasta: req.periodo.hasta,
    estado: "pendiente",
    payload_entrada: validado.data,
  });
  if (insError) {
    return NextResponse.json(
      { error: "No se pudo crear el job." },
      { status: 500 },
    );
  }

  // Disparar el procesamiento: mock (dev) o webhook real.
  const usarMock = process.env.N8N_MOCK === "true";
  if (usarMock) {
    simularConciliacion(jobId, validado.data);
    return NextResponse.json({ job_id: jobId, modo: "mock" });
  }

  const envio = await enviarAN8n(validado.data);
  if (!envio.ok) {
    await admin
      .from("jobs_conciliacion")
      .update({ estado: "error", error_detalle: envio.error })
      .eq("id", jobId);
    return NextResponse.json({ error: envio.error }, { status: 502 });
  }

  // Comparar conteos enviados vs. recibidos.
  const enviadosInt = validado.data.registros_internos.length;
  const enviadosBanc = validado.data.movimientos_bancarios.length;
  if (
    envio.aceptacion.registros_recibidos !== enviadosInt ||
    envio.aceptacion.movimientos_recibidos !== enviadosBanc
  ) {
    const detalle = `Conteos no coinciden: enviados ${enviadosInt}/${enviadosBanc}, recibidos ${envio.aceptacion.registros_recibidos}/${envio.aceptacion.movimientos_recibidos}.`;
    await admin
      .from("jobs_conciliacion")
      .update({ estado: "error", error_detalle: detalle })
      .eq("id", jobId);
    return NextResponse.json({ error: detalle }, { status: 502 });
  }

  await admin
    .from("jobs_conciliacion")
    .update({ estado: "procesando" })
    .eq("id", jobId);

  return NextResponse.json({ job_id: jobId, modo: "n8n" });
}
