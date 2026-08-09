#!/usr/bin/env node
/**
 * ¿Funciona el modelo del asistente?
 *
 * Comprueba las tres cosas que pueden fallar y las distingue, que es lo que no
 * hace la app: desde la interfaz, los tres casos se ven igual ("El asistente no
 * pudo responder").
 *
 *   1. La clave no vale            → 401
 *   2. El modelo no existe         → 404 / model_not_found
 *   3. Todo bien                   → responde
 *
 * La `OPENAI_MODEL` por defecto se heredó de lo que documenta CLAUDE.md para
 * n8n y NUNCA se había confirmado desde la app. Este script existe para eso.
 *
 * Uso (desde la raíz del repo):
 *
 *     node ops/verificar-modelo.mjs
 *
 * Lee `OPENAI_API_KEY` / `OPENAI_MODEL` del entorno y, si no están, de
 * `.env.local`. **Nunca imprime la clave**: solo su huella (primeros y últimos
 * caracteres), que basta para comprobar que es la que crees y no sirve a nadie.
 */

import { readFileSync } from "node:fs";

function cargarEnvLocal() {
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const linea of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v.trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no hay .env.local: se usa solo el entorno */
  }
}

/** Huella de una clave: suficiente para identificarla, inútil para usarla. */
const huella = (k) =>
  k.length < 12 ? "(demasiado corta)" : `${k.slice(0, 6)}…${k.slice(-4)} (${k.length} car.)`;

async function main() {
  cargarEnvLocal();

  const key = process.env.OPENAI_API_KEY;
  const modelo = process.env.OPENAI_MODEL || "gpt-5.6-luna";

  if (!key) {
    console.error("✗ No hay OPENAI_API_KEY (ni en el entorno ni en .env.local).");
    console.error("  El asistente no se ofrece; el resto de la app funciona igual.");
    process.exit(1);
  }

  console.log(`Clave  : ${huella(key)}`);
  console.log(`Modelo : ${modelo}`);
  console.log("");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: modelo,
      messages: [
        {
          role: "system",
          content:
            "Responde en español de Perú, en una sola frase corta. " +
            "No inventes cifras: solo puedes repetir las que te doy.",
        },
        {
          role: "user",
          content:
            "Casarían 12 de 450,999 movimientos. ¿Qué significa? Una frase.",
        },
      ],
      max_completion_tokens: 120,
    }),
  });

  const cuerpo = await res.text();

  if (res.status === 401) {
    console.error("✗ La clave no es válida (401). Revísala en Dokploy.");
    process.exit(1);
  }

  if (!res.ok) {
    let codigo = "";
    try {
      codigo = JSON.parse(cuerpo)?.error?.code ?? "";
    } catch {
      /* respuesta no JSON */
    }
    if (res.status === 404 || codigo === "model_not_found") {
      console.error(`✗ El modelo «${modelo}» no existe para esta cuenta.`);
      console.error("  Modelos de chat disponibles:");
      await listarModelos(key);
      console.error("");
      console.error("  Arréglalo poniendo OPENAI_MODEL con uno de esos.");
      process.exit(1);
    }
    console.error(`✗ Error ${res.status}: ${cuerpo.slice(0, 400)}`);
    process.exit(1);
  }

  const data = JSON.parse(cuerpo);
  const texto = data?.choices?.[0]?.message?.content?.trim();
  if (!texto) {
    console.error("✗ Respondió, pero sin contenido utilizable.");
    console.error(cuerpo.slice(0, 400));
    process.exit(1);
  }

  console.log("✓ El modelo responde (asistentes acotados).");
  console.log("");
  console.log(`  «${texto}»`);
  console.log("");
  const uso = data?.usage;
  if (uso) {
    console.log(
      `  Tokens: ${uso.prompt_tokens} de entrada + ${uso.completion_tokens} de salida.`,
    );
  }

  console.log("");
  await probarHerramientas(key, modelo);
}

/**
 * La segunda prueba, y la que de verdad importa para el chat general.
 *
 * Responder texto y saber PEDIR UNA CONSULTA son dos capacidades distintas: un
 * modelo puede tener la primera y no la segunda. Cuando el chat de `/asistente`
 * falla mientras el «¿Por qué?» funciona, la diferencia es exactamente esta
 * llamada.
 */
async function probarHerramientas(key, modelo) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: modelo,
      messages: [
        {
          role: "system",
          content:
            "Para cualquier dato de la empresa USA UNA HERRAMIENTA. Nunca " +
            "respondas de memoria.",
        },
        { role: "user", content: "¿Cuánto me deben en total?" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "cuentas_por_cobrar",
            description:
              "Cuánto te deben tus clientes hoy: total, vencido y los mayores " +
              "deudores. Úsala para «¿cuánto me deben?».",
            parameters: {
              type: "object",
              properties: {
                busca: { type: "string", description: "Filtra por cliente." },
              },
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: "auto",
      max_completion_tokens: 1500,
    }),
  });

  const cuerpo = await res.text();

  if (!res.ok) {
    console.error("✗ El modelo NO admite consultas a tus datos (herramientas).");
    console.error(`  HTTP ${res.status}: ${cuerpo.slice(0, 500)}`);
    console.error("");
    console.error("  Los asistentes del Paso 3 y del «¿Por qué?» siguen bien;");
    console.error("  el que no funcionará es el chat general de /asistente.");
    console.error("  Prueba con otro OPENAI_MODEL que soporte function calling.");
    process.exitCode = 1;
    return;
  }

  const data = JSON.parse(cuerpo);
  const msg = data?.choices?.[0]?.message;
  const fin = data?.choices?.[0]?.finish_reason;
  const llamadas = msg?.tool_calls ?? [];

  if (llamadas.length > 0) {
    console.log("✓ El modelo pide consultas correctamente (chat general OK).");
    console.log(`  Pidió: ${llamadas.map((c) => c.function.name).join(", ")}`);
    console.log(
      `  Tokens de salida: ${data?.usage?.completion_tokens ?? "?"} ` +
        `(el tope de la app es 1500).`,
    );
    return;
  }

  console.error("✗ El modelo NO pidió ninguna consulta.");
  console.error(`  finish_reason: ${fin} · tokens: ${data?.usage?.completion_tokens}`);
  if (fin === "length") {
    console.error("  Se quedó sin espacio razonando antes de emitir la consulta.");
    console.error("  Sube MAX_TOKENS_HERRAMIENTAS en src/lib/ia/cliente.ts.");
  } else {
    console.error(`  Respondió de memoria: «${(msg?.content ?? "").slice(0, 200)}»`);
    console.error("  Ese modelo ignora las herramientas; usa otro.");
  }
  process.exitCode = 1;
}

async function listarModelos(key) {
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      console.error("    (no se pudieron listar)");
      return;
    }
    const { data } = await r.json();
    const chat = (data ?? [])
      .map((m) => m.id)
      .filter((id) => /^(gpt|o[0-9])/i.test(id))
      .sort();
    for (const id of chat) console.error(`    · ${id}`);
    if (chat.length === 0) console.error("    (ninguno de chat)");
  } catch {
    console.error("    (no se pudieron listar)");
  }
}

main().catch((e) => {
  console.error("✗ No se pudo contactar con la API:", e.message);
  process.exit(1);
});
