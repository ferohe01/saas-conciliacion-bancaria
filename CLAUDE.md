# CLAUDE.md — Conciliación Bancaria (SaaS para PyMEs · Perú)

Guía para agentes y desarrolladores que trabajen en este repo. Léela antes de
tocar código.

## Qué es esto

Interfaz web + backend delgado + base de datos para un SaaS de **conciliación
bancaria asistida por IA** dirigido a PyMEs peruanas. El usuario típico **no es
contador de profesión**: la UI es guiada, en español (es-PE), con lenguaje
simple.

**El motor de conciliación NO vive aquí.** Corre como flujos de **n8n**
externos, invocados por webhook. Este proyecto implementa la interfaz, un
backend delgado y el esquema Supabase.

## Principio arquitectónico rector

> **La interfaz orquesta, normaliza y presenta; n8n procesa.**

- Todo procesamiento pesado / con IA / de duración variable se delega a n8n con
  el patrón asíncrono (ver "Contrato con n8n").
- La interfaz hace el **parsing y mapeo de columnas** de los archivos y envía al
  webhook **datos normalizados en JSON, nunca archivos crudos**.
- **Lo que el usuario confirma en pantalla es exactamente lo que viaja al
  webhook.**
- El **frontend NUNCA** llama a los webhooks de n8n ni conoce keys
  privilegiadas. Siempre pasa por el backend propio.

### Las capas de conciliación (contexto; corren en n8n)

1. Match exacto (monto + ID de pago).
2. Matching difuso/heurístico con tolerancias (exige ≥1 palabra de nombre en común).
3. **Agrupación 1:N / N:1** (subset-sum): un depósito bancario que reúne varios
   pagos internos, o un pago reflejado en varios movimientos. Ver nota abajo.
4. IA con score de confianza que **propone** matches (sobre una shortlist de
   candidatos, ver abajo).
5. Revisión humana en la interfaz.

La IA nunca concilia sola por debajo del `umbral_confianza_auto`.

**Capa de agrupación 1:N / N:1 (entre difusa e IA).** Etapa determinística que
detecta cuándo una partida de un lado corresponde a la SUMA de varias del otro
(p. ej. un depósito de S/1000 que junta tres cuotas). Usa subset-sum acotado
para precisión: suma **casi exacta** (`min(tolerancia_monto_abs, 0.5)`), grupo
pequeño (`≤ max_combinacion`), dentro de `ventana_ia_dias`, con desempate por
coherencia de nombre. Se proponen como **sugerencias** (`estado 'pendiente'`,
`categoria_diferencia = 'agrupacion_1aN'`) → van a revisión humana, nunca se
auto-concilian. Lógica en el nodo de producción n8n `03a_agrupacion.js` (fuente
única).

**Etapa de generación de candidatos (antes de la IA).** Los pendientes tras
exacta+difusa no se le pasan crudos a la IA. Primero una etapa determinística
(record-linkage / blocking) arma, por cada registro interno, una **shortlist
rankeada** de los movimientos bancarios más relevantes: candidatura = mismo
signo + diferencia de monto ≤ `tolerancia_ia_monto` + fecha en ventana + ≥1
palabra en común (nombre); luego un **score** (similitud de nombre + cercanía de
monto/fecha + referencia) y se conservan los **top-K**. La IA solo **adjudica**
sobre esa shortlist (elige el mejor o "ninguno") y clasifica el tipo de
diferencia (reason code). Lógica en los nodos de producción n8n `03_ia.js`
(heurístico) / `ia_llm_01_candidatos.js` (LLM) — fuente única.

**Few-shot dinámico (aprendizaje).** El backend extrae de los jobs completados
de la empresa las **decisiones humanas confirmadas** (aceptado/modificado/manual
→ positivo; rechazado → negativo) y las adjunta al payload como
`ejemplos_aprendizaje` (compactos, balanceados por clase, tope 12). El nodo LLM
las inyecta como few-shot en el system prompt para que la IA calibre el criterio
real de esa empresa (cuánta comisión toleran, cuándo rechazan pese a montos
iguales). Constructor puro en `src/lib/aprendizaje.ts` (con tests); el path
heurístico (`03_ia.js`) no lo usa (no hay LLM que calibrar).

## Stack

- **Frontend:** Next.js (App Router) + TypeScript **estricto** + Tailwind CSS v4.
- **Backend:** API Routes de Next.js (backend delgado). El backend es
  obligatorio entre el frontend y n8n / `service_role`.
- **Datos/Auth/Storage/Realtime:** Supabase (Postgres + RLS + Auth + Storage +
  Realtime).
- **Procesamiento pesado:** n8n externo (webhook con token compartido). n8n
  escribe resultados directo en Supabase usando `service_role`.
- **Parsing de archivos:** SheetJS (`xlsx`) — se añade en la fase del wizard.

## Estructura del repo

```
src/
  app/                     Rutas (App Router). layout, page, (auth), wizard, api...
  lib/
    supabase/
      client.ts            Cliente navegador (anon). Protegido por RLS.
      server.ts            Cliente servidor (anon + sesión por cookies).
      admin.ts             Cliente service_role. SOLO servidor. Salta RLS.
    contract/              ⭐ Backbone: contrato compartido con n8n (zod).
      primitives.ts        Fecha ISO, monto, confianza.
      enums.ts             Literales canónicos (estados, métodos, tipos).
      config.ts            Tolerancias/umbrales por empresa + defaults.
      payload.ts           JSON de ENTRADA hacia n8n (§7.2) + ejemplos_aprendizaje.
      resultado.ts         Estructura de `resultado` desde n8n (§7.3).
      index.ts             Re-exports.
  lib/
    aprendizaje.ts         Few-shot dinámico: decisiones humanas → ejemplos.
    reportes.ts            Agregaciones de reportes (KPIs, métodos, tipos).
n8n/                       ⭐ Motor de conciliación: nodos Code (fuente única)
                           + workflows importables (build_*.mjs).
supabase/
  migrations/
    0001_schema.sql        Tablas.
    0002_rls.sql           Row Level Security (helper es_miembro + políticas).
    0003_realtime.sql      Realtime en jobs_conciliacion (progreso en vivo).
    0004_config_empresa.sql  Columna empresas.config_conciliacion (JSONB).
tests/                     Vitest (unit).
```

## Convenciones (obligatorias)

- **TypeScript estricto** (`strict`, `noUncheckedIndexedAccess`). Sin `any`
  salvo justificación.
- **Idioma/formatos:** UI en español (es-PE), moneda PEN (S/) por defecto.
  Fechas: **dd/mm/yyyy en pantalla**, **ISO 8601 (YYYY-MM-DD) en
  almacenamiento y transporte**.
- **Convención de signos ÚNICA en todo el sistema:** abonos/entradas
  **positivos**, cargos/salidas **negativos**. Se aplica al normalizar en el
  wizard y nunca se reinterpreta después.
- **Contrato con n8n:** toda I/O del webhook se valida con los esquemas zod de
  `src/lib/contract`. Ni el frontend ni n8n redefinen esas formas.
- **BD:** snake_case, `uuid` por defecto `gen_random_uuid()`, timestamps
  `timestamptz`.
- **Commits pequeños por fase.** Actualizar este archivo cuando cambien
  decisiones de arquitectura.
- Mensajes de error orientados al usuario: qué pasó y qué hacer.

## Seguridad (no negociable)

- El frontend nunca conoce `N8N_WEBHOOK_URL`/`N8N_WEBHOOK_TOKEN` ni
  `SUPABASE_SERVICE_ROLE_KEY`.
- `service_role` **solo en servidor** (`src/lib/supabase/admin.ts`, protegido
  por `import "server-only"`). El cliente usa `anon` + RLS.
- RLS habilitado en **todas** las tablas desde la primera migración. La key
  `anon` jamás permite acceso cruzado entre empresas.
- Webhooks (salida a n8n y callback de entrada) protegidos por token secreto en
  header; rechazar requests sin token.
- Validar y sanear **todo** payload entrante en el backend con zod.

### Variables de entorno (ver `.env.example`)

| Variable | Ámbito | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | público | Cliente Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | público | Cliente Supabase (anon + RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **servidor** | Escrituras del sistema (salta RLS) |
| `N8N_WEBHOOK_URL` | **servidor** | Disparar flujo de conciliación |
| `N8N_WEBHOOK_TOKEN` | **servidor** | Autenticación del webhook |
| `NEXT_PUBLIC_APP_URL` | público | Construir `callback_url` |

## Contrato con n8n (patrón asíncrono)

1. Frontend confirma (paso 3) → `POST /api/conciliacion/iniciar` (backend).
2. Backend autentica, valida el payload (zod), genera `job_id`, inserta el job
   (`estado='pendiente'`, `payload_entrada`) y **recién entonces** hace `POST`
   al webhook de n8n con el token.
3. n8n responde de inmediato: `{ status:"accepted", job_id, registros_recibidos,
   movimientos_recibidos }`. El backend compara conteos enviados vs. recibidos;
   si difieren → job a `error`.
4. n8n actualiza `estado='procesando'` y `fase_actual` conforme avanza
   (escribe directo en Supabase con `service_role`).
5. Al terminar: escribe `resultado`, `estado='completado'`, `completed_at`.
6. El frontend, suscrito por **Realtime** a la fila del job, navega a
   resultados.

- **`job_id`** lo genera el backend: llave de trazabilidad e idempotencia. No
  crear dos jobs iguales activos.
- Cada registro/movimiento lleva ID propio (`id_interno`, `id_movimiento`). El
  `resultado` referencia **solo pares de IDs**; los matches soportan
  uno-a-muchos y muchos-a-uno (arrays en ambos lados).
- **Persistir CADA decisión humana** (aceptó/rechazó/modificó/manual) dentro de
  `resultado`, con usuario y timestamp. Es la materia prima del ciclo de
  aprendizaje de la IA (few-shot dinámico, ya implementado — ver nota de
  arquitectura) — no perder ninguna.

Esquemas exactos: `src/lib/contract/payload.ts` y `resultado.ts`.

### Workflows n8n (carpeta `n8n/`)

Los flujos se **generan** con scripts para no editar JSON a mano: cada nodo Code
es un `.js` versionado y `build_workflow*.mjs` los ensambla en un `.json`
importable. Dos variantes:

- `workflow_conciliacion.json` (heurístico, sin LLM):
  `Webhook → Exacta → Difusa → Agrupacion → IA (sugerencias) → Ensamblar →
  Actualizar Supabase`.
- `workflow_conciliacion_ia.json` (IA real): igual, pero la capa IA es
  `Candidatos IA → AI Agent (+ modelo por `ai_languageModel`) → Parsear IA`.

Regenerar: `node n8n/build_workflow.mjs && node n8n/build_workflow_ia.mjs`. Tras
reimportar, hay que **reseleccionar la credencial del modelo** (no viaja en el
JSON) y pegar el `service_role` en el nodo "Actualizar Supabase". El backend
**siempre** dispara n8n real (no hay simulador local). Los nodos `n8n/*.js` son la
**fuente única** del motor: no hay implementación paralela en la app. Todo cambio
de lógica de conciliación se hace ahí y se verifica **end-to-end** en n8n (los
nodos Code no se testean unitariamente en el repo). Regla al editar: mantener la
forma de salida de cada nodo (`job_id`, `metadata`, `config`, `matches`,
`pendientes_*`) para no romper el nodo siguiente.

## Fuera de alcance del MVP

Equipos/roles/invitaciones/SSO · facturación y pagos · pgvector/semántica ·
OCR y XML UBL de facturas · integraciones ERP/bancos/Open Banking · tablas
normalizadas de transacciones/matches (el JSONB del job basta) · el motor de
conciliación (vive en n8n).

### Decisiones que se apartan del spec original

- **PDF de extractos:** el spec lo dejaba fuera del MVP, pero por decisión del
  producto la UI **sí acepta PDF** desde ya (además de Excel/CSV). El
  *procesamiento* real del PDF se resolverá en n8n; la interfaz solo lo carga y
  lo envía normalizado. Mantener el selector preparado para ello.

## Diseño / lenguaje visual

Referencia: `interfaz.jpg` (mockup del Paso 1) — es la dirección de diseño para
toda la app. Tokens: tarjeta blanca `rounded-3xl` con borde neutral y sombra
suave sobre fondo `neutral-100`; acento **azul** (`blue-600`) para el paso
activo; **verde/emerald** para estados de éxito (archivo cargado); botón
primario **negro** (`neutral-900`); zonas de carga con borde punteado y
arrastrar-y-soltar; mucho espacio en blanco, tono simple y amable (el usuario no
es contador). Componentes reutilizables en `src/components/wizard/`
(`Stepper`, `UploadZone`, íconos SVG inline).

### Wizard de conciliación (flujo real)

Ruta protegida `/wizard` → contenedor multi-paso en `src/components/wizard/`
(Paso 1 cargar/parsear datos · Paso 2 mapear columnas · Paso 3 confirmar y
disparar). Ya es el flujo real con SheetJS (import dinámico), normalización
canónica al contrato y `POST /api/conciliacion/iniciar`. El mockup original
(`interfaz.jpg`) sigue siendo la referencia de diseño.

## Estado por fases

- [x] **Fase 1 — Fundaciones:** Next.js + TS estricto + Tailwind, clientes
  Supabase (anon/server/admin), migraciones + RLS, contrato zod, `.env.example`,
  Vitest, este `CLAUDE.md`.
- [x] **Fase 2 — Auth + empresa + cuentas:** registro/login (Supabase Auth
  email+password), registro server-side que crea empresa + membresía admin con
  `service_role` (rollback si falla), middleware de protección (rutas
  `/dashboard`, `/cuentas`), área autenticada con nav + logout, CRUD de cuentas
  bancarias vía server actions. **Verificado en runtime** contra Supabase
  self-hosted: registro (201), login, RLS con y sin sesión, todo OK.
- [x] **Fase 3 — Wizard paso 1:** parsing Excel/CSV (SheetJS), detección
  heurística de columnas, resúmenes (registros/suma/rango de fechas), aviso de
  coherencia de período, plantilla Excel descargable + importación a
  `comprobantes` (server action + RLS), fuente de internos (archivo /
  comprobantes / sistema[próximamente]). Wizard movido al área protegida.
  Funciones puras con tests (normalización fechas/montos, detección,
  coherencia). **Nota Fase 7:** cargar SheetJS con `dynamic import` (el wizard
  pesa ~147 kB) y revisar el aviso de seguridad de `xlsx@0.18.5`.
- [x] **Fase 4 — Wizard paso 2:** wizard multi-paso (contenedor con estado
  compartido, Pasos 1→2→3), mapeo editable por dropdowns con vista previa
  interpretada en vivo, memoria de formatos en `cuentas_bancarias.mapeo_columnas`
  (autoaplica si los encabezados coinciden), normalización canónica a las formas
  del contrato (`RegistroInterno[]` / `MovimientoBancario[]`) con la convención
  de signos única. Fuente "comprobantes" → filas canónicas desde la tabla.
  Tests de normalización canónica + integración con el contrato.
- [x] **Fase 5 — Wizard paso 3 + backend:** `POST /api/conciliacion/iniciar`
  (auth, validación zod del contrato, genera `job_id`, inserta el job,
  idempotencia por cuenta+período con estado activo, dispara el webhook de n8n
  con token, compara conteos). Callback protegido por token
  (`/api/webhooks/resultado-conciliacion`). Pantalla `/conciliacion/[jobId]` con
  progreso en vivo por **Supabase Realtime** (migración `0003_realtime.sql`).
  **Requiere** aplicar `0003` en la BD para que el Realtime funcione.
- [x] **Fase 6 — Resultados + revisión humana:** vista de dos paneles con
  resaltado de pares, etiqueta de método siempre visible (Exacta/Difusa/IA%/
  Manual), cola de sugerencias de IA (Aceptar/Rechazar), conciliación manual por
  selección, **persistencia de cada decisión** en `resultado` (usuario +
  timestamp, en `matches[].decisiones`), exportación a Excel (3 hojas),
  historial en `/conciliacion`. Ajuste de saldo: autodetección del saldo final
  del extracto (columna saldo/balance) + fallback inicial+suma + aviso.
  `MetodoMatch` extendido con `manual`.
- [x] **Fase 7 — Endurecimiento:** `xlsx` a 0.20.3 (parcheado, vía CDN de
  SheetJS) y cargado con **import() dinámico** (bundle wizard 320→182 kB,
  resultados 316→177 kB). `vitest` a v4 (elimina la vuln crítica + cadena
  vite/esbuild). Límite de tamaño de arrays en el endpoint. Manejo de errores de
  red en el wizard. Accesibilidad (aria-labels). Tests de saldo y export
  (35 total). **Pendiente aceptado:** 3 vulns high build-time de Next
  (`next`/`postcss`/`sharp`); resolver en una actualización planificada de
  Next.js para no arriesgar el MVP.
- [x] **Fase 8 — IA reforzada + configuración + reportes analíticos (post-MVP):**
  (1) **Etapa de candidatos** antes de la IA (blocking + score + top-K), con la
  IA como árbitro sobre la shortlist (heurístico `03_ia.js` y LLM vía **AI Agent**
  `ia_llm_01/02`). (2) **Agrupación 1:N / N:1** (subset-sum, `03a_agrupacion.js`).
  (3) **Configuración por empresa** (`/configuracion`, migración `0004`).
  (4) **Few-shot dinámico**: las decisiones humanas alimentan el prompt de la IA
  (`aprendizaje.ts`). (5) **Reportes** ampliados: por tipo de diferencia,
  drill-down por método/tipo con categoría, y panel de aprendizaje en
  reportes+dashboard. (6) Fix de la pantalla de progreso (polling de respaldo al
  Realtime). (7) Retirados el simulador local (`N8N_MOCK`/`lib/n8n/mock.ts`) y
  los libs de matching (`src/lib/matching/*`) con sus tests: los nodos `n8n/*.js`
  quedan como **fuente única** del motor. La agrupación 1:N exige **coincidencia
  de nombre** (≥1 palabra) además de suma exacta. Tests restantes (52) +
  typecheck en verde.

### Módulos adicionales (post-MVP)

- **Configuración** (`/configuracion`): pantalla donde cada empresa ajusta las
  tolerancias y umbrales del motor. Se guardan en `empresas.config_conciliacion`
  (JSONB) vía server action (validada con el zod de `config.ts`, RLS por
  empresa) y se inyectan en cada `payload.config` al iniciar. Campos:
  `tolerancia_monto_abs`, `tolerancia_monto_pct`, `tolerancia_dias`,
  `tolerancia_ia_monto` (banda de monto para candidatos IA), `ventana_ia_dias`
  (ventana de fecha amplia para IA/agrupación), `top_k_candidatos` (cuántos
  candidatos ve la IA por registro), `max_combinacion` (tamaño máx. de un grupo
  1:N), `umbral_confianza_auto`. **Requiere** la columna
  `empresas.config_conciliacion` (migración `0004`).

- **Reportes** (`/reportes`): panel para clientes con KPIs (conciliaciones,
  registros, % automatización, % cuadre), tendencia mensual, distribución por
  método (paleta categórica validada para daltonismo — Okabe-Ito) y desglose
  por banco. Filtros por año/mes/banco/cuenta (vía searchParams). Exportable a
  Excel. Agregación pura en `src/lib/reportes.ts` (con tests). Lee los JSONB
  `resultado` de los jobs completados, **deduplicando** por período+cuenta (la
  corrida más reciente; el historial conserva todas). Incluye:
  - **Distribución por método** → cada método **enlaza a un detalle** por
    registro (`/reportes/[metodo]`: exacta/difusa/ia/sin-conciliar) con columnas,
    estado, **categoría** y observación, también exportable — resuelve los ids de
    `resultado.matches` contra `payload_entrada`.
  - **Tipo de diferencia** (reason codes): distribución de pares conciliados por
    categoría (`comision_bancaria`, `pago_parcial`, `diferencia_temporal`,
    `diferencia_moneda`, `redondeo`, `agrupacion_1aN`, `sin_diferencia`, …), con
    **drill-down** por tipo (`/reportes/tipo/[categoria]`), exportable.
  - **Panel "Aprendizaje de la IA"**: cuántos ejemplos (few-shot) alimentan cada
    conciliación y el balance aceptados/rechazados del pool. Versión compacta y
    enlazable también en `/dashboard`. Ver nota de arquitectura abajo.

## Nota de arquitectura: aprendizaje de la IA (few-shot dinámico)

**El aprendizaje NO usa base de datos vectorial ni reentrena/fine-tunea ningún
modelo.** El LLM es siempre el mismo y no "recuerda" nada por su cuenta entre
corridas. Lo que aprende vive como **texto en el prompt** (in-context learning):

1. Cada decisión humana (aceptar / rechazar / modificar / conciliar manual) se
   persiste en `resultado.matches[].decisiones` (usuario + timestamp). Nunca se
   pierde ninguna — es la materia prima del ciclo.
2. Al iniciar una conciliación, el backend (`src/lib/aprendizaje.ts`) lee los
   **últimos 30 jobs completados** de la empresa (RLS/empresa), extrae las
   decisiones (aceptado/modificado/manual → positivo; rechazado → negativo), las
   resume en texto corto (`monto · nombre · fecha`), **deduplica, balancea por
   clase (≤6) y limita a 12**.
3. Viajan en el payload como `ejemplos_aprendizaje` (opcional en el contrato).
4. El nodo `ia_llm_01_candidatos.js` los pega en el **system prompt** como
   ejemplos few-shot; el LLM calibra el criterio propio de esa empresa (cuánta
   comisión toleran, cuándo rechazan pese a montos iguales).

**Analogía:** cada corrida es como darle al asistente una hoja con "así resolvió
tu jefe los casos dudosos recientes". No cambia el modelo; le das contexto fresco.

**Por qué así:** cero infraestructura nueva, transparente (los ejemplos exactos
quedan en la traza del nodo) y suficiente a esta escala. `pgvector`/semántica
está **fuera del alcance del MVP** a propósito.

**Roadmap (post-MVP):** con cientos/miles de decisiones convendría recuperar los
ejemplos **más *similares*** al caso concreto (embeddings + pgvector) en vez de
los más recientes. La arquitectura ya está lista: solo cambiaría **cómo
`construirEjemplos` selecciona** el subconjunto; el resto del flujo (payload →
prompt) queda igual.

## Notas de arranque (Supabase)

El entorno se conecta después (scaffold-only). Para levantarlo:
`supabase link` (o `supabase start` local) → `supabase db push` para aplicar
`supabase/migrations/`. Copiar `.env.example` a `.env.local` y rellenar keys.

## Comandos

```bash
npm run dev        # desarrollo
npm run build      # build de producción
npm run typecheck  # tsc --noEmit
npm run test       # vitest run
```

**⚠️ No correr `npm run build` con el dev server (`npm run dev`) activo:** ambos
usan la misma carpeta `.next` y el build sobrescribe los chunks del dev,
desincronizando los hashes → la UI se sirve **sin CSS** (HTML crudo). Para
validar cambios con el dev arriba, usar `npm run typecheck` / `npm run test`.
Si la interfaz aparece "desarmada", el arreglo es: parar dev → borrar `.next`
→ `npm run dev` → refresh forzado (Ctrl+Shift+R).
