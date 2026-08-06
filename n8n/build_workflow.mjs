import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), "utf8");

// HTTPS y el dominio definitivo: el host sslip.io por HTTP funcionaba, pero el
// service_role —la clave mas privilegiada del sistema— viajaba en claro.
const SUPABASE_URL = "https://supabase.fernandorh.com";
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
      // Token compartido obligatorio: el backend lo manda en `x-n8n-token`
      // (ver src/lib/n8n/cliente.ts). La credencial en sí NO viaja en el JSON
      // — tras importar hay que seleccionarla, igual que la del modelo.
      authentication: "headerAuth",
      options: {},
    },
    id: randomUUID(),
    name: "Webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [-260, 300],
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
    position: [-40, 300],
  },
  code("Exacta", "01_exacta.js", 180, 300),
  code("Difusa", "02_difusa.js", 400, 300),
  code("Agrupacion", "03a_agrupacion.js", 620, 300),
  code("IA (sugerencias)", "03_ia.js", 840, 300),
  code("Ensamblar resultado", "04_ensamblar.js", 1060, 300),
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
  ...conn("Difusa", "Agrupacion"),
  ...conn("Agrupacion", "IA (sugerencias)"),
  ...conn("IA (sugerencias)", "Ensamblar resultado"),
  ...conn("Ensamblar resultado", "Actualizar Supabase"),
};

const workflow = {
  name: "Conciliación Bancaria",
  nodes,
  connections,
  settings: { executionOrder: "v1" },
  pinData: {},
};

writeFileSync(
  join(here, "workflow_conciliacion.json"),
  JSON.stringify(workflow, null, 2),
);
console.log("OK -> n8n/workflow_conciliacion.json");
