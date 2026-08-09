"use server";

import { getUsuarioActual } from "@/lib/auth";
import { asistenteDisponible, conversarConHerramientas } from "@/lib/ia/cliente";
import { ejecutarHerramienta } from "@/lib/ia/herramientas-servidor";
import { promptGeneralConHistorial, type Mensaje } from "@/lib/ia/prompts";
import { verificarCifras } from "@/lib/ia/verificacion";

/**
 * El asistente general.
 *
 * ── Qué lo diferencia de los dos acotados ──────────────────────────────────
 *
 * En el Paso 3 y en «¿Por qué?» hay un análisis determinístico en pantalla que
 * respalda lo que diga el modelo. **Aquí no hay nada debajo**: la respuesta es
 * lo único que el usuario ve. Por eso este es el sitio donde las garantías
 * tienen que apretar más, no menos.
 *
 * 1. El modelo **no consulta**: pide que se consulte, y quien consulta es
 *    `ejecutarHerramienta`, que usa el cliente de sesión y no acepta jamás un
 *    `empresa_id`. La empresa sale siempre de `auth.uid()`.
 * 2. Ninguna herramienta **escribe**. El asistente no aprueba, no concilia y no
 *    borra. Una acción destructiva disparada por una frase mal entendida no
 *    tiene arreglo.
 * 3. Toda cifra de la respuesta se verifica contra **lo que devolvieron las
 *    consultas**. Si el modelo cita un número que ninguna devolvió, la
 *    respuesta se descarta entera y se dice por qué.
 */

export type RespuestaAsistente =
  | { ok: true; texto: string; consultas: string[] }
  | { ok: false; error: string };

export async function preguntarAlAsistente(
  historial: Mensaje[],
  pregunta: string,
): Promise<RespuestaAsistente> {
  const usuario = await getUsuarioActual();
  if (!usuario) return { ok: false, error: "No autenticado." };

  if (!asistenteDisponible()) {
    return { ok: false, error: "El asistente no está disponible." };
  }

  const limpia = pregunta.trim();
  if (limpia === "") return { ok: false, error: "Escribe una pregunta." };

  const mensajes = promptGeneralConHistorial(historial, limpia);
  const r = await conversarConHerramientas(mensajes, ejecutarHerramienta);
  if (!r.ok) return r;

  // ⚠️ Se verifica contra TODO lo que el modelo recibió: el prompt entero
  // (system incluido) más lo que devolvieron las consultas.
  //
  // Antes solo se miraban los resultados de las herramientas, y eso rechazaba
  // respuestas correctas: a una pregunta que no requiere consultar nada —«¿qué
  // necesitas para darme el balance de marzo?»— la lista de cifras admitidas
  // salía VACÍA, así que cualquier número de una respuesta legítima se
  // marcaba como inventado.
  //
  // La regla siempre fue "toda cifra tiene que aparecer en el texto que se le
  // mandó"; lo que estaba mal era mirar solo un trozo de ese texto.
  const permitido = [...mensajes.map((m) => m.content), r.contexto].join("\n");

  const v = verificarCifras(r.texto, permitido);
  if (!v.ok) {
    console.error("[asistente] cifras no verificadas", v.intrusas);
    return {
      ok: false,
      error:
        "El asistente respondió con cifras que no salen de tus datos, así que " +
        "no se muestra. Si preguntaste por tus cobros, tus pagos o tus " +
        "conciliaciones, vuelve a intentarlo siendo más concreto.",
    };
  }

  return { ok: true, texto: r.texto, consultas: [...new Set(r.consultas)] };
}
