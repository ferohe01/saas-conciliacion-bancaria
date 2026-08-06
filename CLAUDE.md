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
    0018_comprobantes_sin_duplicados.sql  Índice único por serie + lote de
                             importación (deshacer una carga).
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
tiene un "Empezar de cero" que exige escribir la palabra. Ninguna de las dos
borra un comprobante **con cobros aplicados**: eso se iría en cascada y dejaría
un agujero en una conciliación aprobada, que seguiría diciendo que esa factura
se cobró. Lo conciliado no se limpia, se **anula** (ver `0016`).

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

## Aprendizaje IA: sección propia y de núcleo

`/aprendizaje` es el **diferenciador comercial** del producto: no concilia mejor
que otro sistema en abstracto, concilia como **esta** empresa. Por eso dejó de
vivir repartido —un panel en `/reportes`, una tarjeta en `/dashboard`, ambos
hospedados dentro de `ReporteVista.tsx`— y tiene su propia ruta.

- **Es núcleo, NO un módulo contratable.** No pasa por `suscripciones_modulo` ni
  se puede desactivar: poner detrás de una puerta la razón por la que alguien
  compra el sistema debilita el argumento principal. (Contrástese con
  `cobranzas`, que sí es un añadido.)
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
