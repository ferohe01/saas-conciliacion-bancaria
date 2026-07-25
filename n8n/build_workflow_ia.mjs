import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), "utf8");

const SUPABASE_URL = "http://supabase-supabase-e53a81-95-111-245-187.sslip.io";
const SERVICE_ROLE_PLACEHOLDER = "PEGA_AQUI_TU_SERVICE_ROLE";

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
  code("Candidatos IA", "ia_llm_01_candidatos.js", 480, 300),
  {
    // Nodo AI Agent: usa el system + prompt que arma "Preparar IA". El modelo
    // se conecta como sub-nodo (Anthropic Chat Model) por ai_languageModel.
    parameters: {
      promptType: "define",
      text: "={{ $json.ia_user }}",
      options: { systemMessage: "={{ $json.ia_system }}" },
    },
    id: randomUUID(),
    name: "AI Agent",
    type: "@n8n/n8n-nodes-langchain.agent",
    typeVersion: 1.7,
    position: [700, 300],
  },
  {
    // Sub-nodo de modelo. Tras importar: selecciona tu credencial de Anthropic
    // y confirma el modelo (claude-opus-4-8). Se enlaza al AI Agent por
    // ai_languageModel (no por main).
    parameters: {
      model: { __rl: true, mode: "id", value: "claude-opus-4-8" },
      options: { maxTokensToSample: 8000 },
    },
    id: randomUUID(),
    name: "Anthropic Chat Model",
    type: "@n8n/n8n-nodes-langchain.lmChatAnthropic",
    typeVersion: 1.3,
    position: [660, 500],
  },
  code("Parsear IA", "ia_llm_02_parsear.js", 920, 300),
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
  ...conn("Difusa", "Candidatos IA"),
  ...conn("Candidatos IA", "AI Agent"),
  ...conn("AI Agent", "Parsear IA"),
  ...conn("Parsear IA", "Ensamblar resultado"),
  ...conn("Ensamblar resultado", "Actualizar Supabase"),
  // El modelo se conecta al Agent por el enlace especial ai_languageModel.
  "Anthropic Chat Model": {
    ai_languageModel: [
      [{ node: "AI Agent", type: "ai_languageModel", index: 0 }],
    ],
  },
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
