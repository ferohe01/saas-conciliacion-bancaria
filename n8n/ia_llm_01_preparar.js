// ── IA real (1/2): Preparar prompt para el LLM ────────────────────────────
// Toma los pendientes de la capa difusa y arma el cuerpo de la petición a la
// API de Anthropic (Claude), con SALIDA ESTRUCTURADA (JSON garantizado).
// Arrastra todo el estado para las capas siguientes. Nombra este nodo
// exactamente "Preparar IA" (el nodo de parseo lo referencia por ese nombre).

const prev = $json;
const internos = prev.pendientes_internos ?? [];
const bancarios = prev.pendientes_bancarios ?? [];
const cfg = prev.config ?? {};

// Compactar para el prompt (solo lo necesario).
const compactInt = internos.map((r) => ({
  id: r.id_interno,
  fecha: r.fecha,
  monto: r.monto,
  nombre: r.contraparte ?? r.descripcion ?? "",
}));
const compactBanc = bancarios.map((m) => ({
  id: m.id_movimiento,
  fecha: m.fecha,
  monto: m.monto,
  glosa: m.glosa ?? "",
}));

const tolIa = cfg.tolerancia_ia_monto ?? 10;
const tolDias = cfg.tolerancia_dias ?? 3;

const system = [
  "Eres un experto en conciliación bancaria peruana. Recibes registros internos",
  "(cobranzas/pagos de una empresa) y movimientos bancarios que NO fueron",
  "conciliados por reglas exactas ni difusas. Propón SOLO los pares que con alta",
  "probabilidad corresponden a la misma transacción real.",
  "",
  "Reglas estrictas:",
  "- Cada registro interno se empareja con UN solo movimiento bancario (1 a 1).",
  "- Mismo signo: montos ambos positivos (ingresos) o ambos negativos (egresos).",
  `- La diferencia de monto debe ser pequeña (típicamente <= ${tolIa}; p. ej. comisiones).`,
  `- Fechas cercanas (a lo sumo unos ${tolDias + 4} días de diferencia).`,
  "- Debe haber correspondencia de identidad: el nombre de la contraparte aparece",
  "  (total o parcialmente) en la glosa bancaria. NO emparejes por azar.",
  "- Si no hay un buen candidato, NO lo incluyas. Prefiere precisión sobre cobertura.",
  "",
  "Devuelve la confianza (0 a 1) y una justificación breve en español citando la",
  "evidencia (nombre coincidente, diferencia de monto, cercanía de fecha).",
  "",
  'Responde ÚNICAMENTE con un objeto JSON con la forma {"pares":[{"id_interno":"...",',
  '"id_movimiento":"...","confianza":0.0,"justificacion":"..."}]}. Sin texto fuera',
  "del JSON, sin explicaciones adicionales, sin ```.",
].join("\n");

const user = [
  `Tolerancias: ${JSON.stringify(cfg)}`,
  "",
  "Registros internos pendientes:",
  JSON.stringify(compactInt),
  "",
  "Movimientos bancarios pendientes:",
  JSON.stringify(compactBanc),
].join("\n");

// Cuerpo completo de la petición a la API de Anthropic (Messages API).
const ia_body = {
  model: "claude-opus-4-8",
  max_tokens: 8000,
  system,
  messages: [{ role: "user", content: user }],
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["pares"],
        properties: {
          pares: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id_interno", "id_movimiento", "confianza", "justificacion"],
              properties: {
                id_interno: { type: "string" },
                id_movimiento: { type: "string" },
                confianza: { type: "number" },
                justificacion: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

return [{
  json: {
    job_id: prev.job_id,
    metadata: prev.metadata,
    config: prev.config,
    total_internos: prev.total_internos,
    total_bancarios: prev.total_bancarios,
    matches: prev.matches,
    pendientes_internos: internos,
    pendientes_bancarios: bancarios,
    ia_body, // para el nodo HTTP Request (alternativa)
    ia_system: system, // para el nodo AI Agent (systemMessage)
    ia_user: user, // para el nodo AI Agent (prompt)
  },
}];
