import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { esRucValido, esRegionValida, esTelefonoValido } from "@/lib/peru";

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

const telefono = (campo: string) =>
  z
    .string()
    .trim()
    .refine(esTelefonoValido, `El ${campo} no parece válido (6 a 15 dígitos)`);

const RegistroSchema = z.object({
  // Empresa
  nombre_empresa: z.string().trim().min(2, "El nombre de la empresa es muy corto"),
  ruc: z.string().trim().refine(esRucValido, "El RUC debe tener 11 dígitos"),
  region: z.string().trim().refine(esRegionValida, "Elige una región válida"),
  provincia: z.string().trim().min(2, "Indica la provincia"),
  direccion: z.string().trim().min(5, "La dirección es muy corta"),
  telefono_empresa: telefono("teléfono de la empresa"),
  // Administrador. Su correo ES el usuario con el que inicia sesión.
  admin_nombre: z.string().trim().min(3, "Indica el nombre completo"),
  admin_telefono: telefono("teléfono"),
  email: z.string().trim().email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

/** Nombre visible de cada campo, para que un error diga cuál falta. */
const ETIQUETAS: Record<string, string> = {
  nombre_empresa: "la razón social",
  ruc: "el RUC",
  region: "la región",
  provincia: "la provincia",
  direccion: "la dirección",
  telefono_empresa: "el teléfono de la empresa",
  admin_nombre: "el nombre del administrador",
  admin_telefono: "el teléfono del administrador",
  email: "el correo electrónico",
  password: "la contraseña",
};

/**
 * Zod devuelve "Required" en inglés cuando falta un campo. Se traduce nombrando
 * el campo: un error debe decir qué pasó y qué hacer, no solo que algo falló.
 */
function mensajeDeError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Datos inválidos";
  if (issue.message === "Required") {
    const campo = ETIQUETAS[String(issue.path[0])] ?? "un dato obligatorio";
    return `Falta ${campo}.`;
  }
  return issue.message;
}

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
      { error: mensajeDeError(parsed.error) },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const { email, password } = d;
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
    .insert({
      nombre: d.nombre_empresa,
      ruc: d.ruc,
      region: d.region,
      provincia: d.provincia,
      direccion: d.direccion,
      telefono: d.telefono_empresa,
    })
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
    .insert({
      usuario_id: usuarioId,
      empresa_id: empresa.id,
      rol: "admin",
      nombre_completo: d.admin_nombre,
      telefono: d.admin_telefono,
    });

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
