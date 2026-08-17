# CLAUDE.md — Conciliación Bancaria (SaaS para PyMEs · Perú)

Guía para agentes y desarrolladores que trabajen en este repo. Léela antes de
tocar código.

## Qué es esto

Interfaz web + backend delgado + base de datos para un SaaS de **conciliación
bancaria asistida por IA** dirigido a **empresas peruanas de cualquier tamaño**,
de la pequeña que emite 50 comprobantes al mes a la que mueve cientos de miles.
El usuario **puede no ser contador de profesión**, así que la UI es guiada, en
español (es-PE) y con lenguaje simple — eso no cambia con el tamaño.

⚠️ Nació apuntando solo a PyMEs y esa suposición se coló en la portada, en los
metadatos y en el prompt del asistente. **La diferencia entre segmentos no es de
discurso: vive en `empresas.modo_carga` (`0040`)** — plantilla obligatoria por
defecto, formato propio para quien exporta de un ERP. Al escribir texto nuevo,
no volver a estrechar el público: lo que distingue a un cliente de otro es cómo
carga sus datos y cuánto volumen mueve, no su tamaño en abstracto.

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

1. Match exacto (monto + ID de pago). ⚠️ El **respaldo por `monto + fecha`
   nunca empareja contra una referencia que se contradice**: existe para datos
   SIN referencia (ventas al contado, extractos que no la traen), y cuando los
   dos lados la traen y no coinciden son operaciones distintas. A escala esto no
   es teórico — con cientos de recibos de S/ 99 el mismo día casó **541 pares
   con códigos de operación sin relación, marcados `auto`**, o sea conciliados
   sin que nadie los mirara. Y cada match falso se lleva el movimiento que le
   tocaba al recibo legítimo: el error se propaga e infla el descuadre.
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

⚠️ **El prefiltro de identidad de la agrupación acepta REFERENCIA o nombre**, no
solo nombre. Exigir nombre siempre parecía prudente hasta que apareció una cuenta
recaudadora: los recibos llegan **sin contraparte** y lo que comparten los que se
pagaron juntos es el **código de operación**. Con el prefiltro anterior la capa
no podía agrupar nada — y eran justo los ~490 casos 1:N que había que conciliar,
el 4% del período y S/ 120.000 de descuadre. Lo que no se toca es que **tiene que
haber alguna identidad compartida**: sin prefiltro, un subset-sum empareja
partidas sin relación cuya suma cuadra por azar y el resultado parece correcto.
Hay tests de las dos caras en `tests/n8nNodos.test.ts`.

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
    0018_comprobantes_sin_duplicados.sql  Índice único por serie + lote de
                             importación (deshacer una carga).
    0042_referencia_prefijo_entidad.sql  `ref_norm` descarta el prefijo de
                             entidad (WIN-S001-123 ≡ S001-123).
    0043_origen_partidas.sql         Ficha de cada carga + la cascada
                             archivo → comprobantes → internos, congelada.
    0050_posicion_caja.sql           Saldo, entradas y salidas por cuenta desde
                             las conciliaciones APROBADAS (pantalla `/caja`).
    0051_extractos_cargados.sql      Ficha de cada carga de extracto; `origen`
                             separa lo subido para conciliar de lo subido para
                             ver el saldo de hoy.
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

#### El flujo que está conectado a este sistema

> **`Conciliación Bancaria con IA`** — ese es el nombre exacto en n8n, y es el
> único que existe: el heurístico se borró (05/08/2026). El path del webhook
> sigue siendo `conciliaciones`.

Topología en producción, verificada contra el lienzo de n8n:

```
Webhook → Responder aceptado → Exacta → Difusa → Agrupacion → Candidatos IA
        → AI Agent → Parsear IA → Ensamblar resultado → Actualizar Supabase
                ↑
       OpenAI Chat Model  (sub-nodo por ai_languageModel)
```

**El modelo es OpenAI y el generador también lo emite** (`lmChatOpenAi`, por
defecto `gpt-5.6-luna`). Hubo una divergencia —el generador emitía Anthropic
mientras producción usaba OpenAI, así que reimportar sustituía el nodo sin
avisar— y se cerró alineando el repo con el despliegue. `ia_llm_02_parsear.js`
entiende las dos formas de respuesta, así que cambiar de proveedor no rompe el
parseo.

Tras importar siguen sin viajar en el JSON, y hay que ponerlos a mano: la
**credencial de OpenAI**, el **modelo** (confirmar que `gpt-4o-mini` sirve), el
`service_role` del nodo "Actualizar Supabase" y la **credencial Header Auth** del
Webhook. Importar además **crea un workflow nuevo**, no actualiza el existente:
quedarían dos con el mismo nombre y hay que borrar el viejo.

Regenerar: `node n8n/build_workflow.mjs && node n8n/build_workflow_ia.mjs`. Tras
reimportar, hay que **reseleccionar la credencial del modelo** (no viaja en el
JSON), pegar el `service_role` en el nodo "Actualizar Supabase" y **seleccionar
la credencial Header Auth del nodo Webhook** (`x-n8n-token` = `N8N_WEBHOOK_TOKEN`;
el nodo declara `authentication: "headerAuth"`, pero la credencial tampoco viaja
en el JSON). El backend
**siempre** dispara n8n real (no hay simulador local). Los nodos `n8n/*.js` son la
**fuente única** del motor: no hay implementación paralela en la app. Todo cambio
de lógica de conciliación se hace ahí y se verifica **end-to-end** en n8n (los
nodos Code no se testean unitariamente en el repo). Regla al editar: mantener la
forma de salida de cada nodo (`job_id`, `metadata`, `config`, `matches`,
`pendientes_*`) para no romper el nodo siguiente.

#### ⚠️ El runner de n8n aborta a los 30 s: nada de trabajo por par

`02_difusa.js` llamaba a `comunesEntre(it.contraparte, bc.glosa)` **dentro del
bucle interno**: por cada par hacía `normalize("NFD")` + regex + `toUpperCase` +
`split` + `Set` sobre la MISMA glosa, una vez por cada registro interno. Con
20.000 × 20.000 pendientes son 400 millones de tokenizaciones y n8n corta con
*"Task execution aborted because runner became unresponsive"*.

Arreglo, sin cambiar la semántica:

1. **Precalcular lo que no depende del par** — tokens de cada glosa y
   `Date.parse` de cada fecha, una sola vez.
2. **Indexar por monto redondeado**: la tolerancia acota la banda, así que se
   miran unos pocos cubos en vez de los 20.000 movimientos. Los candidatos se
   ordenan por índice para conservar exactamente el mismo emparejamiento que el
   recorrido secuencial.

Medido con 20.000 × 20.000: **de abortar a los 30 s a 493 ms.**
`ia_llm_01_candidatos.js` tenía el mismo defecto y lleva el mismo precálculo.

**Regla para cualquier nodo Code nuevo:** nada que dependa solo de un lado se
calcula dentro del bucle del otro. A 2.000 partidas no se nota; a 20.000 tumba
el runner, y el error no dice dónde.

⚠️ **`03a_agrupacion.js` cayó en lo mismo, y por partida doble.** Sus tokens sí
estaban precalculados —lección aprendida— pero `dias()` llamaba a `Date.parse`
**dos veces por par**: con 4.382 × 3.204 pendientes son 28 millones de parseos,
y el `.sort()` volvía a llamarlo. Además cada objetivo recorría la lista entera
de candidatos.

El prefiltro exige compartir REFERENCIA o una palabra, así que eso se indexa:
un `Map` por referencia y otro por palabra convierten el recorrido en una
búsqueda. **No cambia la semántica** —el conjunto que sale de los índices es
exactamente el que pasaba el filtro— y para reproducir el mismo orden de empate
los candidatos se reordenan por su posición original antes del criterio de
fecha. Verificado contra la versión anterior: **731 agrupaciones idénticas**,
de 1,33 s a 0,19 s; con el residuo real, 0,05 s.

Moraleja: precalcular los tokens no basta si queda **otra** cosa cara dentro del
bucle. Al optimizar uno de estos nodos hay que mirar TODO lo que se evalúa por
par, no solo lo que se arregló la vez anterior.

#### Un fallo de la IA no puede tumbar la conciliación

El AI Agent llama a un servicio externo: puede caerse, agotar cuota, pasarse de
tiempo o devolver algo raro. Sin protección, cualquiera de esas cosas **mata el
flujo** y no llegan a ejecutarse `Ensamblar resultado` ni `Actualizar Supabase`:
el job se queda en `procesando` para siempre y se pierden los **447.795 pares
que la capa exacta ya había resuelto** — el 99 % del trabajo, tirado porque un
modelo no contestó.

El generador emite el nodo con **`onError: "continueRegularOutput"`** y dos
reintentos. `Parsear IA` reconstruye su estado desde `Candidatos IA`, no del
Agent, así que sin respuesta simplemente no hay adjudicaciones: todo queda
pendiente de revisión humana, que es donde estaba.

**La degradación correcta de una capa opcional es hacer menos, no romper.**

`Actualizar Supabase` sí conserva el fallo —continuar en silencio dejaría el job
creyendo que se guardó— pero reintenta tres veces: un corte de red no debe
costar la corrida.

Hay tests de la cadena entera (`tests/n8nNodos.test.ts`) con el residuo real y
la IA caída: ninguna partida se pierde, el cuadre sale, y una adjudicación sobre
un registro que el modelo no vio se rechaza.

#### ⚠️⚠️ El código de operación peruano es NUMÉRICO, y la IA no lo veía

`esRefToken` exige **una letra y un dígito**. Para extraer códigos de un texto
libre está bien —un número suelto en una glosa puede ser un importe o una
fecha— pero se aplicaba también al **campo** de referencia, que es una
referencia por definición: el usuario lo dijo al mapear esa columna.

Con códigos como `30010182` —los que usa cualquier banco peruano— `comparteRef`
**no se cumplía nunca**, y la etapa de candidatos perdía su único vínculo
fuerte. La regla dice que compartir referencia salta la banda de monto:

    if (!comparteRef && difAbs > tolIa) continue;

Así que toda **retención, detracción o percepción** —que comparte código con su
movimiento y solo difiere en el importe— quedaba fuera de la banda y jamás
llegaba al modelo. Medido con una conciliación real de 233 × 221 partidas: el
LLM recibió **cero shortlists** y contestó, con razón, `{"pares":[]}`.

Desde fuera eso es indistinguible de «la IA miró y no encontró nada», que es lo
que hizo perder el rastro: el nodo estaba verde, el job completaba, y la
conclusión natural era que faltaba credencial o que había que ampliar
`tolerancia_ia_monto`. Ninguna de las dos.

- **El campo de referencia acepta cualquier token de ≥4 caracteres**; la
  extracción desde texto libre conserva la exigencia de letra + dígito, que es
  donde tenía sentido.
- Tras el arreglo, la misma conciliación pasa de **0 a 28 shortlists**, todas con
  `comparte_ref` y score 0,85–0,92.
- ⚠️ No afecta a la capa exacta ni a la agrupación: las dos usan `normRef` sobre
  el campo entero, no tokens. Por eso los 163 pares exactos y las 13
  agrupaciones sí salían — y por eso el fallo pasó desapercibido.

#### Y el prompt de la IA no cabía en ningún modelo

`ia_llm_01_candidatos.js` abortó por lo mismo, pero al medirlo apareció algo
peor que la lentitud: con el residuo de una recaudadora —4.382 internos— el
prompt salía de **4,7 MB y ~1,2 MILLONES de tokens**. Ningún modelo lo acepta, y
si lo aceptara costaría una fortuna por conciliación.

La etapa de candidatos se pensó para 2.000 partidas, donde la shortlist entera
cabe en un prompt. A este volumen hay que **elegir qué se le pregunta**:

- Solo los casos con **duda real** (mejor candidato con score ≥ 0,35) y como
  mucho `max_consultas_ia` (150 por defecto), ordenados por score.
- Los demás quedan **sin conciliar**, que es exactamente donde estaban: la
  inmensa mayoría no tiene ningún candidato plausible —son recibos cobrados por
  otro banco— y preguntárselo al modelo no aporta nada.
- El nodo devuelve `shortlists_omitidas`. Callarlo daría a entender que la IA
  los revisó y no encontró nada.
- ⚠️ `shortlists` pasa al nodo de parseo **ya recortado**: valida la respuesta
  contra lo que el modelo vio de verdad. Aceptar una adjudicación sobre algo que
  no se le mostró sería aceptar una invención.

Además, dos micro-optimizaciones con efecto grande: índices por token de
referencia y por palabra (como en la agrupación), y el Jaccard calculado como
`|A| + |B| − |A∩B|` en vez de construir la unión —que era un `Set` nuevo por
cada uno de los 14 millones de pares—. Con datos como los del cliente: **de
1,50 s a 0,03 s**, y el prompt de 266 KB a 54 KB.

#### Los nodos `.js` no los revisaba nada — ahora sí (mínimo)

Son la **fuente única** del motor pero viven fuera del typecheck (son `.js`
sueltos) y no se ejecutan en los tests: se verifican end-to-end en n8n. Resultado
real: un `].join("` con un **salto de línea crudo dentro del string** quedó
commiteado sin que nada lo detectara. Reimportar habría dejado el nodo muerto, y
el fallo habría salido en mitad de una conciliación de 20.000 registros.

`tests/n8nNodos.test.ts` cubre lo mínimo indispensable:

1. **`node --check`** sobre cada `.js`: que sea JavaScript válido.
2. Que **el JSON generado coincida con los `.js`**: si alguien edita un nodo y
   olvida regenerar, el importable queda desfasado — y es el JSON lo que se sube.

No prueba la lógica del motor; eso sigue siendo end-to-end en n8n. Prueba que el
archivo no esté roto, que es justo lo que faltaba.

#### ⚠️ n8n no re-registra el webhook al guardar: hay que reiniciar el contenedor

Costó una tarde entera de depuración, así que queda escrito.

Editar el nodo, guardar el workflow, desactivarlo y volver a activarlo **no basta**:
los cambios se guardan en la base de n8n, pero la ruta viva sigue sirviendo la
definición con la que se registró el webhook al arrancar. El síntoma es
desconcertante porque **todo lo que haces en el editor parece no existir** — y
lleva a repetir el mismo arreglo cinco veces creyendo que se hace mal.

**El arreglo es reiniciar el servicio de n8n en Dokploy** (*Redeploy* / *Restart*).
Al arrancar vuelve a leer los workflows activos y registra sus webhooks desde
cero. Guarda primero el flujo como quieras que quede; el reinicio es lo que lo
hace efectivo. (Si el servicio tuviera más de una réplica el problema sería
permanente: una instancia registra y otra atiende. Debe estar en 1.)

#### Cómo se diagnostica desde fuera, sin entrar a n8n

Un `POST` al webhook distingue los tres fallos por su respuesta, sin tocar nada:

| Respuesta | Qué significa |
|---|---|
| `500` · `No authentication data defined on node!` | El nodo Webhook tiene `authentication: headerAuth` **sin credencial asignada**. Rechaza a todo el mundo, con token o sin él. |
| `403` · `Authorization data is wrong!` | Credencial puesta y comparando. Si la app también recibe 403, es que los dos valores del token no coinciden. |
| `200` · `{"status":"accepted", …}` **sin enviar token** | El webhook está **abierto a cualquiera** (`authentication: None`). |
| `404` · `not registered` | El workflow no está activo, o hay otro compitiendo por el mismo path. |

⚠️ Corrección de una creencia anterior de este documento: **un nodo sin credencial
NO deja el webhook abierto** — devuelve 500 a todo. Abierto queda solo si alguien
pone `authentication: None`, que es justo lo que se hace al diagnosticar y lo que
hay que acordarse de deshacer.

**Los dos workflows que genera el repo registran el mismo path `conciliaciones`**,
así que solo uno puede estar activo. Hoy no aplica —en n8n solo queda
`Conciliación Bancaria con IA`—, pero vuelve a aplicar en cuanto se importe el
heurístico: arreglar el que no está activo no cambia nada, y el error observado
es idéntico. Comprobar siempre en cuál se está editando antes de dar por bueno
un arreglo.

El grafo también acota dónde puede fallar: `Responder aceptado` es el **segundo**
nodo y responde antes de que se ejecute nada más. Por tanto un `500` en el POST
solo puede venir del Webhook; si lo que falta es la credencial del modelo
(OpenAI Chat Model), la respuesta es **200** y el trabajo muere después, por dentro —el
job se queda en `procesando` para siempre—. Son dos averías distintas con
síntomas opuestos.

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

## Cargar la plantilla dos veces

`importarComprobantes` insertaba a secas: subir el mismo archivo otra vez creaba
un juego entero de facturas duplicadas. El daño no era estético — cada copia
lleva su propio `saldo`, así que Por cobrar mostraba el doble de deuda y el
wizard ofrecía dos veces la misma factura.

- **La identidad de un comprobante es `(empresa_id, tipo, serie_numero)`**, no
  el monto. Deduplicar por (fecha, monto, contraparte) fusionaría dos boletas
  legítimas del mismo cliente por el mismo importe el mismo día. `tipo` entra en
  la clave porque una cobranza y un pago pueden compartir numeración: son
  documentos de emisores distintos.
- **El índice de `0018` es parcial**: `serie_numero` es opcional (ventas al
  contado sin documento) y sin número no hay identidad que comparar. Esas filas
  se insertan siempre; inventarles una clave descartaría ventas reales.
- **Lo que ya existe se omite, no se actualiza.** Un comprobante puede tener
  cobros aplicados y su `saldo` se calcula desde `monto`: reescribirlo desde una
  plantilla dejaría el saldo mintiendo. La app informa "20 ya estaban cargados".
- Tres filtros en cadena: repetidas dentro del archivo → serie ya en la base →
  índice único como red final. Los dos primeros existen para poder explicarlo;
  el que manda es el tercero. Lógica pura en `src/lib/importacion.ts` (con
  tests).
- ⚠️ **El mensaje de "0 importados" es funcional, no cosmético**: sin decir "ya
  estaban todos", parece que la carga falló y se reintenta — que es exactamente
  como se llega a la tabla duplicada.

**Limpiar lo cargado.** Cada carga marca sus filas con `lote_importacion`, así
que se puede *deshacer esa importación* sin tocar las demás; y `/comprobantes`
tiene un "Empezar de cero" que exige escribir la palabra.

⚠️ **Deshacer solo existía en el instante de subir.** Vivía en el estado del
componente de carga: al recargar la página desaparecía y la única salida era
"Empezar de cero" — que borra TODO y pide escribir una palabra. O sea que quitar
la última carga para volver a subirla, lo más normal del mundo mientras se
preparan los datos, obligaba a borrarlo todo.

`/comprobantes` lista ahora las **Cargas realizadas** (`lotes_importacion`,
migración `0034`), cada una con su fecha, su recuento y su propio "Quitar esta
carga". Sobrevive a la recarga porque sale de la base, no del estado.

- Confirmación en **dos pasos pero sin escribir nada**: quitar una carga es
  reversible volviéndola a subir. La palabra escrita se reserva para "Empezar de
  cero", que se lleva también lo que no se sabe de dónde salió.
- El aviso dice **siempre** cuántos se conservaron por tener cobros aplicados,
  aunque sean cero: omitirlo haría que un "borrados 900 de 1.000" pareciera un
  fallo en vez de la regla.

**Y también desde el wizard.** La tarjeta «Comprobantes del período» del Paso 1
lleva un *Cancelar esta carga*: descubrir ahí que subiste el archivo equivocado
y tener que irte a otra pantalla para arreglarlo es abandonar el flujo a medias.

⚠️ Quita los del **período** —los que la tarjeta acaba de contar— y no "la
última carga", aunque suene menos natural. La tarjeta enseña un número concreto;
si el botón borrara el último lote podría llevarse otra cosa, o solo una parte, y
dejar ahí un número que el usuario no esperaba. **Lo que se ve es lo que se
quita.** Ninguna de las dos
borra un comprobante **con cobros aplicados**: eso se iría en cascada y dejaría
un agujero en una conciliación aprobada, que seguiría diciendo que esa factura
se cobró. Lo conciliado no se limpia, se **anula** (ver `0016`).

## La moneda del comprobante (y por qué NO se convierte)

Un comprobante no decía en qué moneda estaba: se asumía la de la cuenta contra
la que se conciliara. Con un solo cliente en soles no se nota; con el primero
que factura en dólares produce **dos errores que no protestan**:

1. **Un emparejamiento falso.** Una factura de 200 USD y un depósito de
   S/ 200,00 tienen el mismo número, y la capa exacta casa por monto +
   referencia sin mirar nada más. El par sale `auto`, se da por conciliado y
   descuenta el saldo.
2. **Un total sin sentido.** «Te deben 19.221» sumando soles con dólares no
   responde a ninguna pregunta, y nadie puede saber mirándolo que está mal.

`comprobantes.moneda` (`0041`), con `PEN` por defecto.

- ⚠️⚠️ **NO hay conversión, y es deliberado.** El tipo de cambio es otra
  funcionalidad —fuente de la tasa, fecha aplicable, tratamiento contable de la
  diferencia— y hacerla a medias sería peor que no hacerla. Lo que la migración
  garantiza es que **las monedas no se mezclen**.
- **La guarda vive en SQL, no en la pantalla**: `pares_exactos` filtra por la
  moneda de la cuenta y `residuo_internos` también, así que n8n tampoco las
  cruza por monto y fecha una capa más abajo. La firma vieja de `pares_exactos`
  se **elimina** en la misma migración para que nadie la llame sin moneda.
- ⚠️ **El relleno de lo ya cargado usa las cuentas de la empresa**: si todas
  están en la misma moneda, sus comprobantes toman esa; si hay varias, se queda
  el defecto. Inventar una asignación fila a fila sería peor que dejar un dato
  corregible.
- **El Paso 1 dice qué deja fuera** («12 están en otra moneda y no entran: esta
  cuenta es en PEN»), igual que ya hacía con los cobrados. Y el recuento se
  recalcula al cambiar de cuenta.
- **Por cobrar y Por pagar pintan un bloque por moneda** (`agingPorMoneda`), sin
  sumar entre ellas y sin filtrar a una sola —eso escondería el resto—. Con una
  moneda se ve exactamente igual que antes.
- **La moneda se puede declarar para todo el archivo**, como el tipo: un export
  rara vez trae la columna porque todo él está en una.
- ⚠️ El símbolo **`$` no se interpreta**: en Perú se usa tanto para dólares como,
  mal, para soles. Adivinarlo sería elegir por el usuario justo donde el error
  no se ve.
- ⚠️ **Pendiente**: `resumen_ejecutivo` (`0032`) sigue sumando todas las monedas.
  El asistente lo advierte al responder, pero la pantalla `/resumen` todavía no
  las separa.

## Dos clientes, dos formas de cargar (y el modo se declara, no se adivina)

La PyME de 500 facturas al mes las lleva en su propio Excel. Para ella **la
plantilla es mejor producto**: garantiza datos limpios y no la obliga a
distinguir el «número de documento» de la «referencia de operación» —lo que más
se confunde—. Si mapea mal una columna no lo descubre al mapear: lo descubre
cuando la conciliación da 0 %, y entonces culpa al sistema.

La recaudadora de 450.000 movimientos no puede transponer nada a ninguna
plantilla. Exigírsela es cerrarle la puerta.

`empresas.modo_carga` (`0040`) separa los dos casos: **`plantilla` por
defecto**, `archivo_propio` para quien exporta desde un ERP.

- ⚠️⚠️ **El discriminador es la EMPRESA, no el archivo.** La tentación era abrir
  el mapeo «para archivos grandes» y no funciona: la primera prueba del flujo de
  la recaudadora se hizo con **200 filas**, que un umbral habría bloqueado; y
  una PyME que pasa de 4.900 a 5.100 filas cambiaría de flujo de un mes a otro
  sin entender por qué. Un umbral convierte una decisión de producto en una
  lotería.
- ⚠️ **Se hace cumplir en el SERVIDOR.** En modo `plantilla`, la ruta de
  importación ignora cualquier mapeo —de la petición o guardado— y lee con las
  columnas de la plantilla. Ocultar la opción orienta; esto es lo que impide que
  un POST directo cargue columnas elegidas a mano.
- ⚠️ **El rechazo nombra las columnas que faltan** («le faltan monto y tipo») y
  trae el botón de descargar la plantilla al lado. «Este archivo no sirve» deja
  al usuario comparando dos ficheros a mano, y convierte una regla razonable en
  un muro.
- **La opción vive en Configuración, no en el flujo de carga.** Si apareciera al
  fallar una subida, cualquiera la activaría para salir del paso — y acabaría
  eligiendo columnas a mano, que es justo lo que el modo evita. Activarla pide
  confirmación; volver a la plantilla no, porque volver a lo seguro nunca
  necesita advertencia.
- `modoCarga()` degrada a `plantilla` ante cualquier valor desconocido, nunca al
  revés (mismo criterio que `plan` en `suscripcion.ts`).
- ⚠️ La `0040` lleva su `GRANT update`, como toda columna nueva de `empresas`
  desde la `0005`. Se concede al usuario a propósito: quien de verdad exporta
  desde un ERP no debería esperar a que le activen nada. **Si algún día conviene
  que sea decisión comercial, basta con quitar ese grant** — el resto del
  sistema no cambia.

## Subir los comprobantes con el formato del CLIENTE

El sistema trataba los dos lados con criterios opuestos, y al revés de como
conviene:

| | Extracto del banco | Comprobantes (antes) |
|---|---|---|
| Formato | el que traiga | el de la plantilla, exacto |
| Columnas | mapeo + detección | `f["fecha"]` literal |
| Memoria | `cuentas_bancarias.mapeo_columnas` | ninguna |

Al banco nos adaptábamos nosotros; al cliente le pedíamos que se adaptara él.
Y el archivo del banco es el que nadie puede cambiar, mientras que el export de
un ERP tampoco lo elige el usuario: se le exigía justo donde menos margen tiene.

Con 450.000 filas al mes eso no es esfuerzo de alta, es **trabajo recurrente que
nadie repite el segundo mes** — y una columna corrida un puesto da una
conciliación al 0 % que el cliente no atribuye a su copia, sino al producto.

- **Un solo destino, dos caminos que convergen enseguida.** No hay pantalla
  nueva: se sube el archivo y, si las cabeceras no son las de la plantilla,
  aparece «¿qué columna es cada cosa?» con detección previa
  (`deteccionComprobantes.ts`) y vista previa interpretada. Todo lo de después
  —validación, deduplicación por serie, lote, «ya estaban cargados», deshacer—
  es exactamente el mismo código. Bifurcar eso sería bifurcar donde viven los
  bugs caros.
- ⚠️ **Y ocurre DONDE ESTÁ EL USUARIO**, en los dos sitios que cargan
  comprobantes: `/comprobantes` y la tarjeta «Comprobantes del período» del
  Paso 1. La primera versión solo lo ponía en `/comprobantes` y desde el wizard
  mandaba allí a configurar; eso es abandonar el flujo a mitad, y además dejaba
  **dos bloques distintos para cargar comprobantes en la misma pantalla** —la
  tarjeta y el recuadro de la plantilla—, que es exactamente lo que confundía.
  Ahora la plantilla es un enlace dentro de la tarjeta y no hay segundo bloque.
  Mientras se mapea, la tarjeta ocupa el ancho entero: nueve columnas y una
  vista previa no caben en media pantalla.
- **La plantilla deja de ser un mecanismo aparte y pasa a ser un atajo del
  mismo**: sus cabeceras se reconocen y no se pregunta nada. Es menos
  maquinaria, no más.
- ⚠️⚠️ **Esto NO resucita el «Subir archivo» del wizard.** Aquello se retiró
  porque sus registros no tenían `comprobante_id`: conciliaban bien, se veían
  bien, y **ningún comprobante quedaba cobrado**. Aquí la flexibilidad de
  formato produce filas reales en `comprobantes`, con su id y su saldo. Se
  parece; no es lo mismo.
- **El mapeo se recuerda** en `empresas.mapeo_comprobantes` (`0039`), así que
  la carga rápida del Paso 1 entiende el formato del cliente sin volver a
  preguntar. ⚠️ La `0039` lleva su `GRANT update` porque la `0005` revocó el
  UPDATE amplio sobre `empresas`: toda columna nueva nace sin permiso de
  escritura (ya pasó con `criterios_conciliacion`).
- ⚠️⚠️ **Pero recordarlo NO significa que valga para cualquier archivo.** El
  formato guardado puede llevar una DECLARACIÓN («todo son cobranzas»), y esa es
  una afirmación sobre un archivo que aún no se ha visto: quien la guarda con su
  libro de ventas y luego sube el de pagos por la carga rápida cargaría **los
  pagos como cobros**. Entra bien, se ve bien, y el dinero queda del lado
  equivocado. Antes de importar se confirma en una frase («todas las filas se
  cargarán como cobranzas, en PEN») con la salida de cambiar el formato al lado.
  Si el formato guardado solo mapea columnas, no hay nada que confirmar y la
  carga sigue siendo de un clic.
- ⚠️ **Y si las columnas guardadas no están en el archivo nuevo, se vuelve a
  preguntar** en vez de aplicarlo a ciegas: aplicarlo descartaría todas las filas
  y el mensaje hablaría de columnas cuando lo que hay que hacer es remapear.
- ⚠️ **La plantilla GANA sobre el mapeo guardado**, decidido con las cabeceras
  reales de cada archivo. Una empresa que configuró su ERP y luego sube la
  plantilla para cuatro facturas vería fallar todas las filas: el mapeo apunta a
  columnas que ese archivo no tiene, y el resultado sería «0 importados» sin
  ninguna pista.
- ⚠️ **El tipo admite declararse para todo el archivo.** Un libro de ventas no
  trae una columna que diga «cobranza» porque todo él lo es; sin esa salida, la
  mitad de los exports reales serían inmapeables. Y lo declarado **manda sobre
  la columna**: si el usuario dijo que todo son cobranzas, unos valores raros no
  deben convertir algunas filas en pagos sin que se entere.
- **Las cabeceras se leen incluso de un archivo enorme** (`leerCabecera` trae
  solo el principio). Sin eso, el cliente grande —el que más lo necesita— no
  podría mapear nunca.
- Lógica pura en `src/lib/parsing/mapeoComprobantes.ts`, con tests sobre un
  export real: el que comprueba que **`SERIE-NÚMERO` y `N° OPERACIÓN` no se
  confunden** es el que más vale (ver la sección siguiente).

### Detectar bien, y decir con qué se dudó

«¿No sería mejor que el sistema convierta solo el archivo al formato de la
plantilla?» — lo hace: `aplicarMapeo` **es** esa conversión, y la detección ya
rellena los campos. La pregunta real es **quién decide** en las columnas donde
equivocarse no da un error, sino un resultado plausible.

Medido con el mayor real de 452.605 filas, la heurística anterior proponía
**tres de seis campos mal**, y ninguno fallaba en pantalla:

| Campo | Proponía | Qué habría pasado |
|---|---|---|
| monto | `Importe Moneda Base` | trae negativos → la carga entera se rechaza por `check (saldo >= 0)` |
| tipo | `Tipo de Transacción` | sus valores son *Pago* y *Asiento* → **452.461 cobranzas cargadas como pagos** |
| nº documento | `Nro. Documento` | es el asiento, no el recibo → el banco no conoce ese código → **0 %** |

Cuatro reglas nuevas, todas en `deteccionComprobantes.ts` / `deteccion.ts`, con
tests sobre la forma de un mayor contable:

- ⚠️⚠️ **El contenido VETA al nombre.** Una columna cuyos valores no significan
  nada para el campo no se propone aunque se llame igual. `fecha`, `monto`,
  `tipo` y `moneda` exigen el **90 %** de valores reconocibles porque sin los
  tres primeros la fila **entera** se descarta y un valor de moneda no
  reconocido cae a PEN en silencio; el resto, el 50 %. **Al revés no**: si la
  columna está vacía en la muestra no se veta nada — ausencia de evidencia no
  es evidencia de contradicción.
- **Cobertura y signo en el importe.** `Débito` está lleno en el 99,97 % de las
  filas y `Crédito` en el 0,03 %, pero las dos son numéricas al 100 % de las
  suyas: sin el factor de cobertura la heurística no las distingue. Y una
  columna que **mezcla signos** no es el importe de un comprobante, es el
  movimiento firmado de un mayor: se penaliza (no se veta — una nota de crédito
  puede venir en negativo).
- **`serie_numero` prefiere lo que NO se repite.** Es la identidad del
  documento, con índice único detrás. En el mayor, `Nro. Documento` es el
  asiento —repetido en cada línea— y `WIN - Nro. Documento` es el recibo, que es
  lo que el banco conoce.
- **Una columna vacía en toda la muestra no se propone para nada.** El mayor
  trae `Documento Relacionado` sin un solo valor y ganaba por nombre.

Con eso, el mismo archivo se detecta **6 de 6**, incluido dejar
`referencia_externa` vacía —que es lo correcto— y no proponer `tipo`, que
obliga a declararlo.

⚠️ Y lo que no se puede resolver adivinando **se dice**: `detectarComprobantesConDudas`
devuelve además las columnas que casi empataron, y el formulario las nombra bajo
el campo («También podría ser **Importe Moneda Base**»). Un mayor tiene tres
candidatas a importe y tres a número de documento; la heurística elige una, y el
aviso es la única pista que el usuario puede contrastar con la vista previa. El
aviso desaparece en cuanto toca el desplegable: ahí ya decidió él.

### La vista previa mira la muestra entera, no las tres primeras filas

Mostraba `muestras.slice(0, 3)` interpretadas. Con el mayor real eso produjo la
peor pantalla posible: **las tres primeras filas del archivo son líneas de un
asiento de crédito** —sin `Débito`, tipo «Asiento»—, así que la previa decía
tres veces *«esta fila se omitiría»* sobre un archivo en el que 452.454 de
452.605 filas entran perfectamente. El usuario ve que su mapeo no funciona
cuando sí funciona, y lo cambia — o abandona.

Enseñar el principio del archivo es apostar a que sea representativo, y en un
export contable nunca lo es. `resumirMuestra` (puro, con tests) recorre la
muestra y devuelve **filas que SÍ entran** para la tabla, más el recuento de lo
omitido agrupado por causa.

- **La alarma se reserva para cuando no entra NINGUNA**, que es el único estado
  en que el mapeo está de verdad mal. Antes ese caso se confundía con el otro.
- **Se dice también cuando no se omite nada** («✓ las 500 filas leídas se
  cargarían»): un recuento que solo aparece con problemas deja sin saber si el
  silencio significa «correcto» o «no se miró».
- ⚠️ **La muestra NO es el archivo**, y la pantalla lo aclara. Decir «132 de
  452.605 se omitirían» a partir de unos cientos de filas sería inventar una
  cifra.

## El número de documento no es la referencia de emparejamiento

Encontrado con datos reales de una recaudadora de telecom (450k movimientos/mes).
`serie_numero` hacía **dos trabajos incompatibles**: era la identidad del
documento —única, con el índice de la `0018` que impide cargar dos veces la
misma factura— y a la vez lo que el motor usaba para casar contra el extracto
(`getComprobantesCanonicos` lo mapeaba a `referencia`).

En una cuenta recaudadora esos dos datos **no son el mismo**:

```
Recibos   SR11-02748951, SR11-03590663  → único por documento
EFECTIVO  00000001300486                → la operación bancaria, y SE REPITE
                                          cuando un cliente paga dos recibos
```

Con un solo campo había que elegir: o el índice único rechazaba el 2,5% de las
filas, o el motor no podía casar por referencia y todo caía en las capas
cuadráticas. Y las filas rechazadas eran precisamente los casos de **agrupación
1:N** que hay que conciliar.

`0020` los separa:

- **`serie_numero`** → identidad del documento. Único.
- **`referencia_externa`** → con qué casarlo en el banco. **Se repite a
  propósito**, sin índice único.
- `getComprobantesCanonicos` usa `referencia_externa ?? serie_numero`: quien
  factura y cobra 1:1 no nota el cambio.

⚠️ La `0020` reconcede **UPDATE e INSERT por columna**. `comprobantes` arrastra
el mismo patrón que `empresas` (`revoke` + `grant` acotado, ver `0008`/`0010`),
así que **toda columna nueva nace sin permiso de escritura**. De paso cubre
`lote_importacion`, que la `0018` añadió sin tocar permisos y cuyo INSERT no se
había ejercitado desde entonces.

### Y el mismo recibo se escribe distinto en cada lado

Del mismo cliente, mismo cobro, dos códigos:

```
mayor del ERP     WIN-S001-11618954
extracto del BCP      S001-11618954
```

`ref_norm` daba `WINS00111618954` contra `S00111618954`, así que la capa exacta
no los casaba, caían al residuo —donde tampoco casaban— y acababan en «sin
conciliar» sin que nada explicara por qué. Son **276 recibos** repartidos por
todo el mes, y el extracto trae **559 movimientos** con esa serie.

La `0042` hace que `ref_norm` **descarte un primer segmento hecho SOLO de
letras** —el nombre de la entidad que emite— y solo cuando lo que queda sigue
pareciendo un código de documento. Las tres guardas no son adorno:

- **letras Y dígitos en el resto** — sin esto, `F001-123` quedaría en `123`, y
  `A-123` y `B-123` pasarían a ser la misma referencia. Un número pelado no
  identifica nada.
- **≥ 6 caracteres útiles** — una clave corta colisiona con cualquier cosa.
- **primer segmento sin dígitos** — `SR11-02748951`, la serie normal de este
  cliente (452.317 filas), **no se toca**: `SR11` lleva números, así que no es
  un nombre de entidad. Es la condición que deja intacto lo que ya funcionaba.

⚠️⚠️ **Es una función aplicada a los dos lados por igual, así que no puede
romper un par que antes casaba**: si dos referencias eran iguales, sus formas
canónicas lo siguen siendo. Lo único que puede aparecer son pares nuevos, y
siguen exigiendo el mismo importe al céntimo.

⚠️ **La regla está escrita CUATRO veces** —`ref_norm` en SQL, `normRef` en
`01_exacta.js`, en `03a_agrupacion.js` y el TypeScript de
`src/lib/normalizacion/referencia.ts`— porque los nodos de n8n no pueden
importar nada. `tests/referencia.test.ts` fija la regla y comprueba que las
copias no se hayan quedado atrás; el lado TypeScript ya tiene un solo origen
(`diagnosticoPartida` lo re-exporta en vez de redefinirlo, que es como estaba).
En los nodos de candidatos la forma canónica se **añade** a la cruda, nunca la
sustituye: así ningún candidato que antes aparecía deja de aparecer.

⚠️ Cambiar `ref_norm` **reescribe las dos tablas** (es `generated ... stored`),
así que la migración termina con `analyze` y se aplica desde Studio, no por la
API.

## ⚠️ PostgREST corta en 1.000 filas — TAMBIÉN el resultado de una función

`db-max-rows` no distingue entre un `select` y un RPC. Una función que devuelve
4.382 filas entrega **1.000 y un 200 OK**, igual que una tabla.

Mordió después de haber documentado el caso de los `select`, porque no se me
ocurrió que aplicara a las funciones: el residuo de junio son 4.382 internos y
3.204 movimientos, a n8n le llegaron **1.000 y 1.000**, y la pantalla dijo
*"2000 partidas · 0 pares"*. Los dos mil redondos eran la única pista.

`construirResiduo` pagina los RPC con `.range()`, igual que `traerTodo` hace con
las tablas. **Regla: si una función puede devolver un número de filas que
dependa de los datos del cliente, se pagina.**

## ⚠️ PostgREST corta en 1.000 filas y no avisa

Un `select` sin rango sobre 20.000 comprobantes devuelve **1.000 filas y un 200
OK**. No hay error, no hay señal: el código cree que tiene todo.

Mordió de verdad: `getComprobantesCanonicos` mandaba **1.000 de 20.000**
registros al motor, así que la conciliación cubría el 5% del mes. Se detectó de
casualidad, porque el Paso 3 mostraba «Tus registros: 1.000» al lado de
«Movimientos del banco: 20.000» — un número mal pintado destapó una conciliación
incompleta.

**El tope es configuración del servidor (`db-max-rows`), no del cliente.** No se
sube desde la app: la única salida es paginar. `lib/supabase/paginado.ts`:

- **`traerTodo(consulta)`** pagina con `.range()` hasta que una página vuelve
  incompleta.
- **`enLotes(ids)`** trocea los `.in(...)`, que no fallan por el tope de filas
  sino por **longitud de URL**: un `.in()` con 20.000 ids da un 414 o —peor— un
  filtro truncado.

**El `.in()` tiene un segundo límite, el de la URL.** Los ids son **UUID de 36
caracteres**: 500 en un filtro son ~19.500 caracteres de query string, muy por
encima del límite habitual de nginx/kong (8.192). "Empezar de cero" con 20.000
comprobantes fallaba con un escueto *"No se pudieron borrar los comprobantes"* —
y antes fallaba en silencio la consulta de protegidos, porque `traerTodo` se
traga el error. Por eso `enLotes` trocea de **100 en 100**.

⚠️ **Y borrar medio millón tampoco cabe en una sentencia.** «Quitar esta carga»
fallaba con un escueto *«No se pudo deshacer la importación»*: borrar 452.309
comprobantes tarda ~13 s contra los 8 del `statement_timeout`, así que se
cancelaba entera y no borraba nada. Va por lotes de 20.000
(`borrar_comprobantes`, migración `0035`), y si se interrumpe a medias **se
informa de cuántos sí se quitaron** — decir "no se pudo" cuando ya
desaparecieron 300.000 filas sería mentir sobre el estado.

**Y mejor todavía: no contar una por una lo que se va a borrar en bloque.**
"Deshacer esta importación" con 100.000 comprobantes tardaba **4-5 minutos**
porque pedía los 100.000 ids —cien peticiones— para al final lanzar un solo
DELETE por `lote_importacion` que ni los usaba. Ahora `borrarComprobantes()`
cuenta con `count`, pide los **protegidos** (que son pocos, y salen de
`aplicaciones_cobro`, no de los comprobantes) y lanza un DELETE con el filtro:
**borrar 100.000 cuesta lo mismo que borrar 10**.

**Mejor que trocear es no enumerar.** Donde se pueda, filtrar por un campo en vez
de por miles de ids: `idsConCobros` pide las aplicaciones de la empresa (RLS
acota) y cruza en memoria, y los borrados usan `.eq("lote_importacion", …)` o el
filtro de toda la tabla cuando no hay nada protegido — **una petición en vez de
doscientas**.

⚠️⚠️ **Paginar exige un orden TOTAL.** Cada página re-ejecuta la consulta, así que
si el `order by` empata —`fecha` con miles de filas del mismo día— Postgres puede
devolver las empatadas en distinto orden y **unas salen dos veces y otras no
salen nunca**. `getComprobantesCanonicos` ordenaba solo por `fecha` y mandó al
motor **852 comprobantes duplicados dejándose otros 852 sin enviar**, en una
conciliación de 20.000. El total cuadraba: nada lo delataba desde fuera, y el
resultado parecía un fallo del motor (95,7% en vez de 100%).

    .order("fecha", { ascending: true })   // ordena, pero empata
    .order("id",    { ascending: true })   // ROMPE EL EMPATE. Obligatorio.

Hay un test en `tests/paginado.test.ts` que recorre `src/` y falla si algún
`.range()` no lleva desempate por columna única.

**Y hay un tercer límite, en el otro extremo: el body de las server actions.**
Next trae **1 MB** por defecto, y la importación manda hasta 5.000 filas de
golpe — que ronda justo ese tamaño y falla con una *"server-side exception"* sin
más pista que un digest. Está subido a 4 MB en `next.config.mjs`. Subirlo
indefinidamente **no es la solución**: a partir de ahí toca ingesta en servidor
por lotes.

**Regla al escribir consultas nuevas:** si el número de filas depende de cuántos
datos tenga la empresa, o paginas o pones un `.limit()` explícito **y lo dices en
pantalla** (como hace `/comprobantes` con sus «últimos 500»). Un `select` pelado
sobre una tabla que crece es un bug esperando al primer cliente grande.

Sitios corregidos, por gravedad: `getComprobantesCanonicos` (conciliaba el 5%),
`sincronizarCobranzas` (calculaba **saldos** con datos incompletos y los
escribía), `idsConCobros` (habría dejado borrar un comprobante con cobros),
`deshacerImportacion` y `vaciarComprobantes` (borraban de mil en mil),
`/cobranzas` y `/pagos` (la antigüedad de deuda se calculaba sobre 1.000), y el
resumen del wizard (ahora usa `count: "exact"`).

## ⚠️ El middleware trunca los cuerpos de más de 10 MB, en silencio

Hermano del tope de PostgREST, y peor: aquí no se pierde una lectura, se pierde
lo que el cliente acaba de subir.

Cuando hay middleware, Next **clona** el cuerpo de la petición para pasárselo
(`getCloneableBody` → `cloneBodyStream`, en `next/dist/server/body-streams.js`).
El clon tiene un tope de 10 MB (`DEFAULT_BODY_CLONE_SIZE_LIMIT`) y al superarlo
hace `limitExceeded = true; return`: **deja de reenviar bytes**. No lanza, no
responde 413. El handler recibe JSON cortado y lo único que se ve es
`"JSON inválido"` — un mensaje que apunta al sitio equivocado y manda a buscar
el fallo en el cliente, que es lo único que no puede ser.

**No es configurable.** `serverActions.bodySizeLimit` no alimenta ese
`sizeLimit`: con 4 MB declarados ahí, 9 MB pasaban y 10 MB no. La única palanca
es que el middleware **no corra** en esa ruta, y por eso el matcher de
`src/middleware.ts` lleva exclusiones explícitas.

Cómo se acotó, por si vuelve a pasar con otro límite: se sondea un endpoint
**público que parsee JSON** (`/api/auth/registro`) con cuerpos válidos de tamaño
creciente. Si vuelve el error de validación, el cuerpo llegó entero; si vuelve
"JSON inválido", se cortó — y el tamaño donde cambia es el límite. Repetir la
sonda **dentro del contenedor** separa la app del proxy: aquí falló igual en
127.0.0.1:3000, lo que descartó Traefik en un minuto.

⚠️ **Lo caro no era la conciliación de 13,3 MB con que se detectó**, que al menos
fallaba a la vista. Era `/api/comprobantes/importar`, que recibe el **archivo**:
un CSV de 30 MB se habría importado a medias **sin un solo error en pantalla**.
Pérdida de datos silenciosa, en el camino construido justamente para volumen.

**Regla:** toda ruta que reciba un archivo o un payload que crezca con los datos
del cliente se añade al matcher. `tests/middleware.test.ts` lo vigila: comprueba
las tres rutas conocidas y **escanea las APIs en busca de `request.formData()`**
—una subida crece por definición— exigiendo que estén excluidas.

## El tope de partidas es configurable, y va emparejado con n8n

`MAX_FILAS_CONCILIACION` (por defecto **20.000**) acota las partidas por lado.
Es un **techo, no un objetivo**: el caso para el que está pensado el producto
—500 a 2.000 movimientos— no lo roza nunca.

⚠️ **No se sube solo.** Cada fila pesa ~194 bytes *medidos*, así que el payload
son `filas × 2 × 194`:

    20.000 →  7,8 MB   cabe en el defecto de n8n (16 MB)
    36.000 → 14,0 MB   cabe, justo
    50.000 → 19,4 MB   NO cabe: hay que subir N8N_PAYLOAD_SIZE_MAX

Por eso es variable de entorno con el valor prudente por defecto: quien necesite
más lo sube **junto con** el de n8n, y ningún despliegue hereda una combinación
rota.

**Lección de dimensionado:** una recaudadora de 450.000 movimientos al mes da
una media de 14.600 al día, pero el **pico real es 36.390** — 2,5 veces la
media. Con estos volúmenes la media no dice nada; **manda el pico**. Antes de
prometer que un corte cabe, mirar la distribución diaria, no dividir por 30.

## Ingesta en servidor por lotes (volumen)

`POST /api/comprobantes/importar` recibe el **archivo** y lo procesa en el
servidor. Antes el navegador parseaba y mandaba las filas ya normalizadas a una
server action, y eso topaba tres veces: memoria del navegador (450.000 filas son
1–3 GB), límite de body de las server actions, y el tope de 5.000 filas.

- **El CSV se lee del stream a trozos** (`lib/parsing/csv.ts`, puro y con tests):
  se acumulan ~1.000 filas, se insertan y se sueltan. Memoria constante, **sin
  tope de filas**.
- ⚠️ **El XLSX no puede leerse a trozos**: hay que descomprimirlo entero antes de
  ver la primera fila, así que el pico de memoria ocurre **antes** de que exista
  lote alguno que insertar. Por eso lleva tope (`MAX_FILAS_XLSX = 50.000`) y el
  error dice que guarden como CSV. No es pereza: insertar por lotes no arregla
  un formato que exige leerlo entero.
- El navegador **solo previsualiza archivos < 8 MB**. Por encima sube a ciegas,
  que es justo lo que permite cargar 450.000. Que falle la previa no impide
  importar: el servidor vuelve a leer el archivo.
- Las series ya cargadas se piden **una vez** y se llevan en un `Set`;
  preguntar por lote serían cientos de viajes.

**Esto NO desbloquea conciliar 450.000**, solo cargarlos. Falta la parte B: el
payload a n8n son ~180 MB contra un webhook de 16, y el `resultado` sería un
JSONB de cientos de MB en una fila. La salida es que **n8n lea de Supabase en
vez de recibir el payload**, y que el resultado vaya a una tabla — lo que
convierte en obsoleta la nota de "tablas normalizadas fuera de alcance porque el
JSONB basta": bastaba a 2.000 partidas.

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
- **Para verlo vencido sin esperar 30 días** (demostraciones): los `update`
  están listos en `ops/simular-prueba.sql`, que se ejecuta desde el SQL Editor
  de Studio. No hay pantalla para esto **a propósito** — es justo lo que la
  `0005` revoca.

### El sistema se vende ENTERO: no hay módulos que contratar aparte

Cuentas por cobrar / por pagar nació como módulo contratable
(`suscripciones_modulo`, `0009`) y estaba cerrado **en los dos extremos**:
durante la prueba, y también para quien ya pagaba el plan. Las dos cosas eran
un error, y la segunda peor que la primera.

- **Al que paga**, encontrarse una pantalla cerrada le hace preguntarse qué
  compró. Un cliente que ya soltó el dinero es el peor momento para pedirle más:
  la conversación deja de ser sobre el producto y pasa a ser sobre la factura.
- **Al que prueba**, el candado no protege ningún ingreso —nadie está pagando
  todavía— y le esconde justo el motivo por el que pagaría. Quien no usó las
  cobranzas en 30 días no puede echarlas de menos el día 31, que es exactamente
  donde se juega la conversión.

Así que el **único** estado que cierra un módulo es la **prueba vencida sin
activar la cuenta** — el mismo que impide conciliar. Un solo límite en todo el
producto, fácil de explicar y de recordar.

- `estadoModulo` recibe un cuarto argumento, `AccesoCuenta`
  (`motivo: "plan" | "prueba"`): con cualquiera de los dos, **todos** los
  módulos salen activos. Sigue puro y con tests; el dato lo arma
  `modulos-servidor.ts` desde `estadoSuscripcion`. Hay un test que fija la
  promesa: *pagar y probar dan el mismo acceso*.
- **`MODULOS` ya no lleva `precioMensual`**, y `PanelModulos` (ahora *«Qué
  incluye tu cuenta»*) no tiene precios ni botones de "Activar" por módulo:
  ofrecer una compra que no existe dejaría al cliente esperando una factura
  aparte. Lo que se ofrece, y solo cuando la prueba venció, es **activar la
  cuenta**.
- ⚠️ **Durante la prueba la pantalla no dice "Activo" a secas**, dice *«Incluido
  · lo tienes hasta el dd/mm, cuando termina tu prueba»*. Un "Activo" haría
  creer que ya está pagado y convertiría el vencimiento en una sorpresa.
- ⚠️ **Y al vencer, el bloqueo cambia de texto**: quien llega ahí NO está
  descubriendo una función nueva, la estuvo usando y acaba de perderla.
  `ModuloBloqueado` (una sola copia para Por cobrar y Por pagar) lo dice así, y
  recuerda que comprobantes y conciliaciones se siguen consultando.
  `accesoModulo` devuelve `pruebaVencida` justo para eso.
- **`suscripciones_modulo` sobrevive como concesión suelta** —cortesía, acuerdo
  puntual, dar acceso sin activar la cuenta entera— y sigue abriendo el módulo
  por su cuenta. Ya **no es el camino por el que nadie obtiene acceso**, y en
  condiciones normales la tabla está vacía.
- El control se sigue haciendo cumplir **en el servidor**, en cada página. Lo
  que cambió es el criterio, no dónde se aplica.

## Revisión de resultados: deshacer y paginar

Dos arreglos que salieron de una crítica UX de `/conciliacion/[jobId]`:

- **Una decisión ya no es irreversible.** Antes, aceptar o rechazar mandaba el
  par a una tabla de **solo lectura** y no había vuelta atrás desde la interfaz.
  Aquí eso pesa más que en otro producto: una decisión aceptada **mueve el saldo**
  al aprobar y además **le enseña el criterio a la IA**, así que un error de clic
  se propaga a las siguientes conciliaciones. Ahora cada fila de "Ya conciliado"
  tiene *Volver a revisar*, y el aviso de éxito trae un *Deshacer* inmediato —el
  momento en que uno se da cuenta del error es el segundo siguiente, no cuando
  abre otra sección.
- **La reapertura se REGISTRA** (`accion: "pendiente"` en `decisiones`) en vez de
  borrar la decisión anterior: el historial es materia prima del aprendizaje y no
  se reescribe. Efecto secundario buscado: al ser "pendiente" la última acción,
  `claseDeMatch` deja de contarlo como ejemplo — un par reabierto no enseña nada
  hasta que alguien vuelva a decidir.
- **La cola "Por revisar" pagina** como sus dos secciones hermanas. No lo hacía,
  y con la restricción de producto de 500–2000+ movimientos podía pintar
  cientos de fichas ricas de una vez.
- **"Seleccionar todas" alcanza solo lo visible.** Seleccionar en bloque
  partidas que no caben en pantalla es pedirle a alguien que decida a ciegas.

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

## Parte B: conciliar 450.000 partidas (en curso)

La ingesta ya permitía **cargar** 450.000 comprobantes, pero no conciliarlos.
Tres muros, no uno:

1. **Entrada**: 903.308 partidas en un JSON de ~175 MB, contra un webhook de 64.
2. **Salida**: `resultado` sería un JSONB de cientos de MB en **una fila**.
3. **Lectura**: pantalla, cobranzas, reportes y aprendizaje leen ese JSONB entero.

Cuatro etapas, cada una desplegable por su cuenta:

| Etapa | Qué | Estado |
|---|---|---|
| 1 | El extracto se persiste en `movimientos_extracto`, con ingesta por lotes | ✅ `0022` |
| 2 | La capa exacta corre en SQL sobre las dos tablas | ✅ `0023` |
| 3 | n8n recibe solo el **residuo** | ✅ `0024` |
| 4 | La pantalla lee los matches de tabla en vez del JSONB | ✅ |
| 5 | El reparto de cobros de la capa exacta, en SQL | ✅ `0025` |
| 6 | Reportes y aprendizaje sobre los pares en tabla | ✅ `0026` |

### El reparto de cobros (etapa 5)

Aprobar descuenta el saldo de cada comprobante cobrado. Con 32.170 cobros ya
tardaba ~90 s desde Node; con 447.795 serían ~900 peticiones y un cuarto de hora.

**Solo las exactas van en SQL.** Son 1:1 y con el mismo importe por
construcción, así que el factor de reparto es 1 y solo queda topar por saldo
disponible. Los pagos parciales, las agrupaciones 1:N y las diferencias
absorbidas siguen en `src/lib/cobranzas.ts` — esa aritmética decide cuánto
dinero se le descuenta a quién, es pura, tiene tests, y son unos miles de pares:
no hay razón de rendimiento para duplicarla y sí una muy buena para no hacerlo.

⚠️ **Por lotes de 5.000, y el número no es decorativo.** De una vez tarda
**2 min 24 s** —cada fila dispara el trigger de saldo de la `0008`— contra un
`statement_timeout` de 8 s: la llamada entera se cancelaría sin escribir nada.

⚠️⚠️ **El primer lote de 20.000 tardó 10 s y el segundo 60 s**, con el mismo
trabajo por delante. El filtro "lo ya aplicado no se vuelve a mirar" busca por
`(job_id, comprobante_id)` y el único índice era por `job_id`, así que cada lote
recorría todo lo ya escrito. La clave única existente no sirve: su columna
principal es `comprobante_id`. La `0025` añade
`idx_aplicaciones_job_comprobante` y queda en ~2,7 s por lote, estable.

**Y no se borra todo para rehacerlo.** `limpiar_cobros_desconfirmados` retira
solo los pares que dejaron de estar confirmados; borrar las 447.795 tarda otros
90 s y en régimen normal no cambia ninguna.

Verificado sobre los 447.795 pares reales: **cero comprobantes con saldo
negativo y cero con más aplicado que su importe**.

### La capa exacta como JOIN (etapa 2)

Emparejar por monto + referencia es literalmente un JOIN, y Postgres lo hace
sobre medio millón de filas en segundos. **Medido con junio completo de la
recaudadora:**

    452.177 internos · 450.999 movimientos
    → 447.795 pares (99,03 %) en 31,8 s
    → residuo para n8n: 4.382 + 3.204 = 7.586 partidas (~1,5 MB)

Verificado: 447.795 comprobantes distintos y 447.795 movimientos distintos
—ninguna partida usada dos veces—, cero pares con monto distinto y cero con
referencia distinta.

- ⚠️ **`row_number()` en los dos lados, casando por número.** Con cientos de
  recibos del mismo importe y la misma referencia, un JOIN a secas da el
  producto cartesiano: 300 × 300 = 90.000 pares en vez de 300. Numerar cada
  lado dentro de su grupo reproduce el "toma el siguiente libre" del JavaScript.
- ⚠️ **Solo el pass 1 (monto + referencia).** El respaldo por monto + FECHA se
  queda en `n8n/01_exacta.js` a propósito: necesita la guarda de contradicción
  de referencias —sin ella emparejó 541 pares sin relación marcándolos `auto`—
  y reescribirla en SQL sería duplicar el punto exacto donde el motor se
  equivoca en silencio. n8n vuelve a correr su capa exacta sobre el residuo.
- **Céntimos CON SIGNO**, no valor absoluto: en absoluto, un cobro casaría con
  un pago del mismo importe.

### Reportes y aprendizaje (etapa 6)

Los dos leían `resultado.matches`, vacío en modo tabla. Sin esto, el pool de
ejemplos habría salido a cero **justo en la empresa con medio millón de
partidas** — la que más criterio tiene que enseñar.

Necesitan cosas opuestas, y por eso son dos funciones:

- **El aprendizaje quiere los pares que revisó una persona.** `matches_revisados`
  deja fuera los `auto`: nadie los miró, y usarlos enseñaría a la IA un criterio
  que ninguna persona aplicó — el mismo motivo por el que no entran en la tasa
  de acierto. Eso además vuelve el problema pequeño: son decenas o cientos,
  aunque detrás haya 447.795. `hidratarJobsModoTabla` los reconstruye en la
  forma que `construirEjemplos` ya sabe leer, así que esa función no cambió.
- **Los reportes quieren el recuento.** `conteo_matches` agrega en la base; traer
  medio millón de filas para contarlas en Node es lo que la parte B vino a
  eliminar.

Los KPIs y el % de automatización salían ya bien: viven en `resultado.resumen`,
que la absorción actualiza.

### Sin la columna de referencia, el motor está ciego

Una conciliación de 450.999 movimientos terminó en **0 %** porque la columna
`Recibos` del extracto no se mapeó a *referencia*. La capa exacta casa por
monto + referencia; sin referencia no puede emparejar nada, y todo cae en las
heurísticas de monto y fecha.

Nada avisó hasta ver el resultado, y a ese volumen descubrirlo al final cuesta
media hora de proceso.

- `deteccion.ts` reconoce ahora `recibo`, `recibos` y `operacion`: es como llama
  una recaudadora peruana a ese dato, y era **la** columna que decidía el
  resultado.
- El Paso 2 avisa en ámbar cuando la referencia no está mapeada. No bloquea
  —hay extractos que no la traen, y para ellos el respaldo por monto+fecha es
  legítimo— pero deja de ser un silencio.

⚠️ La validación del Paso 2 solo exigía **fecha y monto**. Es correcto para una
PyME que concilia por importe, y ruinoso para quien concilia por número de
operación. La diferencia entre "opcional" y "opcional pero decisivo" tiene que
verse en pantalla.

### Y avisar de la causa no basta: hay que medir la consecuencia

El aviso ámbar del Paso 2 señala la causa correcta, pero **un aviso que el
usuario no sabe ponderar se despacha sin leer** — más aún cuando aclara, con
razón, que se puede conciliar igual. *«No mapeaste la referencia»* se ignora;
*«casarían 12 de 450.999 movimientos»* no.

`diagnostico_previo` (migración `0037`) corre en el **Paso 3**, que es el único
momento en que los dos lados ya están en la base —el Paso 2 importa el extracto
y devuelve `lote_id`— y el motor todavía no ha corrido. Ahí cabe la comprobación
real en vez de una heurística sobre lo que se ve en pantalla.

- ⚠️⚠️ **La estimación COMPARTE la sentencia con la capa exacta, no la copia.**
  La regla de emparejamiento se extrajo a `pares_exactos(...)` y la usan las
  dos: `conciliar_exacta` para insertar y el diagnóstico para contar. Con dos
  definiciones, el Paso 3 prometería una cobertura que el motor luego no da —y
  nadie lo notaría—. Es el mismo riesgo que la `0029` documenta con `ref_norm`,
  y aquí se puede eliminar del todo porque las dos consultas viven en Postgres.
- ⚠️ `pares_exactos` va **sin `security definer` y sin `set search_path`** a
  propósito: las dos cosas impiden que el planificador la incruste, y está en el
  camino que empareja 450.000 filas. Todo va calificado con `public.` y el
  acceso se cierra con `revoke`. **Al desplegar sobre el cliente grande hay que
  volver a medir `conciliar_exacta`**; si empeorase, la definición con el cuerpo
  en línea sigue en la `0029`.
- ⚠️ **`pares_estimados` puede ser `null`, y eso NO es cero.** Emparejar medio
  millón contra medio millón se pasa del `statement_timeout`, así que por encima
  de 60.000 por lado no se intenta y la pantalla dice que no se estimó. La señal
  que de verdad diagnostica el caso del 0 % es **`refs_compartidas`** —cuántos
  códigos aparecen en los dos lados—, que es un join sobre columnas indexadas y
  cuesta casi nada. Devolver null y decirlo es mejor que colgar la pantalla.
- **Detecta el caso traicionero**: las dos columnas mapeadas y aun así ni una
  referencia en común (recibos `SR11-02748951` contra operaciones
  `00000001300486`). Un aviso de "falta mapear" mandaría al sitio equivocado.
- **No bloquea; cambia cuál es el botón negro.** Con un hallazgo crítico,
  *«Revisar el mapeo»* pasa a primario y *«Conciliar de todas formas»* queda a un
  clic. Prohibirlo cerraría un caso de uso legítimo (extractos sin referencia).
- **Cuando todo está bien también se dice** (*«casarían 980 de 1.000»*). Un panel
  que solo aparece con problemas deja sin saber si el silencio significa
  "correcto" o "no se miró".
- Interpretación en `src/lib/diagnosticoPrevio.ts` (puro, con tests); la base
  solo cuenta. El tope de filas vive en `lib/limites.ts` porque lo comparten el
  aviso y el endpoint que rechaza: con dos números, el wizard diría que cabe algo
  que luego falla al iniciarse.

### «¿Por qué no se concilió esta partida?»

`04_ensamblar.js` etiqueta cada pendiente por su signo (*"Posible depósito en
tránsito"* / *"Posible cheque no cobrado"*), o sea que dice lo mismo de las
4.382 partidas del residuo. El usuario ve *sin conciliar* y no tiene por dónde
empezar — mientras el sistema **sí sabe** por qué.

Cada fila de "Tus registros" sin conciliar lleva un **«¿Por qué?»** que da uno
de siete diagnósticos con la evidencia concreta.

- ⚠️⚠️ **Lo que se afirma es más modesto de lo que parece, y es deliberado.**
  El diagnóstico **no dice** "el motor lo rechazó porque X": dice *"lo más
  parecido en tu extracto es esto, y se diferencia en esto"*. Es una observación
  sobre los datos, no una reconstrucción del motor, así que **no puede divergir
  de él porque no está hablando de él**. Reimplementar los criterios de
  `n8n/*.js` habría creado un segundo motor que se separa en silencio.
  (Mismo criterio que `precedentes.ts`: se afirma lo comprobable.)
- Las dos excepciones son **hechos consultables**: `ya_emparejado` (el
  movimiento está en `matches_conciliacion` con otro comprobante) y
  `referencia_contradice` (las dos referencias existen y difieren).
- **Los tres hallazgos que hoy eran invisibles** justifican la función solos:
  **`ya_emparejado`** (la capa exacta numera los dos lados y empareja por
  número; que a *esta* factura le tocara quedarse fuera es correcto e
  inexplicable desde la pantalla), **`referencia_contradice`** (el motor lo
  descartó a propósito —la guarda de los 541 pares falsos— y parecía un olvido)
  y **`agrupacion_posible`**.
- ⚠️ **SQL busca, TypeScript decide.** Las partidas viven en dos sitios según el
  tamaño del job —tablas o el JSONB `payload_entrada`—, así que decidir en SQL
  obligaría a escribir el diagnóstico dos veces. `candidatos_partida` (`0038`)
  solo devuelve candidatos por índice; `src/lib/diagnosticoPartida.ts` decide, es
  puro y tiene tests. Una partida no puede explicarse de dos maneras según por
  dónde entre.
- **`sin_candidato` es el resultado más común y NO es un fallo**: en una
  recaudadora la mayoría se cobró por otro banco. Se muestra lo más cercano
  encontrado — un "no encontré nada" a secas parece que no se miró.
- ⚠️ **La agrupación exige identidad compartida** (misma referencia o una
  palabra del nombre) antes de sumar. Sin ese prefiltro, un subset-sum empareja
  partidas sin relación cuya suma cuadra por azar y el resultado parece
  correcto. Hay test de las dos caras.
- **Bajo demanda, de una en una, y no se guarda.** Nadie lee 4.382
  explicaciones, y un diagnóstico congelado envejecería mintiendo: una
  conciliación manual ocupa un movimiento y cambia la respuesta.
- Solo el **lado interno** (las facturas del cliente). El simétrico se añade
  después sin tocar nada de esto.

### «Mi archivo tiene 452.605 filas y aquí dice 452.177»

La pregunta anterior es por UNA partida; esta es por el **recuento**, y salió en
una demo. No había forma de contestarla desde la aplicación: hubo que abrir el
Excel y cruzarlo contra la base para reconstruir una cuenta que el sistema tenía
delante.

```
452.605  filas del mayor
  − 296  no se cargaron (8 recibos repetidos, y el resto sin llegar a la base)
452.309  comprobantes
  − 132  de fechas fuera del período conciliado
452.177  registros internos
  − 447.795  conciliados
    4.382  sin conciliar
```

Cada resta es legítima. Lo que no lo es: que el usuario tenga que descubrirlas
por su cuenta. **Un número que no cuadra con su archivo no se queda ahí —
contamina todos los demás de la pantalla.**

La cascada se enseña en el **panel** (plegada, que es donde se hace la pregunta)
y en el **resumen ejecutivo** (desplegada, ahí es contenido). Componente único,
`OrigenPartidas`; lógica pura en `src/lib/origenPartidas.ts` con tests.

- ⚠️⚠️ **La foto se CONGELA al iniciar** (`jobs_conciliacion.origen_partidas`,
  `0043`) y no se recalcula nunca. Al aprobar, los 447.795 comprobantes casados
  pasan a `cobrado`, así que «del período y sin cobrar» se desploma de 452.177 a
  4.382: una pantalla que recalculara **se degradaría sola** y enseñaría un
  número peor cada vez que alguien la mirase. Es exactamente el fallo que la
  `0033` tuvo que arreglar en el resumen ejecutivo.
- ⚠️ **La cuenta CIERRA siempre.** Cuando las causas conocidas no suman lo que
  tienen que sumar, aparece una línea *«sin explicar»* con el resto en vez de
  repartirlo. Una explicación que no cuadra es peor que ninguna: convierte una
  duda concreta en desconfianza general. Hay test.
- **Se enseñan también los ceros** («0 filas sin fecha ni importe»). Es lo que
  convierte la lista en una cuenta comprobable; un 296 suelto parece un fallo.
  Mismo criterio que el aviso de «se conservaron N por tener cobros aplicados».
- **`importaciones_comprobantes` (`0043`) guarda lo que ya se contaba** al
  importar —leídas, insertadas, repetidas, inválidas— y que hasta ahora solo
  vivía en un mensaje que desaparece al recargar. Sin política de insert: son
  contadores del sistema, no algo que el usuario declare, así que se escriben
  con `service_role` desde las **dos** rutas de carga (API por lotes y server
  action de la plantilla).
- **`fecha_min`/`fecha_max` de cada carga** son lo que permite acotar la cascada
  a *las cargas que alimentan este período*. Sin eso, una empresa con doce meses
  cargados leería «fuera del período: 400.000», que es cierto y no dice nada.
- **Para lo cargado antes de la `0043` se dice que no se sabe** (`alcance =
  'empresa'`) y el bloque del archivo no se pinta. Media cascada sin avisar de
  qué falta sería peor que ninguna.
- ⚠️ El panel pide `origen_partidas` **con reintento sin esa columna**: si el
  despliegue va por delante de la migración, PostgREST responde con error a todo
  el `select` y el panel se quedaría sin actividad reciente ni sugerencias
  pendientes. Un detalle nuevo no puede tumbar lo que ya funcionaba.
- ⚠️ En `/resumen` se muestra **UNA** conciliación, no la suma del rango. Sumar
  cascadas parece más completo y es falso en cuanto dos comparten carga de
  comprobantes: las mismas filas del archivo se contarían dos veces. Lo que se
  busca es poder decir «esto cuadra con mi Excel», y para eso hace falta un
  período concreto contra un archivo concreto.

### Y de lo que quedó suelto, qué es (`residuo_explicado`, 0044)

La cascada termina en «4.384 sin conciliar» y ahí se paraba — que es justo donde
empieza la pregunta del cliente. Contestarla exigía abrir los dos Excel y cruzar
450.999 movimientos contra 452.454 comprobantes a mano. Ese cruce está en la
base; solo faltaba pedirlo.

Cada partida suelta se clasifica por un hecho **consultable**:

- **su código no aparece en el otro lado** — 4.382 recibos (S/ 434.844) y 2.645
  movimientos. Es el grueso, y no tiene arreglo técnico.
- **su código SÍ está, pero no casaron** — importe distinto, o ese movimiento ya
  se llevó otro comprobante con el mismo código. Son pocos y son los únicos que
  merecen una mirada: hay las dos caras.
- **sin código** — solo emparejables por importe y fecha.

⚠️⚠️ **Se afirma el hecho, no la conclusión.** El sistema puede comprobar que un
código no está en el extracto; que «se cobró por otro canal» es una lectura del
negocio —muy probable, no comprobada— y ponerla en boca del sistema la
convertiría en un dato. Cada línea lleva el hecho y, aparte y en condicional, lo
que suele significar. Mismo criterio que `precedentes.ts` y `diagnosticoPartida`.

⚠️ **Las series descompensadas son el hallazgo que cambia la conversación.** De
los códigos que empiezan por `S001` el banco trae 559 y los libros 276: eso no
es un problema de emparejamiento, es que **faltan documentos**, y ninguna mejora
del motor lo va a arreglar. Se agrupa por los cuatro primeros caracteres del
código **canónico**, y solo funciona gracias a la 0042: sin quitar el prefijo de
entidad, `WIN-S001-…` y `S001-…` caerían en grupos distintos y la comparación no
diría nada. Se enseña solo cuando la diferencia es real (≥20 códigos y ≥10 %):
señalar empates es ruido, y el ruido enseña a ignorar el recuadro.

- **Se pide AL PULSAR.** Recorre las dos tablas enteras —segundos a este
  volumen— y el panel se abre a diario. Mismo criterio que el «¿Por qué?» de
  cada partida y que el asistente.
- **No se congela**, al revés que la cascada: aquí sí envejecería mintiendo,
  porque conciliar a mano cambia el residuo. La pantalla dice que se calculó en
  ese momento.
- Solo modo tabla; en modo payload devuelve `null` y la pantalla lo explica en
  vez de fingir que no hay nada suelto.

### El asistente: por qué se le puede dejar hablar

Fases 3 y 4: el modelo **sintetiza** los dos análisis anteriores y responde
repreguntas. Es la primera vez que la app llama a un LLM directamente (el motor
lo hace desde n8n).

- **Va SIEMPRE debajo de un panel determinístico.** El análisis correcto está en
  pantalla antes y sigue estando si el modelo falla: lo que se pierde es un
  extra, no el contenido. En un producto donde el error caro es *el número
  plausible y equivocado*, la explicación generada no puede ser lo único que se
  ve.
- ⚠️⚠️ **`verificarCifras` es el control, no el prompt.** Pedirle que no invente
  es una esperanza; comprobarlo es un control. Toda cifra de la respuesta tiene
  que aparecer en el texto que se le mandó (se aceptan redondeos y enteros ≤12
  como prosa). Si aparece una que nadie le dio, **la respuesta no se muestra**.
- ⚠️ **Por eso NO hay streaming**: hace falta la respuesta entera para poder
  verificarla, y enseñarla mientras llega sería enseñar texto sin comprobar.
  Son 2-3 frases; no había nada que ganar.
- ⚠️⚠️ **El contexto lo reconstruye el SERVIDOR.** El cliente manda ids
  (`loteId`, `jobId`, `partidaId`), nunca hallazgos: si el navegador pudiera
  enviar el texto contra el que se verifica, controlaría qué cifras se admiten y
  la comprobación dejaría de comprobar nada.
- ⚠️ **El prompt no crece con los datos del cliente.** Solo entran hallazgos ya
  agregados: un cliente 400 veces mayor da un prompt casi idéntico. Hay test.
  (Contrástese con `ia_llm_01_candidatos.js`, que llegó a 4,7 MB y 1,2 millones
  de tokens por meter filas.)
- **Sin `OPENAI_API_KEY` el asistente no existe** y la interfaz no lo ofrece —
  no hay botón roto. Mismo proveedor que n8n (`lmChatOpenAi`): una credencial y
  una factura.
- **Se pide al pulsar, no al cargar**: cada llamada cuesta y casi siempre el
  panel basta.
- **Las repreguntas están acotadas al análisis que se ve** (`MAX_TURNOS` 6). Un
  asistente que solo sabe de lo que tienes delante acierta siempre; uno que
  promete saberlo todo falla el primer día y ya no se vuelve a abrir.

⚠️ **Y NO genera SQL.** Se evaluó y se descartó: las reglas de negocio no viven
en el esquema (solo cuenta lo `aprobada`, los abonos son + y los cargos −, `auto`
descuenta saldo pero queda fuera de la tasa de acierto, el saldo real es
`importe − (aplicado − revertido)`…), así que una consulta generada correría,
devolvería un número y estaría mal. Además el filtro de empresa no está en el
esquema sino en el criterio —`admin` + `.eq("empresa_id")`— y con RLS puesto una
agregación libre se pasa del `statement_timeout`. Cuando una pregunta se repita
y ninguna herramienta la responda, el camino es **escribir esa función con
tests**, no dejar que el modelo la improvise.

### El asistente general (`/asistente`)

Convive con los dos acotados y **no los sustituye**: aquellos explican algo que
ya está calculado en pantalla; este consulta. Son garantías distintas, y por eso
aquí aprietan más.

- **No hay análisis debajo que lo respalde**: la respuesta es lo único que el
  usuario ve. De ahí que el system le prohíba responder de memoria — *«si no la
  consultaste, no la sabes»*— y que las cifras se verifiquen contra **lo que
  devolvieron las consultas**, no contra un texto preparado.
- **Cinco herramientas, lista cerrada** (`lib/ia/herramientas.ts`): por cobrar,
  por pagar, resumen de un período, últimas conciliaciones y estado de la
  cuenta. Todas se apoyan en funciones que ya existían y ya tenían tests.
- ⚠️ **Ninguna acepta `empresa_id`**: usan el cliente de sesión, así que la
  empresa sale de `auth.uid()`. Y aquí "fuera" incluye al propio modelo, que es
  quien compone los argumentos. Hay test que lo fija.
- ⚠️ **Ninguna escribe.** El asistente no aprueba, no concilia y no borra. Una
  acción destructiva disparada por una frase mal entendida no tiene arreglo, y
  la comodidad no lo compensa. También hay test.
- **Las listas llevan tope** (10 contrapartes, 5 conciliaciones): sin él el
  prompt volvería a crecer con los datos del cliente.
- **`MAX_RONDAS = 3`** de consulta, y la última fuerza `tool_choice: "none"`:
  un modelo indeciso agotaría el tope y dejaría al usuario sin respuesta.
- **Arranca con sugerencias, no con un campo vacío.** Un chat en blanco le pasa
  al usuario el trabajo de adivinar qué sabe responder, y la primera pregunta
  que se le ocurre a cualquiera suele ser justo la que no puede. Las sugerencias
  son el contrato.
- **Dice qué consultó** («Consultado en: Por cobrar»). Una cifra sin sitio donde
  comprobarla es una cifra que hay que creerse.

Diseño de las cuatro fases en `docs/diseno-diagnostico-ia.md`.

### Hallazgo de producto: el mes concilia mejor que el día

    corte del 30/06  → 88,44 %
    junio completo   → 99,03 %

El corte diario **parte pares** cuyo asiento y cobro caen en días distintos; la
ventana mensual los recupera. Contradice la intuición de que trocear ayuda:
trocear ayuda al *tamaño*, y perjudica al *resultado*. Con la capa exacta en SQL
ya no hace falta trocear, así que la recomendación al cliente cambia.

## ⚠️ Una tabla que cambia de tamaño de golpe necesita ANALYZE

El planificador decide con estadísticas. Cuando una tabla crece medio millón de
filas de una importación —o la reescribe una migración— esas estadísticas se
quedan viejas y elige planes malos **para la misma consulta que antes iba bien**.

Y el síntoma no apunta a esto. `residuo_internos` estaba medido en 1,68 s;
después de que la `0029` reescribiera `comprobantes` para añadir `ref_norm`,
empezó a pasarse del `statement_timeout` de 8 s sin que cambiara una línea de
código. Un `vacuum analyze` lo devolvió a 1,5 s.

Autovacuum acaba haciéndolo solo, pero tarda — y la ventana en la que no lo ha
hecho es **exactamente** cuando alguien concilia lo que acaba de importar.

- `analizar_tablas_conciliacion()` (`0030`) lo hace a petición. Va como
  SECURITY DEFINER porque `ANALYZE` exige ser dueño de la tabla y `service_role`
  no lo es.
- Las dos ingestas la llaman al terminar. Si falla no se interrumpe la carga:
  los datos están, y lo peor es una conciliación lenta.
- **Regla: toda migración que reescriba una tabla grande termina con `analyze`.**
  Añadir una columna `generated ... stored` la reescribe.

⚠️⚠️ **Y también dentro de un mismo proceso.** `conciliar_exacta` mete 447.795
filas en `matches_conciliacion` —vacía un segundo antes— y acto seguido se lee
el residuo con un anti-join contra ellas. El planificador todavía cree que la
tabla está vacía y elige un plan pensado para cero filas: se pasa de los 8 s.

Es una **carrera**, que es lo peor de depurar: minutos después autovacuum ya
analizó y la misma consulta tarda 1,3 s. Falla solo cuando se pide justo después
de escribir —o sea, siempre que alguien concilia de verdad— y nunca cuando uno
va a comprobarlo. Por eso `construirResiduo` llama a `analizar_tablas_conciliacion()`
entre la capa exacta y la lectura del residuo.

⚠️ **Y pasa DOS veces en el mismo circuito.** Al aprobar, `aplicaciones_cobro`
va de 0 a 447.795 filas en lotes, y el anti-join que decide qué queda por
aplicar consulta esa misma tabla mientras crece. La aprobación escribió 10.000
cobros y el tercer lote se canceló; minutos después el mismo lote tardaba 3,2 s.

Dos remedios, y hacen falta los dos:

1. La tabla se analiza **tras el primer lote** —el salto de 0 a algo es el que
   más despista al planificador— y luego cada 20, porque el orden de magnitud
   vuelve a cambiar.
2. Un lote cancelado **se reintenta** tras refrescar estadísticas, en vez de
   abortar la aprobación entera. Rendirse a la primera dejaba el saldo aplicado
   a medias, que es el peor estado posible.

**Regla general: toda tabla que se llene DURANTE un proceso y se consulte en
ese mismo proceso necesita un `analyze` intermedio.** No basta con analizar al
importar.

⚠️⚠️ **Y hacía falta una salida.** Aprobar son DOS escrituras —la transición
contable y el reparto del saldo— y la primera puede salir bien con la segunda a
medias. Desde `aprobada`, `cicloContable` ya no ofrece "Aprobar", así que no
había forma de reintentar: la conciliación decía que regía mientras 437.795
comprobantes seguían figurando como no cobrados.

Un callejón sin salida, y de los que no se ven: **el saldo equivocado no
protesta**. `estadoCobros` compara los pares confirmados con las aplicaciones
escritas, y cuando no cuadran el panel lo dice y ofrece
**"Reintentar la aplicación de cobros"**, que continúa donde se quedó.

Lección: cuando una acción hace dos cosas y una puede fallar sola, **el estado
intermedio necesita su propio camino de vuelta**. Basta con que no exista para
que un fallo recuperable se vuelva permanente.

## ⚠️ RLS cuesta una llamada a función POR FILA (y a 450.000 se nota)

El hallazgo más caro de dimensionar el cliente grande, y no estaba en ninguna
lista de sospechosos.

La política de `comprobantes` es `es_miembro(empresa_id)`: una función sobre una
**columna**. Aunque esté marcada `stable`, Postgres no puede tratarla como
constante ni usarla en un índice, así que **la ejecuta una vez por fila**. Con
452.309 comprobantes, la misma agregación:

    sin RLS (rol postgres, filtro explícito de empresa) →    187 ms
    con RLS (rol authenticated)                        →  9.500 ms

**50× de diferencia**, y por encima del `statement_timeout` de 8 s: la consulta
no es que fuera lenta, es que **fallaba**.

`resumen_saldos` (migración `0021`) lo resuelve como ya hacían las funciones de
la `0013`: **`SECURITY DEFINER`** con la pertenencia resuelta **una sola vez**.

    with mias as (select empresa_id from usuarios_empresa where usuario_id = auth.uid())
    ... where c.empresa_id in (select empresa_id from mias)

Resultado: **1,14 s** para las 452.309 filas de WIN, 592 ms para las 15.008 de
la otra empresa, con totales idénticos a los de antes.

⚠️⚠️ **Con `SECURITY DEFINER`, RLS deja de aplicar dentro y esa línea `in` ES la
frontera de seguridad.** Reglas al escribir una función así:

- La empresa sale **siempre** de `auth.uid()`. La función **nunca** acepta un
  `empresa_id` por parámetro — sería un `?empresa_id=` en manos de cualquiera.
- `set search_path = public`, o el dueño de la función es quien decida qué
  tabla se lee.
- **`revoke ... from public, anon` explícito.** Postgres concede EXECUTE a
  `public` por defecto en cada función nueva; sin el revoke, `anon` puede
  invocar una función `definer`. Hoy devolvería vacío (sin `auth.uid()` no hay
  empresa), pero dejar la puerta abierta fiándolo al buen comportamiento del
  cuerpo es justo lo que no se hace con `definer`.
- Verificado: sin sesión y como `anon`, **0 filas**; tras el revoke, permiso
  denegado. Y cada empresa ve solo sus cifras.

⚠️⚠️ **Al mover una consulta de RLS a `service_role`, hay que reescribir a mano
cada condición que RLS ponía por debajo.** Es el riesgo real de este remedio y
casi cuesta caro: `vaciarComprobantes` filtraba con `not("id","is",null)` y un
comentario que decía *"RLS ya acota"* — cierto con el cliente `anon`, **falso**
con `admin`. Al cambiar de cliente por rendimiento, esa misma línea pasaba a
borrar los comprobantes de **todas las empresas del sistema**.

Regla: toda consulta con `admin` lleva su `.eq("empresa_id", …)` explícito,
aunque el otro filtro parezca bastar.

⚠️ **Y el reverso: una función `SECURITY DEFINER` que resuelve la empresa desde
`auth.uid()` NO puede llamarse con `admin`** — no hay usuario, así que devuelve
**cero filas sin error**. Pasó con `lotes_importacion` en `/comprobantes`: la
página había pasado a `admin` por rendimiento y la sección de cargas
desapareció en silencio, que es la peor forma de fallar.

Las dos clases de consulta conviven en la misma página y hay que elegir la
correcta para cada una:

| | cliente | por qué |
|---|---|---|
| Recorre muchas filas | `admin` + `.eq("empresa_id")` | RLS cobra por fila |
| RPC que agrupa en la base | **sesión** | resuelve la empresa por `auth.uid()` |

**Dónde más aplica:** cualquier consulta que recorra muchas filas de una tabla
con RLS paga este peaje. Si algo va inexplicablemente lento a volumen, medir la
misma consulta como `postgres` antes de buscar en otro sitio.

### Los tres sitios donde ya mordió, y cómo se disfrazó cada uno

El peaje no se manifiesta como lentitud. Se manifiesta como **una respuesta
tranquilizadora y falsa**, porque quien recibe el error se lo traga:

| Dónde | Lo que se veía |
|---|---|
| Por cobrar / Por pagar | un minuto de espera, y Por pagar tardaba igual **para no traer nada** |
| Importar comprobantes | *"Se intentó cargar un comprobante que ya existe. Vuelve a intentarlo"* — y repetir daba lo mismo. El conjunto de series existentes salía vacío al morir la consulta, así que intentaba insertarlas todas |
| Paso 1 del wizard | **"No hay comprobantes en este período"** sobre 452.309 que sí estaban |

Los tres compartían el mismo par de causas: **recorrer una tabla grande a
través de RLS** y **descartar el error en silencio**. El remedio también es el
mismo: contar/leer en la base con la pertenencia resuelta una vez
(`resumen_saldos` 0021, `resumen_comprobantes_periodo` 0027) o con `admin` y
filtro explícito de empresa, y **comprobar siempre el error** — devolver ceros
donde hay medio millón de filas es peor que fallar.

## Filtrar en la consulta, no en memoria (Por cobrar / Por pagar)

Las dos pantallas se traían la tabla **entera** y descartaban después lo que
`calcularAging` no cuenta. Con 51.427 comprobantes eran 52 peticiones paginadas
—cerca de **un minuto**— para quedarse con 19.221 en Por cobrar…

⚠️ …y con **ninguno** en Por pagar: la pantalla tardaba **lo mismo en no
encontrar nada**, porque todo el trabajo se hacía antes de saber que esa empresa
no tiene un solo comprobante de tipo `pago`. Ese síntoma es el que delata el
patrón — si una vista vacía tarda igual que una llena, el filtro está en el
sitio equivocado.

`calcularAging` descarta exactamente tres cosas, y las tres saben decirse en
SQL: el tipo contrario, lo anulado/cobrado, y el saldo cero. Traerlas para
tirarlas era trabajo puro.

- **La regla vive en UN sitio**: `cuentaComoPendiente` en `lib/aging.ts`.
  `lib/comprobantesSaldo.ts` la reproduce en SQL, y hay tests que la fijan —
  incluido uno que comprueba que **prefiltrar da el mismo resultado** que dejar
  que `calcularAging` agregue todo.
- ⚠️ **Es el único punto donde el sistema depende de que dos lenguajes digan lo
  mismo.** Si se separan, la pantalla enseñaría un total que no corresponde a
  sus propias filas, y el usuario no tendría cómo saber cuál creerse.
- Un comprobante **sin tipo se cuenta como cobranza**, así que ese lado filtra
  `tipo.eq.cobranza,tipo.is.null` — no basta con `eq`.

**Nota de escala:** esto baja Por cobrar de 52 peticiones a ~20 y Por pagar a
una. Si algún día 20 siguen siendo demasiadas, el paso siguiente es agregar en
SQL (vista o RPC) y devolver las pocas filas del resumen, no traer 19.000 para
sumarlas en Node.

## ⚠️⚠️ Un índice PARCIAL solo se usa si repites su condición

Los dos índices de referencias son parciales, porque las filas sin código no
participan del emparejamiento (0029 / 0042):

```sql
create index idx_mov_extracto_ref_norm
  on movimientos_extracto (lote_id, ref_norm)
  where ref_norm <> '';                          -- ← la condición
```

Una consulta que pregunte `where lote_id = X and ref_norm = $1` **no puede usar
ese índice**: Postgres no sabe si `$1` es la cadena vacía —viene de otra fila, no
es una constante— así que no puede garantizar que lo buscado esté dentro del
índice, y lo descarta. Cae a recorrer la tabla, y con 450.999 filas por sonda eso
agota el `statement_timeout` de 8 s él solo.

Costó **cuatro migraciones y cuatro despliegues**. `residuo_explicado` (0044)
hacía justo eso, y cada intento de arreglarlo atacó otra cosa —el anti-join, el
origen de los datos, la estimación de filas— sin rozar la causa. La pista estaba
a la vista: `pares_exactos` empareja medio millón de filas en 32 s y lleva
`and c.ref_norm <> ''` escrito desde siempre.

- **Regla: toda consulta contra una columna con índice parcial repite el `where`
  del índice.** Aunque sea redundante para el resultado — no lo es para el plan.
- ⚠️ **Y la regla de método, que es la que de verdad falló:** cuando algo se pasa
  de tiempo, `explain analyze` ANTES de la segunda hipótesis. Comparar filas
  estimadas contra reales señala el nodo en un minuto; razonar sobre el código
  costó cuatro rondas. `ops/medir-residuo.sql` deja la sonda aislada para poder
  hacerlo desde Studio — que es obligatorio, porque una función `definer` que
  resuelve la empresa con `auth.uid()` **no se puede medir llamándola**: sin
  sesión devuelve `null` al instante.

## ⚠️ Postgres corta a los 8 s, y supabase-js NO lanza el error

Hermano de los otros topes silenciosos, y el más caro de todos: aquí lo que se
pierde es **el cobro**.

Al aprobar el corte de 36.377 partidas, `sincronizarCobranzas` insertaba las
**32.170 aplicaciones en UNA sola llamada**. El log de PostgREST:

```
{"code":"57014","message":"canceling statement due to statement timeout"}
POST /aplicaciones_cobro ... 500
```

**El rol `authenticator`, con el que se conecta PostgREST, lleva
`statement_timeout=8s`** (por defecto en Supabase self-hosted). Cada fila dispara
además el trigger que recalcula el saldo del comprobante (`0008`), así que el
coste crece con las filas y 32.170 no caben ni de lejos.

⚠️ **Y el error no se veía**, que es lo que lo volvió grave: `supabase-js`
**devuelve** el error en `{ error }`, no lo lanza, así que el `try/catch` no se
enteraba y el código seguía. Resultado: una conciliación **aprobada** que
anunciaba "ya descuenta el saldo de tus comprobantes" con **cero filas
escritas**. Se descubrió de rebote, porque el aviso previo a aprobar dijo la
verdad —"no tenía cobros aplicados"— sobre una aprobación que se creía correcta.

- **Lotes de 500.** Al ritmo medido son décimas de segundo contra un techo de 8.
- **Se comprueba el error de cada lote** y `sincronizarCobranzas` devuelve
  `{ ok, aplicadas }`. Si el saldo no se aplicó del todo, la pantalla lo dice en
  rojo en vez de anunciar el cobro: **afirmar un cobro que no ocurrió es peor
  que un error feo**.
- La aprobación en sí **no se revierte**: son escrituras distintas y la
  transición contable sí ocurrió. Se reintenta volviendo a aprobar.
- Aprobar 32.000 cobros tarda ~90 s, y la mayor parte no es el insert sino
  `disponiblePorComprobante`: 364 lotes × 3 consultas, porque el `.in()` con
  UUID se trocea de 100 en 100 por longitud de URL.

**Regla:** toda escritura cuyo número de filas dependa de los datos del cliente
va **por lotes y con el error comprobado**. Un `await supabase.from(...).insert()`
sin desestructurar `{ error }` es un fallo silencioso esperando volumen.

## Aprobar no falla por solaparse: reemplaza, y ahora avisa antes

`aprobar_conciliacion` degrada a `reemplazada` las aprobadas que se crucen con
el rango y **borra sus aplicaciones de cobro**. Es lo correcto —dos
conciliaciones vigentes sobre el mismo día contarían el saldo dos veces— pero
era **invisible hasta después**: la pantalla lo contaba en el mensaje de éxito,
cuando `reemplazada` ya es un estado terminal y no hay vuelta atrás.

⚠️ Duele sobre todo **al cruzar granularidades**, que es lo que el rango de
fechas acaba de hacer posible. Aprobar el corte del 30/06 sobre un junio ya
aprobado deja sin cobros los otros 29 días de golpe, y recuperarlos exige
volver a ejecutar el mes.

- `impactoDeAprobar(jobId)` consulta **antes de preguntar** qué aprobadas se
  cruzan y cuántas `aplicaciones_cobro` se borrarían.
- ⚠️ Reproduce el **mismo criterio de solape que la base**
  (`daterange(desde, hasta, '[]') &&`, ambos extremos incluidos) escrito como
  filtros `lte`/`gte`. Si los dos dejaran de coincidir, el aviso mentiría — y un
  aviso que miente es peor que no avisar.
- `avisoDeReemplazo` (puro, con tests) redacta el texto y devuelve **`null`
  cuando no hay nada que reemplazar**: entonces no se pregunta nada. Un diálogo
  que sale siempre se aprende a despachar sin leer, y deja de proteger justo el
  día que dice algo importante.
- **El número de cobros es lo que mide el daño.** "Reemplaza una conciliación"
  suena a trámite; "se borrarán 1.234 cobros aplicados y esos saldos vuelven a
  pendiente" es la frase que hace parar. Y cuando son cero, se dice también:
  callarlo haría dudar de una acción que no toca el dinero.

## Cuando n8n acepta y luego se muere

`POST /api/conciliacion/iniciar` ya marcaba `error` en tres casos: n8n
inalcanzable, respuesta que no es 2xx, y conteos recibidos distintos de los
enviados. Lo que no cubría —y no puede— es que **n8n acepte con 200 y muera
después**: el flujo responde en su SEGUNDO nodo, así que la aceptación no
promete nada sobre los ocho siguientes. Si el runner aborta o el contenedor se
reinicia, el job se queda en `procesando` y nadie lo saca de ahí.

⚠️ **El daño no es la pantalla girando.** Un job en `pendiente` o `procesando`
**retiene la clave de idempotencia** (cuenta + período), así que el usuario
tampoco podía relanzar ese período: quedaba encerrado sin saber por qué.

`src/lib/jobsAtascados.ts` (puro, con tests) clasifica en `normal | lento |
detenido` por tiempo transcurrido. Umbrales **5 y 30 minutos**, medidos contra
producción:

    68.571 partidas → 23–34 s
    39.961 partidas → 14–49 s

O sea que van 50× por encima de lo observado, a propósito: la capa de IA depende
de un LLM externo y una corrida con miles de adjudicaciones puede tardar minutos
legítimamente. Un falso "detenida" cuesta más que esperar de más — empuja a
relanzar algo que iba a terminar.

- **No se marca `error` sola.** Un temporizador no sabe si n8n murió o si va
  lento; declarar fallida una conciliación que está terminando sería inventarse
  un hecho. Se describe lo observable ("lleva 34 minutos") y decide quien mira.
- **Lo que sí se hace sin preguntar es dejar de bloquear el relanzamiento**, que
  no afirma nada y desencalla al usuario.
- El badge del historial pasa a **"Interrumpida" en ámbar, no en rojo**: nadie
  ha comprobado que fallara, solo que dejó de avanzar. El color no debe afirmar
  más que el texto.

**Por qué no un Error Workflow de n8n:** el payload del Error Trigger solo trae
metadatos de la ejecución (`execution.id`, `workflow`, el mensaje) — **no el
`job_id`**, que viajaba en el body del webhook. Marcar el job correcto exigiría
consultar la API de n8n con otra credencial, y aun así no cubriría el caso de
que n8n esté caído del todo, que es justo cuando más falta hace. El vigilante
vive en la app porque solo ahí se sabe qué se esperaba y desde cuándo.

## El cuadre bancario: los pendientes del banco se RESTAN

El cuadre es el veredicto que el cliente le enseña a su contador, y un error
aquí no se ve: sale un número plausible. Tenía dos, y se tapaban entre sí.

La fórmula, con la convención de signos única (abonos +, cargos −):

```
banco ajustado = saldo extracto
               + pendientes de LIBROS  (depósitos en tránsito + cheques)
               − pendientes del BANCO  (abonos + cargos no registrados)
```

**Los de libros se suman** porque el extracto todavía no los refleja; **los del
banco se restan** porque el extracto ya los incluye y los libros no. Cuando toda
diferencia es una partida conocida, `diferencia` da **0** — y demostrar eso es
lo único que el cuadre hace.

Lo que estaba mal en `04_ensamblar.js`:

1. **Los abonos del banco no se contaban en ningún renglón.**
   `cargos_no_registrados` filtraba `monto < 0`, así que un depósito que el
   banco trae y los libros no desaparecía del informe. En el corte del 30/06 de
   la recaudadora se evaporaron 24 movimientos (S/ 2.067,49).
2. **Los cargos se sumaban en vez de restarse.** Con una comisión de −50 que el
   extracto ya descontó, lo correcto es `libros = extracto + 50`. Sumarla daba
   `−100`: no la corregía, la duplicaba con el signo cambiado.

Juntos hacían que **el cuadre no pudiera cerrar aunque todo estuviera
explicado**, que es exactamente el caso en que tiene que cerrar.

⚠️ **Y había un tercero, que solo se ve a volumen.** Las diferencias DENTRO de
un par emparejado no entraban: un comprobante de 100 casado con un depósito de
80 deja 20 sin explicar, y ninguna de las dos partidas está "pendiente", así que
ese hueco se escapaba.

Con la capa exacta siempre es cero —casa por importe idéntico— y por eso estuvo
escondido. Se destapó con junio completo de la recaudadora: el cuadre daba
**S/ 117.697,49** y la resta independiente de los dos lados **S/ 117.717,49**.
Faltaban 20 soles exactos, que eran la diferencia de **un solo par** propuesto
por la IA entre 447.796.

La lección de método: **el cuadre se verifica contra la resta de los totales de
los dos lados**, no contra sí mismo. Es la única comprobación que no comparte
supuestos con lo que está comprobando.

- ⚠️ `abonos_no_registrados` es `Monto.default(0)`, **no requerido**: los
  resultados viven como JSONB en la fila del job y no se migran, así que
  exigirlo dejaría ilegible todo el histórico. Cero es además lo honesto — no se
  recalculan hacia atrás, el informe sigue diciendo lo que dijo el día que se
  emitió. Mismo criterio que `DecisionHumana.motivo`.
- **Los signos de las etiquetas describen el EFECTO sobre el saldo, no la
  operación**: las partidas ya vienen firmadas, así que "+ Cheques no cobrados"
  restaría y confundiría a quien lee el detalle.
- Hay tests en `tests/n8nNodos.test.ts` — segunda excepción deliberada a "los
  nodos Code no se testean unitariamente", por el mismo motivo que la agrupación:
  el fallo produce un resultado **plausible y equivocado**.

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

**Los dos lados de la pantalla son simétricos, y eso no es estética.** El Paso 1
enfrenta *tus registros* contra *los del banco*, pero solo el banco tenía zona de
carga: los comprobantes eran una tarjeta de texto cuyo botón de subir vivía en
otro bloque, más abajo, bajo el título "¿No tienes sistema? Usa la plantilla".
Había que leer la pantalla entera para descubrir dónde se cargan, y la lectura
"esto contra esto" se perdía. `ZonaComprobantes` es el gemelo de `UploadZone`
—mismo punteado vacío, misma tarjeta verde cargada— con la carga dentro y
"Cancelar esta carga" junto a lo que cuenta.

⚠️ **"Cancelar esta carga" quita los del PERÍODO, no la última importación.**
Son dos cosas distintas y ambas existen a propósito: aquí se quita lo que la
tarjeta acaba de contar (lo que el usuario ve), mientras que "Quitar esta carga"
en `/comprobantes` opera por `lote_importacion`. Confundirlas haría que cancelar
en el wizard se llevara filas de otros meses.

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

**El período: mes calendario o rango libre.** El desplegable sigue listando los
últimos 12 meses —es lo que quiere una PyME y es la primera opción—, y al final
tiene **"Rango de fechas…"**, que despliega dos campos.

No es una comodidad: el mes era el **cuello de botella del caso de volumen**. Una
recaudadora de 450.000 movimientos al mes concilia por día (su pico son 36.390
partidas, que el motor ya despacha), pero con solo meses la única petición
expresable era "Junio entero" = 452.605 partidas, por encima de cualquier tope
razonable. El motor aguantaba lo que la pantalla no dejaba pedir.

- El resto del sistema **no necesitó cambios**: `validarCoherencia` ya recibía
  `{desde, hasta}`, la idempotencia y el versionado comparan las dos fechas
  exactas, y los reportes deduplican por rango exacto —no por mes— desde la
  Fase 9. La suposición "un período es un mes" solo vivía en el desplegable.
- ⚠️ **Un rango inválido deja `periodo` en `null` y bloquea**, no cae a un mes
  por defecto. Conciliar un período que el usuario no pidió produce un resultado
  que *parece* correcto, que es la clase de error más cara de este producto.
- Al pasar a rango se **hereda el mes que estuviera a la vista**, para entrar
  viendo un rango válido y estrecharlo en vez de encontrarse dos casillas
  vacías. Mismo día en ambos campos = corte de un día, y la etiqueta lo dice así
  ("30/06/2026", no "30/06/2026 a 30/06/2026").
- Funciones puras en `src/lib/periodo.ts` (`periodoDeRango`, `VALOR_RANGO`) con
  tests en `tests/periodo.test.ts`.

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

## Resumen ejecutivo (`/resumen`)

Los reportes responden *cómo fue la conciliación*; esto responde *cómo está la
empresa*. Es otra pregunta y la hace otra persona: quien decide si puede pagar
la planilla, a quién reclamar, y si puede fiarse de sus propios saldos. Por eso
va **debajo** de Reportes en la navegación y no dentro.

⚠️ **DOS RELOJES, y confundirlos hace mentir al número.** Lo conciliado
pertenece a un período; lo que te deben es una foto de **hoy**. Un "por cobrar
de junio" no significa nada —o son las facturas emitidas en junio, que quizá ya
se cobraron, o el saldo vivo, que no es de junio—. La pantalla los separa en dos
bloques y lo dice con todas las letras.

Orden deliberado: **dinero → confianza → detalle**. Empezar por métricas de
proceso hace que el gerente cierre la pestaña.

- **La posición neta se muestra, pero nunca sola.** El aging jamás mezcla cobrar
  con pagar —ahí es correcto: se gestionan distinto— pero aquí la pregunta *«si
  todo se cobra y todo se paga, ¿me queda a favor?»* sí existe y es de
  dirección. Lo que la cifra **no** dice es el calendario: cobrar a 90 días y
  pagar a 30 da neto positivo y aun así te deja sin caja. La pantalla lo advierte
  junto al número.
- **Solo cuenta lo APROBADO**, y avisa de las conciliaciones terminadas sin
  aprobar: su trabajo está hecho pero no ha movido un céntimo, y callarlo daría
  a entender que se perdió.
- **`porcentajeAutomatizado` devuelve `null`, no `0`**, cuando no hubo partidas.
  0% diría "no automatizó nada"; null dice "no había nada que automatizar". Son
  dos conversaciones distintas con el dueño.
- Todo se agrega en la base (`resumen_ejecutivo`, migración `0032`): con 452.309
  comprobantes, traerlos para sumarlos en Node es lo que la parte B eliminó.

⚠️ **`0033` existe por un efecto de segundo orden que casi pasa desapercibido.**
El total de partidas de una conciliación salía de contar comprobantes *no
cobrados*; al aprobar, 447.795 pasaban a `cobrado` y el total se desplomaba de
452.177 a 4.382. El resumen **se degradaba solo**, y como la pantalla recalcula
en cada carga, el número empeoraba cada vez que alguien lo miraba. Ahora se
cuenta lo que la conciliación TOCÓ, que ya no cambia.

## Posición de caja (`/caja`) — fase 1 de la plataforma financiera

Primer módulo del salto de «sistema de conciliaciones» a plataforma financiera
(ver `docs/diseno-posicion-caja.md`). Responde **«¿cuánta plata tengo?»**.

Lo que lo hace distinto de cualquier dashboard es que **no suma movimientos: lee
conciliaciones aprobadas**. Es la primera pantalla que puede afirmar algo sobre
el dinero de la empresa porque está probado contra el extracto del banco.

De ahí la regla que gobierna el módulo entero:

> ⚠️⚠️ **Ninguna cifra de caja se muestra sin su fecha de corte.** El sistema
> solo conoce el saldo al cierre del último período conciliado, así que a mitad
> de agosto el saldo puede ser del 31 de julio. Eso no es un defecto —es la
> naturaleza del dato— pero callarlo sí lo sería: es exactamente el número
> plausible que nadie puede fechar.

`frescuraDelCorte` clasifica en `al_dia` (≤40 días) / `retraso` (41–70) /
`desfasado` (>70). Los umbrales suponen cierre **mensual**: el mes M se concilia
en los primeros días de M+1, así que el corte más reciente posible ronda los 30-35
días. **El aviso no bloquea nada** —las cifras siguen siendo verdad sobre su
fecha— pero cambia cuál es el botón negro, mismo criterio que el diagnóstico
previo del Paso 3.

**El saldo y los movimientos NO salen del mismo sitio, y esa es la decisión
central.** El sistema permite conciliar un mes por cortes (01–05, 06–17, 18–30):

- El **saldo** es el del **último** corte. Un saldo no se suma: el del 30 ya
  incluye lo anterior, y sumar los tres cortes triplicaría la caja.
- Las **entradas y salidas** sí se **suman**, sobre todos los cortes del mes.
  Enseñar solo las del último tramo diría «entraron 180.000» en un mes de
  600.000, y nadie tendría cómo notarlo.

Por eso `posicion_caja()` devuelve además `cortes`, `mov_desde` y `mov_hasta`:
la pantalla **rotula exactamente lo que sumó** («01/07 al 30/07 · 3 cortes») en
vez de decir «julio», que prometería un mes completo.

- ⚠️⚠️ **Lo que hace posible sumar sin contar dos veces es el `exclude using
  gist` de la `0012`**: no puede haber dos aprobadas con rangos solapados en la
  misma cuenta. Sin esa garantía, dos corridas del mismo mes duplicarían el
  saldo y el error sería **invisible**. Es la clase de cimiento que justifica
  haber puesto la regla en Postgres y no en la aplicación.
- ⚠️ **Un `saldo_final_banco` nulo NO cuenta como cero.** Cero significa «no hay
  plata»; nulo, «no lo sé». Va a `sinSaldo` y la pantalla lo nombra. Igual con
  las cuentas sin ninguna aprobada: salen con todo en `null` (LEFT JOIN a
  propósito), porque omitirlas haría que el total pareciera completo.
- ⚠️ **El total hereda el corte MÁS ANTIGUO** de las cuentas que lo componen. Un
  total solo vale lo que valga su parte más vieja; quedarse con la fecha más
  reciente sería maquillar y promediar fechas no significa nada.
- ⚠️ **«Disponible» lleva SIEMPRE su fórmula al lado** («S/ 138.268 en bancos −
  S/ 18.900 que ya debías»). Un número llamado así sin decir qué se le restó
  invita a gastárselo. Y **no se recorta a cero** si sale negativo: deber más de
  lo que hay es un hecho.
- **Un bloque por moneda, sin sumar entre ellas** y sin filtrar a una sola
  (misma regla que `agingPorMoneda`). Sin conversión: el tipo de cambio es otra
  funcionalidad y hacerla a medias es peor que no hacerla (`0041`).
- **Lo vencido se reutiliza de Por pagar** (`traerResumenSaldos`), no se
  recalcula: si cada pantalla lo hiciera por su lado acabarían discrepando.
- ⚠️ **`movs` mira DOS orígenes** porque hay dos modos de conciliar y los dos
  siguen vivos: `movimientos_extracto` (modo tabla) y
  `payload_entrada->movimientos_bancarios` (modo payload, los jobs anteriores a
  la parte B). Mirar solo el primero dejaría las conciliaciones antiguas con
  «Entradas 0» junto a un saldo real.
- **Sin ninguna aprobada, estado vacío — no ceros.** «S/ 0,00» diría que no
  tienes dinero, que es una afirmación que nadie hizo.
- Si el reparto de cobros de una aprobada quedó a medias (`estadoCobros`), se
  avisa: no afecta al saldo bancario —sale del extracto— pero sí a lo vencido,
  así que el disponible se queda corto.

Lógica pura en `src/lib/posicionCaja.ts` (con tests); la lectura, en
`posicionCaja-servidor.ts`. **Cero cambios en tablas, cero cambios en el motor,
ninguna pantalla existente cambia de comportamiento**: si la fase 1 se revierte,
basta con quitar la ruta.

**Lo que NO hace, a propósito:** no proyecta nada, no admite un saldo tecleado a
mano (sería un dato sin respaldo que contamina la única cifra probada del
producto) y usa el **extracto**, no las aplicaciones de cobro — que son solo la
parte que encontró pareja, y darían una caja que ignora los cargos no
registrados, justo las partidas que el cuadre existe para sacar a la luz.

### El saldo de hoy, sin fingir que está conciliado (fase 2)

La fase 1 dice cuánto había al cierre del último período conciliado. A mitad de
mes eso es verdad y es viejo, y el desfase es **estructural**: aunque el cliente
cierre el día 3, del 4 al 31 la cifra vuelve a envejecer. No se arregla
conciliando más rápido — hay que traer otro dato.

La salida es **subir el extracto del mes en curso y NO conciliarlo**
(`docs/diseno-saldo-vivo.md`).

> ⚠️⚠️ **Lo provisional nunca se suma con lo probado, y nunca hereda su
> aspecto.** Dos recuadros, dos fechas, dos tonos. En cuanto se funden en un
> total, el producto pierde lo único que lo distingue de cualquier dashboard:
> poder decir «esto está probado contra el extracto».

**De dónde sale el número**, en este orden: (a) el `saldo` de la última fila del
extracto —**lo declara el banco**, así que no puede tener un error nuestro—; y
si el archivo no trae esa columna, (b) el último saldo aprobado + los
movimientos posteriores. **Sin ninguno de los dos se devuelve `null`**: sumar
movimientos sin saber de qué saldo se parte da un flujo, no un saldo.

- ⚠️ **La guarda de solape no es opcional.** (b) solo suma movimientos con
  `fecha > periodo_hasta` del último aprobado. Un extracto que empieza el 01/08
  sobre un aprobado que llega al 31/07 va bien; uno que empieza el 25/07 —lo
  normal al descargar «los últimos 30 días»— contaría cinco días dos veces y
  daría un saldo alto y perfectamente plausible.
- ⚠️⚠️ **`origen` es lo que hace posible el módulo.** `lote_id` es un uuid suelto
  y **los lotes huérfanos se acumulan**: el Paso 2 del wizard crea el lote antes
  de que el Paso 3 dispare nada, así que todo intento abandonado deja uno, y no
  hay ni un `delete` de `movimientos_extracto` en la aplicación. «El último lote
  sin job» dejaría que un intento a medias mandara sobre la caja. Solo cuenta lo
  subido **desde `/caja` a propósito** (`extractos_cargados`, `0051`).
- ⚠️ **`movimientos_extracto.saldo` existía desde la `0022` y nunca se
  escribía**: la ingesta calculaba el saldo de la última fila en memoria, lo
  devolvía al wizard y ahí moría si nadie llegaba a iniciar la conciliación. La
  fase 2 es en buena parte empezar a guardar un dato que ya se leía — y el saldo
  por día es la materia prima de la proyección.
- ⚠️⚠️ **Y el saldo NO viene del mapeo: la ingesta lo detecta.** `CAMPOS` de
  `deteccion.ts` tiene seis campos y ninguno es el saldo, así que el Paso 2
  nunca lo pregunta y `mapeo.saldo` **no llega nunca relleno**. La primera
  versión se fiaba de él (`if (mapeo.saldo)`), así que `saldo` y
  `saldo_declarado` salían siempre nulos y el camino principal —«lo declara el
  banco»— era **código inalcanzable**: la caja rotulaba «calculado» sobre
  extractos del BCP que traen su columna `Saldo` perfectamente. Ahora la ruta
  llama a `columnaSaldo(headers)`, que es la misma regla que ya usaba el wizard.
  Hay test de que `saldo` sigue fuera de `CAMPOS`.
- ⚠️⚠️ **Un extracto que NO pasa del último corte aprobado no dice nada de hoy,
  y por eso no produce saldo vivo.** Sin esa guarda el módulo daba su peor
  salida: al resubir julio sobre julio ya conciliado no queda ni un movimiento
  posterior, así que el saldo derivado era el aprobado **tal cual** y la
  pantalla enseñaba *«Saldo declarado 1.271.478,87 · Diferencia 0,00»* — que se
  lee como «el banco confirma tu conciliación» cuando la cifra se había copiado
  de la propia conciliación. Una comprobación **circular disfrazada de
  corroboración independiente**. Con columna de saldo el número sí sería del
  banco, pero seguiría siendo la verificación de un corte pasado —otra
  pregunta—, así que el corte se aplica igual y la pantalla pide el extracto del
  período siguiente.
- ⚠️ **El rótulo sigue a la FUENTE.** La primera versión titulaba siempre
  «Según el banco · Saldo declarado» y debajo, en letra pequeña, «calculado
  sobre tu última conciliación»: el titular afirmaba una cosa y el detalle otra,
  y quien lee el titular se queda con que lo dijo el banco. Con cualquier cifra
  derivada pasa a «Estimado a hoy · Saldo estimado» (`rotulos`).
- ⚠️ **Un extracto subido que no produce saldo vivo se EXPLICA**
  (`SinSaldoVivo` + `frasePorLaQueNoHay`), no vuelve a enseñar el botón de
  subir: repetir el botón invita a repetir exactamente lo que no funcionó.
- ⚠️ **El provisional NO alimenta el «disponible».** Restar deuda vencida a un
  saldo sin conciliar produce el número con el que alguien decide si paga, que
  es justo la decisión que no puede apoyarse en algo sin probar.
- ⚠️ **Caduca a los 10 días** (`DIAS_VIGENCIA`). Un saldo vivo rancio es peor que
  no tenerlo: ocupa el sitio de arriba y hereda la confianza de estar ahí sin
  merecerla. No se esconde —sigue siendo cierto sobre su fecha— pero deja de
  anunciarse como el saldo de hoy.
- ⚠️ **No hay total si falta una cuenta.** Un provisional al que le falta una
  cuenta entera saldría MÁS BAJO que el probado y parecería que el dinero
  desapareció, sin nada que lo delatara. Se enseña el detalle por cuenta y se
  dice cuántas faltan.
- **La diferencia se muestra en DINERO, no en porcentaje**: «S/ 14.671,90 sin
  explicar» mueve a conciliar; «96 % de acuerdo» invita a no hacerlo. Y se
  muestra, no se explica — explicarla *es* conciliar, y el botón está al lado.
- **No hay segunda pantalla de mapeo**: la carga desde `/caja` usa el formato
  que la cuenta aprendió conciliando. Sin formato guardado no se adivina, se
  manda al wizard — elegir columnas es la decisión que más se equivoca y su
  error no se ve (sale un 0 %).
- ⚠️ Si la `0051` no está aplicada, la RPC falla y `/caja` sigue funcionando sin
  el bloque. Un añadido no puede tumbar lo que ya servía.

**El riesgo a vigilar, escrito por delante:** que el saldo vivo canibalice la
conciliación. Si el número de hoy está a la vista sin conciliar nada, ¿para qué
conciliar? Es el modo de fallo natural de esta función, y las cinco reglas de
arriba existen para acotarlo.

Lógica pura en `src/lib/saldoVivo.ts` (con tests). **El extracto subido aquí no
se concilia solo**: conciliar exige elegir período y revisar, y hacerlo por
detrás produciría conciliaciones que nadie pidió y que además pelearían por el
`exclude using gist` de la `0012` con las que sí.

## Aprendizaje IA: sección propia y de núcleo

`/aprendizaje` es el **diferenciador comercial** del producto: no concilia mejor
que otro sistema en abstracto, concilia como **esta** empresa. Por eso dejó de
vivir repartido —un panel en `/reportes`, una tarjeta en `/dashboard`, ambos
hospedados dentro de `ReporteVista.tsx`— y tiene su propia ruta.

- **Es núcleo y no se puede desactivar**: poner detrás de una puerta la razón
  por la que alguien compra el sistema debilita el argumento principal. (Hoy
  esto ya no distingue a nada: **el sistema entero se vende junto** y tampoco
  `cobranzas` se contrata aparte — ver "El sistema se vende ENTERO". La nota se
  conserva porque explica por qué el aprendizaje nunca pasó por
  `suscripciones_modulo` ni siquiera cuando esa tabla decidía accesos.)
- **En el panel de control queda un gancho de una línea**, no el detalle.
  Borrarlo del todo habría vuelto el aprendizaje *menos* visible —el panel se
  mira a diario, la sección dos veces al mes—, justo lo contrario del objetivo.
  A diferencia de la tarjeta anterior, el gancho **no desaparece cuando no hay
  decisiones**: durante la prueba gratuita es cuando más falta hace explicar qué
  se gana quedándose.
- La consulta del pool (últimos 30 jobs) estaba **copiada en dos pantallas** y
  ahora vive en `lib/aprendizaje-servidor.ts`. ⚠️ Su `LIMITE_JOBS` debe seguir al
  del backend: lo que la pantalla enseña tiene que ser exactamente lo que
  alimenta el prompt, no una aproximación.

### La métrica: ¿de verdad está aprendiendo?

`src/lib/aprendizajeMetricas.ts` (puro, con tests) calcula la **tasa de acierto
de las sugerencias de IA**. Antes solo se enseñaba el tamaño del pool, que es
una métrica de *entrada* —cuánto se le da de comer—, no de resultado.

Cuatro decisiones que hacen que la cifra sea creíble, y que es donde está el
valor de este módulo:

- **Solo `metodo === "ia"`.** La conciliación exacta no mejora con el
  aprendizaje: incluirla haría subir el número por tener datos más limpios, no
  por aprender, y diluiría la señal hasta volverla inútil.
- **`modificado` cuenta como fallo.** La propuesta sirvió de punto de partida,
  pero alguien tuvo que corregirla: para el usuario fue trabajo, no ahorro. Se
  reporta aparte, porque no es lo mismo que un rechazo.
- **⚠️ Los `auto` quedan FUERA de la tasa.** Nadie los revisó, así que no son
  evidencia de acierto; incluirlos dispararía la cifra sin que significara nada.
  Se cuentan aparte y la pantalla dice qué son.
- **No se anuncia tendencia sin datos que la sostengan** (mínimo 4 corridas
  revisadas y 10 decisiones por mitad). Con tres sugerencias, pasar de 2/3 a 3/3
  es un salto de 33 puntos que no significa nada; anunciarlo como mejora
  destruiría la credibilidad de la cifra en la primera reunión. Cuando no llega,
  se explica por qué en vez de callar. Y **un empeoramiento se muestra igual de
  claro que una mejora**: si el número solo pudiera subir sería propaganda.

`tasa` es `null` —no `0`— cuando nadie ha revisado nada: cero significaría "la
IA falló siempre"; null significa "todavía no sabemos".

### El precedente en la revisión

Un score de `0.82` no es un argumento y no ayuda a nadie a decidir. Al revisar
una sugerencia, la ficha muestra ahora **un caso parecido que la propia empresa
ya resolvió** — «lo aceptaste el 10/03 · Comercial Ñuñez · diferencia de S/12».
Lógica en `src/lib/precedentes.ts` (pura, con tests).

⚠️ **Lo que se afirma es más modesto de lo que parece, a propósito.** El texto
NO dice "la IA lo propuso por esto": el modelo nunca informa de qué ejemplo pesó
en su decisión, así que atribuirle esa causa sería **inventarle un
razonamiento**. Se afirma lo comprobable: *decidiste algo parecido antes*. La
búsqueda es determinística y ocurre en la app, no en el LLM.

- **Pesos: contraparte 3, misma diferencia 2, misma categoría 1.** Reflejan qué
  convence a una persona: "con este cliente ya pasó" cierra la duda; la
  categoría por sí sola no dice nada (hay cientos de `comision_bancaria` que no
  se parecen en nada) y por eso no alcanza el mínimo de 3 en solitario.
- **Devuelve `null` cuando no hay nada parecido de verdad.** Rellenar con
  parecidos forzados enseña al usuario a ignorar el recuadro.
- **Una diferencia de cero no cuenta como coincidencia**: si contara, media
  conciliación sería "precedente" de la otra media.
- **Solo lo que una persona decidió.** Citar un match auto-conciliado como "tú
  lo resolviste así" sería falso: nadie lo miró.
- Se calcula en el servidor (`precedentes-servidor.ts`): el historial de otros
  jobs no tiene por qué viajar entero al navegador.

### El porqué del rechazo

Un rechazo era solo `"rechazado"`: se guardaba **qué** decidió la persona y se
tiraba **por qué**, que es la señal más informativa del ciclo. "Rechazado" le
dice a la IA que se equivocó; "rechazado porque era otra contraparte" le dice
**en qué**, que es lo único que permite no repetirlo — un ejemplo negativo sin
motivo solo enseña a evitar ese par concreto, que no se va a repetir nunca.

- **Códigos, no texto libre** (`src/lib/motivosRechazo.ts`). El texto libre no
  se puede agregar («¿de qué falla más?») ni resumir en un prompt sin volverse
  ruido. La nota libre sigue existiendo aparte, para el matiz.
- **Un clic = un rechazo.** Elegir el motivo ejecuta la acción; pedir "elige y
  confirma" duplicaría los clics de la tarea más repetitiva de la pantalla y
  empujaría a la gente al despacho en lote solo para evitarlo.
- **"Otro motivo" existe a propósito.** Sin escapatoria, quien no sabe qué poner
  elige cualquiera con tal de seguir, y eso envenena el aprendizaje con datos
  inventados. Un "otro" honesto vale más que una categoría falsa.
- **El lote se rechaza por UN motivo común**: si hicieran falta motivos
  distintos, no era un lote.
- El motivo viaja al prompt (`ia_llm_01_candidatos.js`: *"— rechazado porque
  …"*) y se agrega en `/aprendizaje` bajo **"¿En qué se equivoca?"**, que es la
  mitad accionable del módulo: si la mitad de los fallos son "es otro cliente",
  el problema está en cómo compara nombres, no en las tolerancias de monto.

⚠️ `DecisionHumana.motivo` es `string` **sin `enum`**: las decisiones guardadas
antes de esto no lo traen, y validar contra una lista cerrada haría que retirar
un código en el futuro **impidiera leer resultados antiguos**. Añadir códigos es
barato; renombrarlos o borrarlos rompe la lectura del histórico.

### Arranque en frío

**El peor problema comercial del módulo**: el aprendizaje se alimenta de
decisiones humanas, y una empresa nueva tiene **cero** justo durante los 30 días
de prueba en que decide si paga. El diferenciador está vacío exactamente cuando
se evalúa el producto.

La salida es que la empresa **declare** su criterio en vez de esperar a que se
deduzca (`src/lib/criteriosIniciales.ts`, migración `0019`):

- **Afirmaciones, no perillas.** "¿Tus clientes suelen pagar varias facturas
  juntas?" la responde cualquiera que lleve el negocio; "¿cuántos ejemplos
  few-shot quieres?" no la responde nadie.
- **Viajan al prompt en su PROPIA sección** (`CRITERIO DECLARADO POR LA
  EMPRESA`), nunca mezcladas con `ejemplos_aprendizaje`: aquello es lo que la
  empresa **hizo**, esto es lo que **dice que hace**. El propio prompt indica
  que las decisiones reales mandan sobre lo declarado.
- **Fase visible.** Hasta `DECISIONES_PARA_CALIBRAR` (10) decisiones revisadas,
  la pantalla dice "fase de entrenamiento" con barra de progreso. No es adorno:
  convierte una espera opaca en una meta con final, y explica por qué conviene
  revisar en vez de despachar en lote. Diez está elegido para ser alcanzable en
  la primera o segunda conciliación — una fase que durase meses dejaría de
  motivar y sería una excusa permanente.
- **Columna aparte de `config_conciliacion`**: aquello son números con forma
  cerrada que consume el motor; esto son frases que acaban en un prompt.
- ⚠️ **La `0019` incluye un `GRANT update (criterios_conciliacion)`.** La `0005`
  revocó el UPDATE amplio sobre `empresas` y lo reconcede columna a columna, así
  que **toda columna nueva nace sin permiso de escritura** y la pantalla fallaría
  al guardar sin explicar por qué (RLS deja pasar la fila; lo para el GRANT).

### Curar los ejemplos

El aprendizaje se degrada por ejemplos malos: una aceptación hecha de trámite
enseña a aceptar de trámite. Eso **no se arregla ajustando cuántos ejemplos se
mandan** —la perilla que un usuario pediría— sino quitando el que está mal. Por
eso la "configuración" de este módulo es curación.

`/aprendizaje` lista **los ejemplos exactos que se le envían a la IA** y permite
sacar uno del pool.

- **`ejemplosActivos` comparte implementación con `construirEjemplos`.** Si la
  pantalla listara los ejemplos con otro criterio, el usuario descartaría cosas
  que la IA no está leyendo — y no habría forma de notarlo. Hay un test que
  compara ambas salidas.
- **La marca vive en el propio match** (`Match.excluido_aprendizaje`), no en una
  tabla aparte: el `resultado` completo se reescribe entero en cada decisión, así
  que la marca viaja con el dato al que se refiere. (Distinto del caso de
  `reversiones_cobro`, donde sí hacía falta tabla porque `sincronizarCobranzas`
  borra y rehace las aplicaciones.)
- ⚠️ **Quitar un ejemplo NO deshace la decisión ni toca la conciliación**: el
  match sigue aceptado o rechazado, con su historial intacto. La pantalla lo dice
  con todas las letras — confundirlo con "revertir un cobro" sería un error caro
  y perfectamente posible.
- Un ejemplo excluido sale también del **recuento del pool**: si siguiera
  contando, la pantalla diría que la IA usa N ejemplos cuando usa N−1.

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
