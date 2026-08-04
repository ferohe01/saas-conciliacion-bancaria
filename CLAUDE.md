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
    cicloContable.ts       Estados contables, transiciones y qué mueve saldo.
    filtrosComprobantes.ts Filtros de comprobantes (tipo/estado/período/busca).
    filtrosSaldo.ts        Filtros de las vistas de saldo (tramo, vencido).
n8n/                       ⭐ Motor de conciliación: nodos Code (fuente única)
                           + workflows importables (build_*.mjs).
supabase/
  migrations/
    0001_schema.sql        Tablas.
    0002_rls.sql           Row Level Security (helper es_miembro + políticas).
    0003_realtime.sql      Realtime en jobs_conciliacion (progreso en vivo).
    0004_config_empresa.sql  Columna empresas.config_conciliacion (JSONB).
    0005_plan_empresa.sql    Período de prueba (plan, prueba_hasta) + GRANT
                             por columna que impide auto-activarse el plan.
    0006_datos_registro.sql  Ficha de empresa (region, provincia, direccion,
                             telefono) y del administrador (nombre_completo,
                             telefono en usuarios_empresa).
    0012_versiones_conciliacion.sql  estado_contable, version, aprobación +
                             constraint de exclusión (una sola aprobada por
                             cuenta y rango solapado).
    0013_aprobar_conciliacion.sql    Aprobar/anular como funciones atómicas.
    0014_guardas_estados_terminales.sql  Cierra dos huecos de la 0013.
    0015_saldo_no_negativo.sql       Quita el clamp del trigger de saldo y
                             añade check (saldo >= 0).
    0016_reversiones_cobro.sql       Anular un cobro suelto sin tumbar la
                             conciliación.
    0017_conexiones_erp.sql          Ficha del sistema de facturación del
                             cliente ("Conectar sistema"). SIN credenciales.
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
JSON), pegar el `service_role` en el nodo "Actualizar Supabase" y **seleccionar
la credencial Header Auth del nodo Webhook** (`x-n8n-token` = `N8N_WEBHOOK_TOKEN`;
el nodo declara `authentication: "headerAuth"`, pero la credencial tampoco viaja
en el JSON — sin seleccionarla el webhook queda **abierto a cualquiera**). El backend
**siempre** dispara n8n real (no hay simulador local). Los nodos `n8n/*.js` son la
**fuente única** del motor: no hay implementación paralela en la app. Todo cambio
de lógica de conciliación se hace ahí y se verifica **end-to-end** en n8n (los
nodos Code no se testean unitariamente en el repo). Regla al editar: mantener la
forma de salida de cada nodo (`job_id`, `metadata`, `config`, `matches`,
`pendientes_*`) para no romper el nodo siguiente.

## Comprobantes: cuentas por cobrar (Fase A)

`comprobantes` dejó de ser solo materia prima de entrada. Antes se conciliaba y
**nada volvía**: la factura casaba con un depósito, la persona lo confirmaba, y
el comprobante no se enteraba. Ahora el bucle está cerrado.

- **`saldo`** es la verdad; **`estado`** (pendiente/parcial/cobrado/anulado) es
  una columna **generada** a partir de él. Un estado que se actualizara por
  separado acabaría contradiciendo al saldo.
- **`aplicaciones_cobro`** (N:N) registra qué movimiento pagó qué comprobante.
  Tabla y no columna porque un comprobante puede cobrarse en varios depósitos
  (pago parcial) y un depósito puede cubrir varios comprobantes (la agrupación
  1:N que el motor ya detecta).
- **El saldo lo mantiene un trigger en la base**, no la aplicación: cualquier
  camino que escriba aplicaciones queda igual de correcto.
- **El puente es `RegistroInterno.comprobante_id`** en el payload. El `resultado`
  de n8n solo referencia `id_interno` (sintético, "REG-0007"), así que sin ese
  campo no habría forma de volver del match al comprobante.
- Reparto en `src/lib/cobranzas.ts` (puro, con tests): se aplica lo que entró
  por banco en proporción al peso de cada comprobante, con tope en su importe.
- Al confirmar decisiones se **reemplaza** el conjunto de aplicaciones del job,
  no se suma: así deshacer una aceptación devuelve el saldo solo.

**Qué descuenta saldo** (`ESTADOS_CONFIRMADOS`): `auto`, `aceptado` y
`modificado`. Quedan fuera `pendiente` y `rechazado`.

`auto` es lo que emiten los nodos del motor (`01_exacta.js`, `02_difusa.js`,
`03_ia.js` por encima de `umbral_confianza_auto`) y **cuenta**: exigir un clic
humano en cada match exacto vaciaría de sentido el producto. Una sugerencia
`pendiente` **no cobra nada** hasta que alguien la aprueba.

⚠️ Esta lista se lee del enum `EstadoRevision` y de los nodos de n8n, nunca se
deduce de los nombres: la primera versión omitió `auto` y dejó 29 de 33 pares
conciliados sin descontar saldo. `manual` es un **método**, no un estado.

## Período de prueba (30 días)

La promesa comercial "tu primer período es gratis" vivía solo como texto en la
portada. Desde la migración `0005` es real:

- Cada empresa nace con `plan='prueba'` y `prueba_hasta = created_at + 30 días`.
- Al vencer, la empresa **conserva todo el acceso de lectura** (historial,
  resultados, reportes, cuentas, configuración) y pierde **una sola**
  capacidad: iniciar una conciliación nueva.
- Criterio en `src/lib/suscripcion.ts` (puro, con tests). Un `plan` desconocido
  se degrada a `'prueba'`, nunca a acceso libre; una fecha ausente **no**
  bloquea (el coste de un falso bloqueo supera al de una prueba de más).
- **El control se hace cumplir en el servidor**, en
  `POST /api/conciliacion/iniciar` (403 `prueba_vencida`). La interfaz además lo
  explica y no carga el wizard, pero ocultar un botón no es un control.
- **`plan` y `prueba_hasta` NO son escribibles por el usuario.** La política
  `empresas_update` autoriza por fila, no por columna, así que `0005` revoca el
  UPDATE amplio y lo reconcede solo sobre `nombre`, `ruc` y
  `config_conciliacion`. Sin ese GRANT el usuario se auto-activaría con la key
  `anon`.
- Extender o convertir a cliente de pago es un UPDATE con `service_role`
  (ver comentario al pie de `0005`). No hay pasarela de pago: sigue fuera de
  alcance.
- ⚠️ `CONTACTO_SUSCRIPCION` en `suscripcion.ts` es un **placeholder**: hay que
  cambiarlo por el canal comercial real.

## Ciclo de vida contable de una conciliación

`jobs_conciliacion` lleva **dos ejes de estado, ortogonales a propósito**:

- **`estado`** — el procesamiento en n8n: `pendiente | procesando | completado
  | error`.
- **`estado_contable`** — el documento: `borrador | en_proceso | observada |
  aprobada | anulada | reemplazada`.

Un job puede estar `completado` y contablemente ser `borrador`, o estar
`aprobada` mientras se reprocesa una corrección. En una sola columna esos
estados serían inexpresables. Reglas en `src/lib/cicloContable.ts` (puro, con
tests); `anulada` y `reemplazada` son **terminales**.

**La regla central la impone la base, no la aplicación:** un `EXCLUDE USING
gist` impide dos conciliaciones **aprobadas** cuyos rangos se solapen en la
misma cuenta. Los cortes consecutivos (1-10, 11-20, 21-31) conviven porque no se
solapan; varias corridas del mismo rango también, pero solo una rige. Vale para
cualquier escritura, venga de la app, de n8n o de un `psql`.

Aprobar y anular son **funciones de la base** (`0013`, endurecidas en `0014`),
no dos UPDATE sueltos desde la app: aprobar implica degradar a `reemplazada` las
aprobadas solapadas y borrar sus aplicaciones de cobro, y hacerlo por partes
dejaría una ventana sin conciliación vigente. Solo `service_role` puede
ejecutarlas.

⚠️ **Solo la conciliación APROBADA cuenta**: mueve el saldo de los
comprobantes, y es la única que suman el panel y los reportes. Un borrador con
decisiones confirmadas no mueve un céntimo. El panel avisa cuando hay
conciliaciones terminadas sin aprobar, porque si no parecería que se perdieron.

## Que una factura no se cobre dos veces

Dos cuentas bancarias con el mismo período pueden estar ambas aprobadas —son
extractos distintos— pero los comprobantes **no pertenecen a ninguna cuenta**,
así que la misma factura entraba en las dos y se descontaba su importe completo
dos veces. Tres capas, y ninguna sobra:

1. **El wizard** no ofrece comprobantes `cobrado` ni `anulado` como registros
   internos, y dice cuántos dejó fuera.
2. **`calcularAplicaciones`** topa lo aplicado al saldo que le queda al
   comprobante, descontando lo que aplicaron **otros** jobs (no los propios: sus
   aplicaciones se borran y se rehacen al resincronizar).
3. **`0015`** aborta la escritura si aun así algo se pasara.

⚠️ La 0015 tuvo que **quitar el `greatest(..., 0)`** del trigger de la 0008.
Ese clamp no protegía de nada: dejaba el saldo en 0 y el comprobante figurando
como cobrado, con el doble de aplicaciones detrás. Escondía el error justo donde
se habría visto.

## Reversión de un cobro (banco que devuelve)

`reversiones_cobro` (`0016`) permite anular **un cobro concreto** sin tumbar la
conciliación. Tres decisiones que no son obvias:

- **Por aplicación, no por match**: un movimiento puede cubrir varias facturas
  (agrupación 1:N), y rechazar el match revertiría todas.
- **Tabla aparte, no un campo en `aplicaciones_cobro`**: `sincronizarCobranzas`
  borra y rehace las aplicaciones del job en cada cambio de decisión, así que
  una marca ahí dentro se perdería y el cobro revertido volvería solo.
- **No se borra la aplicación**: se conservan las dos caras. El saldo pasa a ser
  `importe − (aplicado − revertido)`.

## Conectar sistema (la pantalla existe antes que el motor)

`/conexiones` recoge qué sistema de facturación usa la empresa. **La
sincronización NO está construida**: no hay integrador, ni cron, ni llamada
saliente a ningún ERP. La pantalla se publicó igualmente porque hace dos cosas
reales —saber qué sistemas usan los clientes, que es lo que decidirá por dónde
integrar, y validar el flujo con usuarios— y porque el "próximamente" del wizard
era un cartel sin puerta detrás.

- **No se guardan credenciales.** Ni API key, ni contraseña, ni token. Sin motor
  que las use no aportan nada y sí crean un pasivo: quedarían en claro en
  Postgres, en los `pg_dumpall` diarios y en los snapshots del VPS, legibles por
  cualquier miembro de la empresa vía RLS. El formulario lo dice en voz alta,
  para que nadie pegue su clave en el campo de notas.
- **`estado` no lo escribe el usuario** (`registrada | en_preparacion | activa |
  pausada`). Mismo cierre que `plan` en `0005` y los módulos en `0009`: RLS
  autoriza por fila, no por columna, así que `0017` revoca el UPDATE amplio y lo
  reconcede solo sobre lo que el cliente declara. Sin eso, un `update ... set
  estado='activa'` con la key `anon` haría que la interfaz anunciara una
  sincronización inexistente.
- **Una fila por empresa** (`empresa_id` es la PK): una PyME factura en un
  sistema, no en tres. Guardar es un insert o un update explícito, **no un
  `upsert`** — su `ON CONFLICT DO UPDATE` tocaría `empresa_id` y
  `solicitado_por`, que no están en el GRANT de UPDATE.
- **El botón "Probar conexión" no miente:** dice que la prueba real no existe
  todavía y revisa solo lo que sí depende del usuario (qué sistema, con quién
  coordinar, dónde vive la API). Un tilde verde falso ahí vale una llamada de
  soporte por cliente.
- El catálogo de sistemas vive en `src/lib/conexiones.ts`, **no en la BD**:
  cambia con el mercado, no con el esquema (por eso la columna `sistema` no
  lleva check de valores). El zod está aparte en `conexiones-schema.ts` para no
  arrastrarlo al bundle del formulario.
- En el wizard, "Conectar sistema" **sigue deshabilitada**: no puede producir
  registros. Lo que se añadió es el enlace a `/conexiones` y, si ya hay ficha,
  qué sistema se registró y en qué estado.

## Fuera de alcance del MVP

Equipos/roles/invitaciones/SSO · facturación y pagos (cobro, planes, pasarela —
el límite de prueba de `0005` no es facturación) · pgvector/semántica ·
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

**Origen de los registros internos: dos opciones, no tres.** "Subir archivo"
existió como prueba de concepto y **se retiró**. Conciliaba igual y se veía
idéntico en pantalla, pero los registros no tenían `comprobante_id`, así que
ningún comprobante quedaba cobrado y el saldo no se movía nunca: el error
silencioso más caro del producto (por eso hubo que poner un aviso en azul para
disuadir de usarlo — mejor no ofrecerlo). Quedan **"Usar mis comprobantes"**
(única fuente activa, la que cierra el bucle de cobranzas) y **"Conectar
sistema"** (próximamente). El **extracto bancario se sigue subiendo como
archivo** (Excel/CSV/PDF): eso no cambió y es otra cosa. En consecuencia, el
Paso 2 solo mapea el extracto y `cuentas_bancarias.mapeo_columnas.internos`
quedó huérfana (no se lee ni se escribe; el merge conserva lo antiguo).

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
  comprobantes / sistema[próximamente] — la de archivo se retiró después, ver
  "Wizard de conciliación"). Wizard movido al área protegida.
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
- [x] **Fase 9 — Ciclo de vida contable (post-MVP):** (A) migración `0012` con
  `estado_contable`, `version`, `conciliacion_origen_id` y el constraint de
  exclusión; arreglado de paso un bug latente de los reportes, que deduplicaban
  por `cuenta|año|mes` y descartaban en silencio los cortes parciales de un mes.
  (B) aprobar/observar/anular en la UI, con las transiciones como funciones
  atómicas de la base (`0013`, `0014`) y el saldo atado a la **aprobación** en
  vez de a las decisiones. (C) panel y reportes solo sobre lo aprobado, con
  filtros de ejercicio/mes/banco/cuenta y aviso de lo terminado sin aprobar.
- [x] **Fase 10 — Cobranzas endurecidas:** filtros propios en Comprobantes
  (tipo/estado/período/buscador) y en Por cobrar / Por pagar (tramo de
  antigüedad, solo vencido, buscador) — deliberadamente **no** los del panel,
  porque un comprobante no pertenece a ninguna cuenta bancaria. Aviso en el
  wizard cuando hay comprobantes del período y se va a subir un archivo
  (obsoleto: la fuente "Subir archivo" se retiró después). Las tres capas contra
  el doble cobro (`0015`). Reversión de un cobro suelto con ficha del
  comprobante en `/comprobantes/[id]` (`0016`). 178 tests.
- [x] **Fase 11 — Un solo origen de registros internos + Conectar sistema:**
  retirada la fuente "Subir archivo" del wizard (quedan "Usar mis comprobantes"
  y "Conectar sistema"), con el Paso 2 mapeando ya solo el extracto. Nueva
  pantalla `/conexiones` + migración `0017`: ficha del sistema de facturación
  del cliente, sin credenciales y sin motor de sincronización todavía (ver
  "Conectar sistema"). 198 tests.

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

## Despliegue en producción (VPS Contabo + Dokploy)

Todo corre en un único VPS (`95.111.245.187`) orquestado por **Dokploy**, con
Traefik terminando TLS (Let's Encrypt) delante de cada servicio:

| Servicio | Dominio | Notas |
|---|---|---|
| App (esta) | `conciliacion.fernandorh.com` | Application, build **Dockerfile**, puerto 3000 |
| Supabase | `supabase.fernandorh.com` | Compose; solo se expone `kong` (8000) |
| n8n | `n8npucp.fernandorh.com` | Webhook de producción `/webhook/conciliaciones` |

- **Imagen:** `Dockerfile` multi-etapa sobre `node:22-alpine`, `output:
  "standalone"` en `next.config.mjs`, usuario no-root. `/api/health` existe para
  el health check y el rollback automático de Dokploy.
- **⚠️ Las `NEXT_PUBLIC_*` se incrustan en build-time**, así que van **dos
  veces** en Dokploy: en *Environment* (runtime) y en *Build Time Arguments*.
  Solo en runtime → el bundle sale con `createBrowserClient("","")` y el login
  falla en el navegador aunque el servidor no dé ningún error. El resto de
  variables (`SUPABASE_SERVICE_ROLE_KEY`, `N8N_WEBHOOK_TOKEN`) **nunca** como
  build arg: quedarían en las capas de la imagen.
- **Migraciones:** `supabase db push` **no aplica** — Supabase es self-hosted y
  el repo no es un proyecto de CLI (no hay `config.toml`). Se aplica
  `supabase/apply_all.sql` desde el SQL Editor de Studio o por `psql`. El script
  es re-ejecutable.
- **Supabase debe ir por HTTPS**: con la app en HTTPS, un Supabase en `http://`
  queda bloqueado por mixed content. Sus propias variables `API_EXTERNAL_URL`,
  `SUPABASE_PUBLIC_URL` y `SITE_URL` deben apuntar a los dominios definitivos.

### Backups

Dos capas, complementarias:

- **Auto Backup de instancia (Contabo)** — snapshot del VPS entero. Cubre la
  pérdida total del servidor **incluyendo n8n (workflows y credenciales),
  Dokploy y Traefik**, que ningún dump de Postgres se lleva. No permite
  recuperación granular y vive en la misma cuenta que el servidor.
- **`ops/backup-supabase.sh`** — `pg_dumpall` diario con rotación y subida a un
  bucket externo (cron a las 3:00 en el VPS; el script no lo usa la app). Cubre
  lo que el snapshot no: "recupera solo esta tabla", el error detectado tarde, y
  la independencia del proveedor. Usa **`pg_dumpall`, no `pg_dump`**: sin el
  esquema `auth` se restauran los datos pero nadie puede iniciar sesión.

Un backup no probado no es un backup. **Procedimiento de restauración verificado
en `ops/RESTAURAR.md`** — con una trampa que cuesta cara: restaurar sobre un
Supabase recién desplegado deja `auth.users` **vacío** (su init crea un esquema
`auth` más antiguo y el `COPY` del dump falla), así que vuelven los datos pero
nadie puede iniciar sesión. Hay que soltar `auth` y `storage` antes de restaurar,
y restaurar como `supabase_admin`, no como `postgres`.

Estado: instalado en el VPS (`/usr/local/bin/backup-supabase.sh`, cron 3:00,
`/opt/backups/supabase`, 14 días de rotación). **`RCLONE_REMOTE` está vacío**:
los dumps solo viven en el VPS hasta que se configure el bucket externo.

### Pendientes conocidos en producción

- **Realtime devuelve 403** en el handshake WebSocket (preexistente al
  despliegue; ocurría igual con el host anterior). Kong autentica bien y es el
  servicio Realtime quien rechaza. La pantalla de progreso funciona igualmente
  por el polling de respaldo de `ProgresoConciliacion.tsx`. Diagnóstico
  pendiente con los logs del contenedor `realtime`.
- Las 3 vulnerabilidades *high* de build-time de Next siguen aceptadas (ver
  Fase 7).

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
