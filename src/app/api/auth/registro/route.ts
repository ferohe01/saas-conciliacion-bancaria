import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/auth/registro
 *
 * Crea la cuenta del usuario + su empresa + la membresía (rol admin) en una
 * sola operación de servidor usando `service_role`. Tras el éxito, el cliente
 * inicia sesión con email/contraseña.
 *
 * Se hace en el servidor (no desde el cliente) para poder crear la empresa y la
 * membresía saltando RLS de forma controlada y evitar la fricción de
 * confirmación de email en el MVP (email_confirm: true).
 */

const RegistroSchema = z.object({
  nombre_empresa: z.string().trim().min(2, "El nombre de la empresa es muy corto"),
  ruc: z
    .string()
    .trim()
    .regex(/^\d{11}$/, "El RUC debe tener 11 dígitos")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  email: z.string().trim().email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export async function POST(request: Request) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json(
      { error: "El servidor aún no tiene configurado Supabase." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = RegistroSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }

  const { nombre_empresa, ruc, email, password } = parsed.data;
  const admin = createAdminClient();

  // 1) Crear el usuario (confirmado, sin correo de verificación en el MVP).
  const { data: userData, error: userError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (userError || !userData.user) {
    const msg = userError?.message ?? "";
    const yaExiste = /already|registered|exists/i.test(msg);
    return NextResponse.json(
      {
        error: yaExiste
          ? "Ya existe una cuenta con ese correo."
          : "No se pudo crear la cuenta.",
      },
      { status: yaExiste ? 409 : 400 },
    );
  }

  const usuarioId = userData.user.id;

  // 2) Crear la empresa.
  const { data: empresa, error: empresaError } = await admin
    .from("empresas")
    .insert({ nombre: nombre_empresa, ruc: ruc ?? null })
    .select("id")
    .single();

  if (empresaError || !empresa) {
    // Rollback: eliminar el usuario recién creado.
    await admin.auth.admin.deleteUser(usuarioId);
    return NextResponse.json(
      { error: "No se pudo crear la empresa." },
      { status: 500 },
    );
  }

  // 3) Crear la membresía (rol admin).
  const { error: membresiaError } = await admin
    .from("usuarios_empresa")
    .insert({ usuario_id: usuarioId, empresa_id: empresa.id, rol: "admin" });

  if (membresiaError) {
    // Rollback: eliminar empresa y usuario.
    await admin.from("empresas").delete().eq("id", empresa.id);
    await admin.auth.admin.deleteUser(usuarioId);
    return NextResponse.json(
      { error: "No se pudo vincular el usuario con la empresa." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
