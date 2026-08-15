# Fase 2 — Saldo vivo entre conciliaciones

> Segunda pieza del módulo «Posición de caja». La fase 1 dice **cuánto había el
> 31 de julio**; esta dice **cuánto hay hoy**, sin dejar de distinguir una cosa
> de la otra.

## 0 · El problema, dicho exactamente

`/caja` muestra hoy, 15 de agosto, un saldo del **31 de julio**. La cifra es
verdad y es vieja.

Lo que la hace un problema de producto y no un retraso del usuario es que **el
desfase es estructural**: aunque el cliente cierre el mes el día 3 —lo más
rápido que un cierre mensual permite—, del 4 al 31 la cifra vuelve a envejecer
día a día. No se arregla conciliando antes. Se arregla trayendo otro dato.

Y el desfase importa justo cuando la pantalla se usa: nadie mira la caja para
saber qué tenía en julio, la mira para decidir si paga algo hoy.

---

## 1 · La tentación que sigue descartada

Un campo donde teclear «saldo actual». Se descartó en la fase 1 y se descarta
otra vez, por la misma razón y con más fuerza ahora que hay una pantalla que lo
enseñaría: **un número tecleado no tiene respaldo, y contamina la única cifra
del producto que está probada contra el banco**. En cuanto conviven en la misma
tarjeta, el usuario deja de poder distinguir cuál es cuál.

---

## 2 · La tesis

El banco ya publica el saldo todos los días. No hay que inventarlo ni
conciliarlo: hay que **subir el extracto del mes en curso y NO conciliarlo**.

> ⚠️⚠️ **Lo provisional nunca se suma con lo probado, y nunca hereda su
> aspecto.** Dos cifras, dos fechas, dos tratamientos. En el momento en que se
> funden en un total, el producto pierde lo único que lo distingue de cualquier
> dashboard: poder decir *«esto está probado contra el extracto»*.

El saldo vivo **no es una versión mejor** del saldo conciliado. Es otro dato,
con otra garantía, y la pantalla tiene que sostener esa diferencia sin ayuda.

---

## 3 · De dónde sale el número

Tres candidatos. Gana el primero que exista, y el orden no es arbitrario:

| | Cómo | Garantía | Veredicto |
|---|---|---|---|
| **(a)** | El `saldo` de la última fila del extracto | **Lo declara el banco.** No es un cálculo nuestro, así que no puede tener un error nuestro | **Gana** |
| **(b)** | Último saldo aprobado + movimientos posteriores | Derivado. Correcto si nada se cuenta dos veces | Respaldo |
| **(c)** | Suma de todo el extracto | Ignora el saldo de partida | Descartado |

⚠️ **(b) lleva una guarda que no es opcional:** solo suma movimientos con
`fecha > periodo_hasta` del último corte aprobado. Sin ella, un extracto que
empieza el 01/08 sobre un aprobado que llega al 31/07 va bien, pero uno que
empieza el 25/07 —lo normal cuando alguien descarga «los últimos 30 días»—
contaría cinco días dos veces y daría un saldo alto y plausible.

### ⚠️ Hallazgo: el dato ya se está tirando

`movimientos_extracto.saldo` existe desde la `0022` y **nunca se escribe**. El
`insert` de `/api/extracto/importar` omite la columna; la ruta calcula el saldo
de la última fila en memoria (`saldoFinal`), se lo devuelve al wizard y ahí
muere, salvo que el usuario llegue a iniciar la conciliación.

O sea que la fase 2 es, en buena parte, **empezar a guardar un dato que ya se
está leyendo**. Persistir `saldo` por fila cuesta una línea en el `insert`, y de
paso abre el saldo por día, que es la materia prima de la fase 4.

---

## 4 · El problema real: cuál es «el extracto vigente»

No hay tabla de lotes de extracto: `lote_id` es un uuid suelto en cada fila. Y
**los lotes huérfanos existen y nadie los limpia** — el Paso 2 del wizard
importa el extracto y crea el lote *antes* de que el Paso 3 dispare nada, así
que todo intento abandonado a mitad deja uno. No hay ningún `delete` de
`movimientos_extracto` en la aplicación.

Tomar «el último lote sin job» dejaría que **un intento abandonado mandara sobre
la caja**, y sería invisible: un número plausible, con fecha reciente, sacado de
un archivo que alguien decidió no usar.

**Migración `0051` — `extractos_cargados`**, una fila por lote:

```sql
lote_id uuid primary key, empresa_id, cuenta_id,
fecha_min date, fecha_max date, filas int,
saldo_declarado numeric,        -- el de la última fila, cuando el archivo lo trae
origen text check (origen in ('wizard','caja')),
subido_por uuid, created_at timestamptz
```

- **`origen` es la pieza clave.** Solo un lote subido **desde `/caja` a
  propósito** cuenta como saldo vivo. El del wizard sirve para conciliar y su
  vida acaba ahí: son dos intenciones distintas y confundirlas es exactamente el
  fallo de arriba.
- Hace **explícito lo que hoy se infiere**, que es el mismo remedio que la
  `0043` aplicó a las cargas de comprobantes (`importaciones_comprobantes`).
- Alternativa descartada: una columna `vigente` en `movimientos_extracto` — son
  450.000 `update` para marcar un hecho que pertenece al lote, no a la fila.
- Y da, gratis, dónde colgar la limpieza de huérfanos: hoy no se sabe ni cuántos
  hay.

---

## 5 · Qué se ve

```
┌─ SOLES ────────────────────────────────────────────────────────────┐
│                                                                     │
│  ✓ PROBADO CONTRA EL BANCO          Al 31/07/2026 · conciliado      │
│    En bancos          S/ 138.268,10                                 │
│    Disponible         S/ 119.368,10   (− 18.900 ya vencido)         │
│                                                                     │
│  ~ SEGÚN EL BANCO, SIN CONCILIAR    Al 14/08/2026 · extracto subido │
│    Saldo declarado    S/ 152.940,00                                 │
│    Diferencia         S/  14.671,90   ← 218 movimientos por conciliar│
│                                        [ Conciliar agosto → ]       │
└─────────────────────────────────────────────────────────────────────┘
```

- **La diferencia se muestra, no se explica.** Explicarla *es* conciliar, y eso
  ya existe: el botón está al lado. Insinuar una explicación aquí sería un
  segundo motor que se separa del primero en silencio — el mismo criterio que
  `diagnosticoPartida` y `residuo_explicado`.
- ⚠️ **El provisional NO alimenta `disponible`.** Restar deuda vencida a un
  saldo no probado produce un número con el que alguien decide si paga, y esa es
  justamente la decisión que no puede apoyarse en algo sin conciliar. Disponible
  sigue colgando del saldo aprobado.
- ⚠️ **Caduca.** Un extracto de hace más de ~10 días deja de presentarse como
  «hoy» y pasa a llevar su antigüedad delante. Un saldo vivo rancio es peor que
  no tenerlo: hereda la confianza de estar arriba sin merecerla.
- **Si no hay extracto reciente, el bloque no aparece** — no un cero, no un «—».
  En su lugar, la invitación a subirlo, que es una acción de dos clics.

---

## 6 · El riesgo que hay que vigilar

**Que el saldo vivo canibalice la conciliación.** Si el número de hoy está a la
vista sin conciliar nada, ¿para qué conciliar?

No es hipotético: es el modo de fallo natural de esta función. Se acota con las
tres reglas de arriba —el provisional no da disponible, caduca, y siempre lleva
al lado cuánto le falta por explicar— y con una cuarta:

- **La diferencia se enseña en dinero, no en porcentaje.** *«S/ 14.671,90 sin
  explicar»* mueve a conciliar; *«96 % de acuerdo»* invita a no hacerlo.

---

## 7 · Plan

| Paso | Entregable | Tocado |
|---|---|---|
| 1 | Persistir `saldo` por fila en la ingesta | una línea del `insert` |
| 2 | Migración `0051_extractos_cargados` | tabla nueva; ninguna existente |
| 3 | Escribir la ficha desde las dos rutas de carga | `/api/extracto/importar` |
| 4 | `saldoVivo()` puro + tests (candidatos a/b, guarda de solape, caducidad) | nuevo |
| 5 | Carga de extracto desde `/caja` (`origen = 'caja'`) | nuevo |
| 6 | El bloque provisional en `/caja` | la pantalla de la fase 1 |

**Ninguna pantalla existente cambia de comportamiento, y el motor no se toca.**
Si la fase 2 se revierte, `/caja` vuelve a ser exactamente la de la fase 1.

---

## 8 · Qué NO entra

Compromisos recurrentes · proyección · alertas de liquidez · conversión de
moneda · conciliar automáticamente lo que se sube aquí.

Lo último merece decirse en voz alta porque es la petición que va a llegar:
**el extracto subido para ver el saldo no se concilia solo.** Conciliar exige
elegir período y revisar; hacerlo por detrás produciría conciliaciones que nadie
pidió y que además pelearían por el `exclude using gist` de la `0012` con las
que sí. Lo que sí puede hacer la fase 3 es **ofrecer** ese lote ya cargado al
entrar al wizard, para no subir el archivo dos veces.
