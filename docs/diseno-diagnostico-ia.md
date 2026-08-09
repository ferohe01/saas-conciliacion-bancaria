# Diseño — Diagnóstico asistido por IA

Dos funciones que responden la pregunta más frecuente que va a tener este
producto: **«¿y esto por qué salió así?»**

- **A · «¿Por qué no se concilió esta partida?»** — después de conciliar.
- **B · «¿Va a salir bien esto?»** — antes de conciliar.

Son la misma idea en dos momentos: el sistema ya sabe la respuesta y hoy no la
dice.

---

## Principio rector

> **El motor calcula. El LLM narra. Nunca al revés.**

En este producto el fallo característico no es el error visible: es **el número
plausible y equivocado**. Ya se pagó tres veces — el corte de 1.000 filas de
PostgREST, el cuadre que no cerraba por S/ 20, los 541 pares falsos marcados
`auto`. Un asistente que calcule de memoria reintroduce esa clase de fallo por
la puerta grande, y esta vez con voz de autoridad.

De ahí las tres reglas que gobiernan todo lo que sigue:

1. **Toda cifra sale de Postgres o de una función pura con tests.** El modelo
   recibe el resultado ya calculado; no suma, no cuenta, no estima.
2. **Todo lo que se afirma es comprobable en pantalla.** Cada explicación lleva
   enlace a la partida, al movimiento o al filtro que la sostiene. Si el usuario
   no puede verificarlo, no se dice.
3. **Lo que no se sabe, se dice que no se sabe.** Igual que `tasa` es `null` y
   no `0` en las métricas de aprendizaje, y que `precedentes` devuelve `null`
   antes que inventar un parecido forzado.

⚠️ **Corolario incómodo, y conviene aceptarlo desde el principio:** el 80 % del
valor de A y B **no necesita IA**. Es cálculo determinístico que hoy no se hace.
El LLM aporta la redacción y las repreguntas. Por eso el plan de entrega empieza
sin modelo — ver "Plan de entrega".

---

## A · ¿Por qué no se concilió esta partida?

### Qué pasa hoy

`04_ensamblar.js` clasifica cada pendiente con una etiqueta fija:

```js
categoria: 'requiere_investigacion',
sugerencia: it.monto >= 0 ? 'Posible depósito en tránsito' : 'Posible cheque no cobrado'
```

Es una etiqueta por signo, no una explicación: dice lo mismo de las 4.382
partidas del residuo. El usuario ve *sin conciliar* y no tiene por dónde empezar.

Y el sistema **sí sabe** por qué. La información está toda —montos,
referencias, fechas, qué movimiento se llevó cada par— y nadie la ha cruzado
para esa fila concreta.

### Qué se responde

Siete diagnósticos, en orden de prioridad. El primero que aplica es el que se
muestra; los demás quedan como "otros indicios".

| Código | Qué significa | Evidencia que se muestra |
|---|---|---|
| `ya_emparejado` | Había un movimiento que casaba, pero **se lo llevó otra partida** | Cuál, y con qué comprobante quedó |
| `referencia_contradice` | Mismo monto y fecha, pero las referencias se contradicen: **el motor lo bloqueó a propósito** | Las dos referencias, enfrentadas |
| `monto_diferente` | Misma referencia (o nombre + fecha), el importe difiere en X | El movimiento y la diferencia exacta |
| `fuera_de_ventana` | Misma referencia y mismo monto, pero a N días — fuera de `ventana_ia_dias` | El movimiento y los días de separación |
| `signo_contrario` | Mismo importe, signo opuesto | El movimiento, y el aviso de que sería un cobro contra un pago |
| `agrupacion_posible` | Sumada con otras partidas cuadra con un movimiento | Las partidas y el movimiento |
| `sin_candidato` | No hay nada parecido en el extracto | Lo más cercano encontrado, para que se vea que se buscó |

**`sin_candidato` es el resultado más común y no es un fallo.** En una cuenta
recaudadora la mayoría de esas partidas se cobraron por otro banco o
sencillamente no se han cobrado. Decirlo con todas las letras vale más que
insinuar que el motor falló.

### Los tres hallazgos que hoy son invisibles

Justifican la función por sí solos:

- **`ya_emparejado`.** La capa exacta hace `row_number()` en los dos lados y
  empareja por número: con 300 recibos idénticos, "toma el siguiente libre". Que
  a *esta* factura le tocara quedarse fuera es correcto y **completamente
  inexplicable desde la pantalla**. Es la primera pregunta que hará quien mire
  una partida concreta.
- **`referencia_contradice`.** El motor descarta ese par **deliberadamente** —es
  la guarda que evitó 541 pares falsos— y hoy parece un olvido. Convertir un
  acierto silencioso del motor en un acierto visible es, además, argumento de
  venta.
- **`agrupacion_posible`.** Cuando la capa 1:N no llegó (prefiltro sin identidad
  compartida, o grupo mayor que `max_combinacion`), esto lo detecta para una
  sola partida sin el coste que tiene hacerlo para todas.

### Cómo se calcula

Una función SQL, **una partida por llamada** (`0038`):

```sql
public.candidatos_partida(p_job_id text, p_comprobante_id uuid, p_dias int, p_max int)
```

⚠️ **Solo BUSCA; decidir es de TypeScript.** Las partidas viven en dos sitios
según el tamaño del job —tablas o el JSONB `payload_entrada`—, así que con la
decisión en SQL habría que escribir el diagnóstico dos veces, y una misma
partida podría explicarse de dos maneras según por dónde entrara. SQL hace lo
que hace bien (buscar por índice) y `src/lib/diagnosticoPartida.ts` decide, en
un solo sitio y con tests.

La búsqueda que es prohibitiva para 4.382 partidas es **trivial para una**: los
índices `idx_comprobantes_ref_norm`, `idx_mov_extracto_ref_norm` y
`idx_mov_extracto_cuenta_fecha` ya existen y son exactamente los que hacen falta.
Coste esperado: milisegundos.

Devuelve filas `{ codigo, movimiento_id, fecha, monto, glosa, referencia,
diferencia_monto, dias, ocupado_por }` — datos, no prosa.

**Las tolerancias salen de `payload_entrada.config` del job**, no de la
configuración actual de la empresa. Si alguien cambió `tolerancia_dias` después
de correr, el diagnóstico tiene que explicar la corrida **como fue**, no como
sería hoy.

### ⚠️ El punto delicado: fidelidad con el motor

El motor vive en `n8n/*.js` y es **fuente única**. No se puede importar desde la
app, no entra en el typecheck y no se ejecuta en los tests. Reimplementar sus
criterios en SQL crearía un segundo motor que diverge en silencio — justo lo que
`0029` documenta como peligro (`ref_norm` tiene que ser *exactamente* `normRef`)
y lo que ya se aceptó a regañadientes una vez, con `cuentaComoPendiente` en dos
lenguajes.

**La salida es no hacer esa afirmación.** El diagnóstico **no dice** "el motor lo
rechazó porque X". Dice **"lo más parecido que hay en tu extracto es esto, y se
diferencia en esto"**. Es una observación sobre los datos, no una reconstrucción
del motor, así que no puede divergir de él: no está hablando de él.

Las dos únicas excepciones son afirmaciones **verificables contra la base**, no
reconstrucciones:

- `ya_emparejado` → el movimiento **está** en `matches_conciliacion` con otro
  comprobante. Es un hecho consultable.
- `referencia_contradice` → las dos referencias existen y difieren. El hecho es
  el dato; la regla que lo bloquea está documentada y es estable.

Esta decisión es la que hace el diseño sostenible. Si más adelante se quisiera
reproducir el motor de verdad, el camino correcto no es reescribirlo en SQL: es
que **n8n emita el motivo por partida** durante la corrida.

### En pantalla

- Cada fila de "Sin conciliar" (en `/conciliacion/[jobId]` y en
  `/reportes/sin-conciliar`) gana un **«¿Por qué?»**.
- Se despliega en la misma fila. No abre modal: el usuario está recorriendo una
  lista y sacarlo de ella rompe el barrido.
- **Bajo demanda, una a una.** Nadie va a leer 4.382 explicaciones, y calcularlas
  todas devolvería el problema de escala que la parte B vino a eliminar.
- El diagnóstico **no se guarda**: se recalcula al pedirlo. Los datos cambian
  —una aprobación mueve saldos, un match manual ocupa un movimiento— y un
  diagnóstico congelado envejecería mintiendo.

### Qué añade el LLM

Sobre esos datos ya calculados:

- **Redacta** el hallazgo en el idioma del cliente: *«Este recibo de S/ 99 no
  aparece en el extracto. Lo más parecido es un depósito de S/ 99 del 3 de julio,
  pero ya quedó emparejado con la boleta B001-4471.»*
- **Recomienda la acción** entre las que la pantalla ya ofrece: conciliar
  manualmente, dejarlo como partida en tránsito, revisar el mapeo, subir el
  extracto del mes siguiente.
- **Responde repreguntas** sobre esa partida — y solo sobre esa. El contexto es
  el diagnóstico, no la base entera.

---

## B · Diagnóstico antes de conciliar

### Qué pasa hoy

Una conciliación de 450.999 movimientos terminó en **0 %** porque la columna
*Recibos* no se mapeó a *referencia*. Nada lo dijo hasta ver el resultado, media
hora después.

Se añadió un aviso ámbar en el Paso 2, y está bien, pero **avisa de una causa sin
medir su consecuencia**. Un aviso que el usuario no sabe ponderar se despacha sin
leer — sobre todo cuando dice, con razón, que se puede conciliar igual.

### El momento correcto: Paso 3

En el Paso 2, "Continuar" ya importa el extracto a `movimientos_extracto` y
devuelve `lote_id`. Es decir: **al llegar al Paso 3 los dos lados están en la
base y el motor todavía no ha corrido.** Ahí cabe una comprobación real, no una
heurística sobre lo que se ve en pantalla.

### La comprobación que lo justifica todo: cobertura estimada

La capa exacta **ya es un JOIN en SQL** (`conciliar_exacta`, `0023`/`0029`).
Correrlo en seco —contar los pares sin escribir en `matches_conciliacion`— cuesta
segundos y responde la única pregunta que importa:

> **«Con este mapeo, casarían 447.795 de 450.999 movimientos (99 %).»**
>
> **«Con este mapeo, casarían 12 de 450.999 movimientos (0,003 %).»**

El segundo mensaje habría ahorrado el incidente entero. No es un aviso sobre una
causa: es el **resultado**, antes de gastar la media hora.

Implementación (**ya construida**, migración `0037`): la regla de emparejamiento
se extrajo a `pares_exactos(...)` y la usan las dos —`conciliar_exacta` para
insertar, `diagnostico_previo` para contar—. **Comparten la sentencia**, no es
una copia, así que no pueden divergir.

⚠️ **Con medio millón por lado no se estima.** El JOIN se pasa del
`statement_timeout` de 8 s, así que por encima de 60.000 partidas por lado
`pares_estimados` vuelve `null` y la pantalla lo dice. La señal que de verdad
diagnostica el caso del 0 % es `refs_compartidas` —cuántos códigos aparecen en
los dos lados—, que cuesta casi nada. `null` no es cero, y confundirlos diría
que no casa nada cuando lo que pasa es que no se miró.

### Las demás comprobaciones

Todas determinísticas, todas sobre datos ya persistidos:

| Comprobación | Cómo se detecta | Por qué importa |
|---|---|---|
| **Referencias incompatibles** | Los dos lados traen referencia, pero la intersección de `ref_norm` es ~0 | Las columnas están mapeadas y aun así **no son el mismo código**. Se muestran tres ejemplos de cada lado enfrentados: es la forma más rápida de que el usuario lo vea |
| **Referencia sin mapear** | `mapeo.referencia` vacío | Ya existe; ahora acompañado del número de cobertura |
| **Todos los movimientos con el mismo signo** | `min(monto) >= 0` o `max(monto) <= 0` | Falta la columna de cargos, o el signo no se interpretó. Rompe la convención única del sistema |
| **Fechas fuera del período** | `validarCoherencia`, ya existe | Archivo del mes equivocado |
| **Fechas ambiguas** | Todos los días ≤ 12 | dd/mm leído como mm/dd. Silencioso y devastador |
| **Referencias repetidas** | `count(*) > 1` por `ref_norm` | Es normal en una recaudadora, pero anticipa agrupación 1:N y explica por qué habrá pendientes |
| **Volumen** | Partidas vs `MAX_FILAS_CONCILIACION` | Falla al disparar, no a mitad |
| **Comprobantes ya cobrados** | Ya se excluyen; se dice cuántos | Evita que "faltan facturas" parezca un fallo |

### Avisa, no bloquea — con una excepción de forma

Hay extractos sin referencia, y para ellos el respaldo por monto + fecha es
legítimo. Bloquear sería impedir un caso de uso válido.

Pero **cuando la cobertura estimada es muy baja, el botón cambia**: de
*«Iniciar conciliación»* a *«Revisar el mapeo»* como acción primaria, con
*«Conciliar de todas formas»* al lado en secundario. No prohíbe nada; obliga a
mirar. Es el mismo criterio del aviso de reemplazo: un diálogo que sale siempre
se aprende a despachar, así que este solo aparece cuando hay algo que decir.

### Qué añade el LLM

- **Prioriza**: con cinco avisos a la vez, cuál mirar primero.
- **Explica la consecuencia en términos del cliente**: no *«no mapeaste
  referencia»* sino *«así solo se emparejará lo que coincida en importe y fecha
  exacta; con recibos repetidos del mismo importe, eso va a dejar fuera la mayor
  parte»*.
- **Responde "¿y qué hago?"** con los pasos concretos de esta pantalla.

---

## Arquitectura del chat

Aplica cuando A y B ya funcionen como datos.

### Herramientas, no acceso a la base

El modelo **no ve filas ni escribe SQL**. Llama a un conjunto cerrado de
funciones que ya existen y ya están probadas:

```
diagnosticar_partida(job_id, partida_id, lado)   → A
estimar_cobertura(cuenta, lote, desde, hasta)    → B
resumen_saldos(...)            0021
resumen_ejecutivo(...)         0032
totales_conciliacion(job_id)   0028
```

Cada respuesta vuelve con **el enlace a la pantalla que la demuestra**.

### Seguridad

- **La empresa sale siempre de `auth.uid()`.** Ninguna herramienta acepta
  `empresa_id` por parámetro: sería un `?empresa_id=` en manos de cualquiera.
- Las funciones nuevas siguen el patrón de `0021`: `security definer`,
  `set search_path = public`, `revoke ... from public, anon` explícito.
- El `job_id` y el `partida_id` que llegan del chat **se validan contra la
  empresa del usuario** antes de consultar nada. Un id ajeno devuelve vacío, no
  error: no se confirma que exista.
- ⚠️ El texto que escribe el usuario **no elige la consulta por concatenación**.
  El modelo escoge entre herramientas con parámetros tipados; no hay superficie
  de inyección porque no hay SQL que componer.

### Coste y volumen

- **Nada de datos crudos en el prompt.** Con 452.309 comprobantes ya se sabe cómo
  acaba: 4,7 MB y 1,2 millones de tokens. Solo agregados y salidas de función.
- El diagnóstico de una partida son ~15 filas. El pre-vuelo, ~8 hallazgos. Los
  dos prompts caben de sobra y su tamaño **no crece con los datos del cliente** —
  que es la propiedad que hay que preservar.

### Por qué no va por n8n

El patrón asíncrono del sistema (webhook → job → Realtime) existe porque conciliar
tarda minutos. Un chat necesita respuesta inmediata y **streaming**. Va como ruta
propia del backend hacia el proveedor, con la clave en servidor — las mismas
reglas de siempre: el frontend nunca conoce la key.

---

## Plan de entrega

Cada fase es desplegable y útil por sí sola. **Las dos primeras no llevan IA**, y
son las que más valor entregan.

| Fase | Qué | Lleva LLM | Estado |
|---|---|---|---|
| 1 | `diagnostico_previo` + los avisos del Paso 3 | No | ✅ `0037` |
| 2 | `candidatos_partida` + el «¿Por qué?» en cada fila | No | ✅ `0038` |
| 3 | Síntesis: el modelo explica los hallazgos y qué hacer | Sí, una llamada | ✅ |
| 4 | Repreguntas acotadas al diagnóstico que se está viendo | Sí, conversación | ✅ |

⚠️ **Recomiendo no saltarse el orden.** Si la fase 1 se entrega sola y el cliente
deja de perder media hora por un mapeo mal puesto, el valor ya está cobrado. Y si
en la fase 3 el modelo dijera algo raro, se ve encima del dato correcto —que
sigue en pantalla— en vez de en su lugar.

---

## Cómo se prueba

- **Determinístico, con tests reales.** Los siete códigos de diagnóstico se
  fijan con casos construidos: la partida cuyo movimiento se llevó otra, la de
  referencias contradictorias, la que suma con dos más. Van a
  `tests/` como funciones puras donde se pueda, y como fixtures SQL donde toque.
- **`estimar_cobertura` contra `conciliar_exacta`**: sobre el mismo período, el
  número estimado y el real tienen que coincidir **exactamente**. Es la
  comprobación que no comparte supuestos con lo que comprueba — el mismo método
  que destapó los S/ 20 del cuadre.
- **El LLM no se testea por su redacción**, sino por lo que no puede hacer: se
  verifica que toda cifra del mensaje aparezca en los datos de entrada. Una cifra
  que no esté en la herramienta es un fallo, no un matiz de estilo.

---

## Decisiones abiertas

1. **¿Cuál es el umbral de cobertura baja?** Propongo < 20 %, medido contra el
   histórico real (99,03 % en junio completo, 88,44 % en el corte diario). Un
   umbral alto convertiría el aviso en ruido para quien concilia por día.
2. **¿Diagnóstico también para movimientos del banco sin conciliar?** El diseño
   es simétrico y sale casi gratis, pero el lado interno es el que le importa al
   cliente (son sus facturas). Se puede dejar para después.
3. **Proveedor del chat.** Hoy n8n usa OpenAI (`gpt-5.6-luna`). El chat es una
   integración nueva e independiente; conviene decidir si se unifica.
4. **Alcance del chat.** Empezar acotado a estas dos pantallas, o abrirlo a toda
   la app desde el principio. Mi recomendación: acotado. Un asistente que solo
   sabe de lo que tienes delante acierta siempre; uno que promete saberlo todo
   falla el primer día y ya no se vuelve a usar.
