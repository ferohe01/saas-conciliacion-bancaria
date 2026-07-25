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

### Las 4 capas de conciliación (contexto; corren en n8n)

1. Match exacto (monto + ID de pago).
2. Matching difuso/heurístico con tolerancias.
3. IA con score de confianza que **propone** matches.
4. Revisión humana en la interfaz.

La IA nunca concilia sola por debajo del `umbral_confianza_auto`.

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
      config.ts            Tolerancias por request + defaults.
      payload.ts           JSON de ENTRADA hacia n8n (§7.2).
      resultado.ts         Estructura de `resultado` desde n8n (§7.3).
      index.ts             Re-exports.
supabase/
  migrations/
    0001_schema.sql        Tablas.
    0002_rls.sql           Row Level Security (helper es_miembro + políticas).
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
| `N8N_MOCK` | servidor | `true` → simulador local de n8n (desarrollo) |
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
  `resultado`, con usuario y timestamp. Es la materia prima del futuro ciclo de
  aprendizaje de la IA — no perder ninguna.

Esquemas exactos: `src/lib/contract/payload.ts` y `resultado.ts`.

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

### Prototipo visual (temporal)

Ruta `/wizard` → `src/components/wizard/Paso1CargarDatos.tsx`. Reproduce el
mockup con interacción local (sin backend ni parsing). En la Fase 3 pasa a ser
el flujo real con datos de Supabase y SheetJS.

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
  idempotencia por cuenta+período con estado activo, dispara mock o webhook real
  según `N8N_MOCK`, compara conteos). Mock de n8n (`lib/n8n/mock.ts`) con matcher
  exacto/difuso/IA que actualiza el job por fases. Callback protegido por token
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
