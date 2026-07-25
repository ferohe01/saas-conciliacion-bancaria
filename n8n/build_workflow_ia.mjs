import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), "utf8");

const SUPABASE_URL = "http://supabase-supabase-e53a81-95-111-245-187.sslip.io";
const SERVICE_ROLE_PLACEHOLDER = "PEGA_AQUI_TU_SERVICE_ROLE";
const ANTHROPIC_KEY_PLACEHOLDER = "PEGA_AQUI_TU_ANTHROPIC_API_KEY";

const code = (name, jsFile, x, y) => ({
  parameters: { mode: "runOnceForAllItems", jsCode: read(jsFile) },
  id: randomUUID(),
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [x, y],
});

const nodes = [
  {
    parameters: {
      httpMethod: "POST",
      path: "conciliaciones",
      responseMode: "responseNode",
      options: {},
    },
    id: randomUUID(),
    name: "Webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [-320, 300],
    webhookId: randomUUID(),
  },
  {
    parameters: {
      respondWith: "json",
      responseBody:
        '={{ { "status": "accepted", "job_id": $json.body.job_id, "registros_recibidos": ($json.body.registros_internos || []).length, "movimientos_recibidos": ($json.body.movimientos_bancarios || []).length } }}',
      options: {},
    },
    id: randomUUID(),
    name: "Responder aceptado",
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [-120, 300],
  },
  code("Exacta", "01_exacta.js", 80, 300),
  code("Difusa", "02_difusa.js", 280, 300),
  code("Preparar IA", "ia_llm_01_preparar.js", 480, 300),
  {
    parameters: {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "x-api-key", value: ANTHROPIC_KEY_PLACEHOLDER },
          { name: "anthropic-version", value: "2023-06-01" },
          { name: "content-type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.ia_body) }}",
      options: {},
    },
    id: randomUUID(),
    name: "LLM Anthropic",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [680, 300],
  },
  code("Parsear IA", "ia_llm_02_parsear.js", 880, 300),
  code("Ensamblar resultado", "04_ensamblar.js", 1080, 300),
  {
    parameters: {
      method: "PATCH",
      url: `={{ '${SUPABASE_URL}/rest/v1/jobs_conciliacion?id=eq.' + $json.job_id }}`,
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "apikey", value: SERVICE_ROLE_PLACEHOLDER },
          { name: "Authorization", value: `Bearer ${SERVICE_ROLE_PLACEHOLDER}` },
          { name: "Prefer", value: "return=minimal" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.resultado_update) }}",
      options: {},
    },
    id: randomUUID(),
    name: "Actualizar Supabase",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [1280, 300],
  },
];

const conn = (from, to) => ({
  [from]: { main: [[{ node: to, type: "main", index: 0 }]] },
});

const connections = {
  ...conn("Webhook", "Responder aceptado"),
  ...conn("Responder aceptado", "Exacta"),
  ...conn("Exacta", "Difusa"),
  ...conn("Difusa", "Preparar IA"),
  ...conn("Preparar IA", "LLM Anthropic"),
  ...conn("LLM Anthropic", "Parsear IA"),
  ...conn("Parsear IA", "Ensamblar resultado"),
  ...conn("Ensamblar resultado", "Actualizar Supabase"),
};

const workflow = {
  name: "Conciliación Bancaria (IA real)",
  nodes,
  connections,
  settings: { executionOrder: "v1" },
  pinData: {},
};

writeFileSync(
  join(here, "workflow_conciliacion_ia.json"),
  JSON.stringify(workflow, null, 2),
);
console.log("OK -> n8n/workflow_conciliacion_ia.json");
