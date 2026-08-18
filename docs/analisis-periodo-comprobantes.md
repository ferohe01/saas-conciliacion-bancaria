# El período de los comprobantes — análisis y propuesta

> **Estado: propuesta. No se ha tocado nada.**
> Encontrado el 17/08/2026 al revisar `/cuando-pagan`, donde los 271 documentos
> medidos daban todos exactamente −30 días.

---

## 0 · El síntoma, y por qué el juego de pruebas lo tapaba

Todos los clientes «pagan 30 días antes de vencer». Medido sobre los archivos:

```
plazo   (vencimiento − emisión)   junio: 153 a 30 días · 78 al contado
retraso (pago − vencimiento)      junio: 147 en −30    · 68 en 0
```

En el juego de pruebas **cada factura se cobra el mismo día que se emite**: el
movimiento del extracto con su código de operación lleva la misma fecha. Con esa
propiedad, el filtro de período nunca estorba — y por eso nadie lo había notado.

El dataset se construyó para ejercitar el **motor de emparejamiento** dentro de
un mes, y para eso funciona (163 exactas en junio). Lo que no puede ejercitar es
nada que dependa del paso del tiempo.

---

## 1 · Qué hace hoy, exactamente

Los comprobantes que entran a una conciliación se eligen por **fecha de
emisión** dentro del período. El filtro está escrito en **cinco** sitios:

| Dónde | Qué decide |
|---|---|
| `pares_exactos` (`0041`) | qué casa la capa exacta en SQL |
| `residuo_internos` (`0041`) | qué viaja a n8n |
| `resumen_comprobantes_periodo` (`0027`/`0053`) | el recuento del Paso 1 |
| `origen_partidas` (`0043`) | la cascada «de tu archivo a la conciliación» |
| `getComprobantesCanonicos` (TS) | el modo payload, para jobs pequeños |

```sql
and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
and c.estado not in ('cobrado', 'anulado')
```

Los cinco dicen lo mismo, y eso es bueno: **el cambio es de una regla, no de
cinco**. Pero hay que tocarlos todos a la vez o la pantalla dejará de contar lo
que el motor concilia — que es justo lo que el Paso 1 promete.

---

## 2 · Por qué está mal, y no en un caso raro

Una factura emitida el **25/06** con crédito a 30 días se cobra el **28/07**.

- En la conciliación de **junio** el abono no existe todavía → queda suelta.
  Correcto: es un **depósito en tránsito** al 30/06.
- En la conciliación de **julio** su fecha de emisión es de junio → **no entra
  en el conjunto**. El abono del 28/07 no tiene con qué casar.

**El par no se concilia nunca, en ningún período.** Y no se queda quieto:

- el comprobante conserva `saldo > 0` para siempre → `/cobranzas` sigue diciendo
  que ese cliente debe algo que ya pagó;
- el movimiento bancario queda «sin conciliar» para siempre;
- el cuadre arrastra la diferencia y **crece cada mes**;
- `/cuando-pagan` no puede medir un solo retraso real, porque los únicos pares
  que ve son los del mismo día.

Para una empresa que cobra al contado esto no ocurre. Para cualquiera que dé
crédito —lo normal— es **el caso mayoritario**, no una excepción.

⚠️ El propio LEEME del juego de pruebas ya lo documenta sin nombrarlo: el
«depósito en tránsito del 30/06 acreditado el 01/07» figura bajo *«partidas
conciliatorias — deben quedar sueltas»*, con la nota **«interno suelto en junio ·
movimiento suelto en julio»**. Para un día de desfase eso es contabilidad
correcta. Para 30 días es un agujero.

### Una predicción comprobable

Si en julio pusiste `saldo según libros = 1.293.901,60`, el cuadre debería dejar
**≈ S/ 12.479,23 sin explicar** — exactamente las partidas conciliatorias de
junio, que julio no puede ver.

```
diferencia acumulada al 31/07   22.422,73
… de las que julio puede explicar  9.943,50   (sus propias partidas)
… heredadas de junio, invisibles  12.479,23
```

Es la forma más barata de confirmar el diagnóstico: abrir la conciliación de
julio y mirar el cuadre.

---

## 3 · Por qué el rango libre NO es la salida

La respuesta obvia es «concilia 01/06–31/07 de una vez», y el producto ya lo
permite. **Pero no sirve como práctica recurrente**, y conviene decir por qué:

`jobs_una_aprobada_por_rango` (`0012`) impide dos aprobadas con rangos
**solapados** en la misma cuenta. Aprobar 01/06–31/07 con junio ya aprobado
degrada junio a `reemplazada` y **borra sus cobros aplicados** — que es
exactamente lo que `impactoDeAprobar` avisa antes de hacerlo.

O sea: o cierras mes a mes (y arrastras el agujero), o no cierras nunca los meses
sueltos. No hay una tercera vía con el modelo actual.

⚠️ Y hay un efecto de segundo orden: cada mes que pasa, el rango que habría que
conciliar de golpe es más largo, hasta chocar con `MAX_FILAS_CONCILIACION`.

---

## 4 · Qué se rompería si se cambia, dependencia por dependencia

| Depende de | Efecto de arrastrar los pendientes | Veredicto |
|---|---|---|
| **Cuadre** (`04_ensamblar.js`) | Los pendientes de libros pasarían a incluir los de meses anteriores — que **es lo que un cuadre real lista** al 31/07. Hoy no puede cerrar; con arrastre sí | ✅ **mejora** |
| **`saldo según libros`** | Ya es acumulativo (38.500 + junio + julio). Encaja mejor con un conjunto acumulativo que con uno mensual | ✅ mejora |
| **Idempotencia** y **`exclude gist`** | Van sobre `(cuenta, período)` del job, no sobre los comprobantes | ⚪ no cambia |
| **Doble cobro** (las tres capas) | Las tres siguen: `cobrado/anulado` fuera, tope por saldo en `calcularAplicaciones`, `check saldo >= 0` de la `0015` | ⚪ no cambia |
| **Paso 1** (`resumen_comprobantes_periodo`) | **Tiene que contar lo mismo que el motor** o la pantalla mentiría. Hay que cambiarlo a la vez | ⚠️ obligatorio |
| **`origen_partidas`** (`0043`) | «del período y sin cobrar» deja de describir el conjunto. Hay que reescribir esa línea de la cascada | ⚠️ obligatorio |
| **Reportes / % automatizado** | El denominador crece con los arrastrados → el % baja. Es más honesto, pero **cambia una cifra que el cliente ya vio** | ⚠️ avisar |
| **Volumen** | Para una PyME, decenas de filas más. Para una recaudadora con 4.382 de residuo al mes, **52.000 al año** → se pasa de `MAX_FILAS` (20.000) | ⚠️ **necesita tope** |
| **Falsos positivos** | `referencia_externa` **se repite a propósito**. Con la ventana ampliada, un abono de julio podría casar con un comprobante viejo de igual importe y misma referencia | ⚠️ **el riesgo real** |
| **`/cuando-pagan`** | Empezaría a ver pagos entre meses, que es lo único que hace útil el módulo | ✅ mejora |

---

## 5 · La propuesta

**Arrastrar los comprobantes pendientes de períodos anteriores, con tope y a la
vista.**

```sql
-- antes
and c.fecha between v_job.periodo_desde and v_job.periodo_hasta

-- después
and c.fecha <= v_job.periodo_hasta
and c.fecha >= v_job.periodo_desde - (v_config.arrastre_meses || ' months')::interval
```

Tres decisiones que la acompañan:

**(a) Tope de antigüedad, configurable.** `arrastre_meses` en el
`config_conciliacion` que ya existe, por defecto **12**. Acota el volumen del
cliente grande y la ventana de falsos positivos, y es el mismo criterio que ya
usa `dias_pago_contraparte`. Cero desactiva el arrastre y devuelve el
comportamiento de hoy.

**(b) El arrastre se ve y se cuenta.** El Paso 1 pasa a decir:

> **281 registros** · S/ 640.150,95
> 233 emitidos en este período · **48 pendientes de meses anteriores**

Mismo criterio que las exclusiones que acabamos de arreglar: cada partida
nombrada por lo que es. Sin esa línea, el usuario ve un número que no reconoce y
lo primero que piensa es que el sistema duplicó algo.

**(c) Emparejar por `saldo`, no por `monto`.** Es un cambio pequeño y
estrictamente más correcto: lo que el banco paga de una factura a medio cobrar
es **lo que queda**, no el importe original. Para el 99 % de los casos son el
mismo número (saldo == monto mientras no se haya cobrado nada), así que no
cambia nada de lo que hoy funciona — pero sin él, un comprobante arrastrado con
cobro parcial se ofrecería por su importe entero y produciría un match que dice
que se cobró todo. El dinero está protegido por el tope de
`calcularAplicaciones`; el **match** no lo estaría.

---

## 6 · Lo que hay que decidir antes de tocar nada

1. **¿12 meses por defecto, o menos?** Con 12 meses una PyME arrastra todo lo
   vivo. Un número corto (3) acota más los falsos positivos pero deja fuera
   deuda antigua real, que es justo la que más importa cobrar.
2. **¿Se aplica a las conciliaciones ya aprobadas?** No: solo a las nuevas. Las
   aprobadas no se recalculan — el informe sigue diciendo lo que dijo el día que
   se emitió (mismo criterio que `abonos_no_registrados`).
3. **¿Y el % de automatización histórico?** Bajará en las corridas nuevas por el
   denominador. Conviene decirlo en `/reportes` antes de que alguien lo note.
4. **¿Arrastrar también los pagos a proveedores?** Simétrico y por el mismo
   motivo, pero duplica el volumen. Yo diría que sí: un cheque girado en junio y
   cobrado en julio tiene el mismo problema.

---

## 7 · Plan, si se aprueba

| # | Entregable | Riesgo |
|---|---|---|
| 1 | `arrastre_meses` en `config.ts` + `/configuracion` (defecto 12) | ninguno; sin usar todavía |
| 2 | Migración: el filtro en `pares_exactos`, `residuo_internos`, `resumen_comprobantes_periodo` y `origen_partidas` | **el cambio de verdad**; una sola migración para que no queden desalineados |
| 3 | `getComprobantesCanonicos` (modo payload) | bajo |
| 4 | Paso 1: la línea «N pendientes de meses anteriores» | bajo |
| 5 | Emparejar por `saldo` | medio: tocar `pares_exactos` es tocar el camino de 450.000 filas — hay que volver a medir |
| 6 | Cascada de `origen_partidas`: rehacer la línea del período | bajo |

**Verificación end-to-end**: un juego de pruebas nuevo donde las facturas de
junio se cobren en julio. El actual no puede validar este cambio — no tiene ni
un caso —, y sin un juego que lo ejercite el arreglo se despliega a ciegas.

---

## 8 · Recomendación

**Hacerlo, y hacerlo con tope y visible.** No es una mejora: es que hoy hay un
conjunto de pares que **no se puede conciliar nunca**, y el producto no lo dice
en ninguna parte. Un cliente con crédito a 30 días lo descubriría el segundo
mes, viendo cómo el «sin conciliar» crece sin explicación.

Pero **antes hay que construir el juego de pruebas que lo demuestre**. Cambiar
`pares_exactos` sin un caso que falle hoy y pase después es exactamente el tipo
de despliegue que este proyecto ha aprendido a no hacer.
