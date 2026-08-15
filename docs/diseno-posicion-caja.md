# Fase 1 — Posición de caja (`/caja`)

> Módulo 2 de la plataforma financiera. Responde **«¿cuánta plata tengo?»** con
> cifras que salen de conciliaciones aprobadas, no de un Excel con opinión.

## 0 · La tesis

La posición de caja no es un dashboard más: es **la primera pantalla que puede
afirmar algo sobre el dinero de la empresa porque está probado contra el
extracto del banco**. Cualquiera pinta un saldo sumando movimientos; lo que aquí
lo hace creíble es que cada cifra viene de un período conciliado y aprobado.

De ahí la regla que gobierna todo el diseño:

> **Ninguna cifra de caja se muestra sin su fecha de corte.**
> Un saldo sin fecha es una afirmación sobre hoy hecha con datos de hace tres
> semanas, y nadie puede saberlo mirándola.

---

## 1 · Las cuatro cifras, definidas sin ambigüedad

| Cifra | Definición exacta | Fuente |
|---|---|---|
| **Saldo en bancos** | Suma de `saldo_final_banco` de la **última conciliación aprobada de cada cuenta**, agrupado por moneda | `jobs_conciliacion` (0012) |
| **Entradas** | Suma de los abonos del extracto de **esos mismos** períodos | `movimientos_extracto` (`monto > 0`) |
| **Salidas** | Suma de los cargos de esos mismos períodos | `movimientos_extracto` (`monto < 0`) |
| **Disponible** | Saldo en bancos **menos** lo que ya debes y está **vencido** | `comprobantesSaldo.ts` + `aging.ts` |

⚠️ **Entradas y salidas describen el MISMO período que el saldo.** No el mes en
curso, no los últimos 30 días: el período cerrado del que sale el saldo. Una
pantalla donde el saldo es de julio y los movimientos de agosto no cuenta
ninguna historia — obliga a preguntarse cuál de los dos manda.

⚠️ **«Disponible» lleva su fórmula al lado**, siempre: *«S/ 120.400 en bancos
menos S/ 18.900 que ya debías»*. Un número llamado «disponible» sin decir qué se
le restó invita a gastárselo.

---

## 2 · La garantía que hace posible sumar

`jobs_una_aprobada_por_rango` (0012) es un `exclude using gist` que impide **dos
conciliaciones aprobadas con rangos solapados en la misma cuenta**.

Sin esa restricción, este módulo sería imposible de construir con confianza: dos
corridas del mismo mes duplicarían el saldo y las entradas, y el error sería
invisible. Con ella, unir por *aprobada* devuelve **exactamente un lote por
cuenta y período**, garantizado por la base y no por el cuidado del que escribe
la consulta.

Es la clase de cimiento que justifica haber puesto la regla en Postgres y no en
la aplicación.

---

## 3 · La frescura: el problema central

Hoy el sistema solo conoce el saldo **al cierre del último período conciliado**.
Si la empresa concilia mensualmente y estamos a 20 de agosto, el saldo es del 31
de julio: veinte días de antigüedad.

**No es un defecto que haya que disimular: es la naturaleza del dato.** Lo que
sería un defecto es no decirlo.

```
frescura(corte, hoy) = días transcurridos desde `periodo_hasta`

  ≤ 40 días   al día        Una empresa que cierra mensualmente concilia el mes
                            M durante los primeros días de M+1. El corte más
                            reciente posible ronda los 30-35 días.
  41 – 70     con retraso   Falta un período por conciliar.
  > 70        desfasado     Faltan dos o más. La cifra sigue siendo verdad
                            sobre su fecha, pero ya no describe hoy.
```

⚠️ El estado se calcula **por cuenta**, y el total hereda **el corte más
antiguo** de las cuentas que lo componen. Un total solo vale lo que valga su
parte más vieja; promediar fechas o quedarse con la más reciente sería maquillar.

---

## 4 · Datos: una función nueva, cero cambios

```sql
create or replace function public.posicion_caja()
returns table (
  cuenta_id     uuid,
  banco         text,
  numero        text,
  moneda        text,
  job_id        text,      -- para poder ir a la conciliación que la sostiene
  corte_desde   date,
  corte_hasta   date,
  saldo_final   numeric,   -- null si el usuario no lo declaró
  entradas      numeric,
  salidas       numeric,
  movimientos   bigint
)
```

- **`security definer`** con la empresa resuelta desde `auth.uid()`, **nunca por
  parámetro** — mismo patrón que `resumen_saldos` (0021) y `resumen_ejecutivo`
  (0032).
- `revoke ... from public, anon` explícito.
- **Una fila por cuenta**, incluidas las que **nunca se conciliaron** (con todo
  en `null`). Omitirlas haría que el total pareciera completo cuando no lo está.
- Agrega en la base: con medio millón de movimientos, traerlos para sumarlos en
  Node es justo lo que la parte B vino a eliminar.

**Lo vencido NO necesita SQL nuevo**: `cargarSaldos()` de `comprobantesSaldo.ts`
ya prefiltra en la consulta y `agingPorMoneda` ya separa por moneda. Reutilizar
es además lo que garantiza que «Por pagar» y «Caja» digan lo mismo — si cada una
lo calculara por su lado, acabarían discrepando y el usuario no sabría cuál
creerse.

---

## 5 · Lógica pura: `src/lib/posicionCaja.ts`

Con tests, como toda regla de negocio del proyecto.

```ts
export type CuentaCaja = { /* la fila de posicion_caja, en camelCase */ };

export type Frescura = {
  dias: number;
  estado: "al_dia" | "retraso" | "desfasado";
  /** La frase que se enseña. Nunca solo el estado. */
  texto: string;
};

export function frescuraDelCorte(hasta: string | null, hoy: Date): Frescura;

export type BloqueMoneda = {
  moneda: string;
  saldo: number;
  entradas: number;
  salidas: number;
  vencido: number;
  disponible: number;          // saldo − vencido
  corteMasAntiguo: string | null;
  frescura: Frescura;
  cuentas: CuentaCaja[];
  /** Conciliadas pero sin saldo declarado: no suman y hay que decirlo. */
  sinSaldo: CuentaCaja[];
  /** Nunca conciliadas. */
  sinConciliar: CuentaCaja[];
};

export function consolidarCaja(
  cuentas: CuentaCaja[],
  vencidoPorMoneda: Map<string, number>,
  hoy: Date,
): BloqueMoneda[];
```

**Invariantes que fijan los tests:**

1. **Nunca se suman monedas distintas.** Un bloque por moneda, ordenados por
   saldo descendente (misma regla que `agingPorMoneda`).
2. **`saldo_final` nulo no cuenta como cero.** Cero significa «no hay plata»;
   nulo significa «no lo sé». Va a `sinSaldo` y la pantalla lo nombra.
3. **`disponible` nunca se muestra sin `saldo` y `vencido`**, que son sus dos
   términos.
4. La frescura del bloque es la **peor** de sus cuentas.
5. Una empresa sin ninguna conciliación aprobada devuelve bloques vacíos con su
   explicación, no ceros.

---

## 6 · La pantalla

Orden deliberado: **primero si te puedes fiar, después cuánto hay.**

```
Posición de caja
Al 31/07/2026 · tu última conciliación aprobada        [ Conciliar agosto → ]

┌─ SOLES ───────────────────────────────────────────────────────────┐
│  En bancos          Entradas (jul)    Salidas (jul)    Disponible │
│  S/ 138.268,10      S/ 605.307,15     S/ 544.663,00    S/ 119.368 │
│                                                                    │
│  Disponible = S/ 138.268,10 en bancos − S/ 18.900 ya vencido       │
│                                                                    │
│  BCP ····2456    S/ 138.268,10    corte 31/07    ✓ al día          │
│  BBVA ····9012   sin conciliar                   — sin datos       │
└────────────────────────────────────────────────────────────────────┘
```

**Qué se dice y cuándo:**

| Situación | Texto |
|---|---|
| Al día | *«Al 31/07/2026 · tu última conciliación aprobada»* |
| Con retraso | ⚠️ *«Estas cifras son del 30/06. Han pasado 46 días: falta conciliar julio.»* + botón |
| Desfasado | ⚠️ *«Del 31/05, hace 76 días. Faltan dos períodos: esto ya no describe tu caja de hoy.»* |
| Cuenta sin conciliar | *«BBVA ····9012 no tiene ninguna conciliación aprobada: su saldo no entra en el total.»* |
| Conciliada sin saldo | *«No declaraste el saldo final del extracto en esa conciliación.»* |
| Nada aprobado | Estado vacío con enlace al wizard. **No ceros.** |

⚠️ **El aviso de retraso no bloquea nada.** Las cifras siguen siendo verdad
sobre su fecha; lo que cambia es la confianza que merecen. Mismo criterio que el
diagnóstico previo del Paso 3: no prohibir, cambiar cuál es el botón negro.

---

## 7 · Decisiones tomadas (y sus alternativas descartadas)

**El saldo sale de la conciliación, no de un campo editable.** Un «saldo actual»
que el usuario teclea es un dato sin respaldo, y contamina la única cifra del
producto que está probada. Si hace falta frescura diaria, la salida correcta es
la fase 2: subir el extracto del mes en curso sin conciliarlo.

**Entradas/salidas del extracto, no de las aplicaciones de cobro.** El extracto
es lo que de verdad entró y salió del banco; las aplicaciones son solo la parte
que encontró pareja. Usar aplicaciones daría una caja que ignora los cargos no
registrados — justo las partidas que el cuadre existe para sacar a la luz.

**Sin conversión de moneda.** Igual que en comprobantes (0041): el tipo de
cambio es otra funcionalidad —fuente, fecha, tratamiento contable de la
diferencia— y hacerla a medias es peor que no hacerla.

**Sin proyección.** Un peso futuro en esta pantalla mezclaría hecho con
estimación, que es exactamente lo que la fase 4 tiene que evitar desde el
modelo de datos.

---

## 8 · Casos límite que hay que resolver antes de escribir código

1. **Cuenta aprobada con `saldo_final_banco` nulo.** No entra al total y se
   nombra. Tratarlo como cero mentiría a la baja.
2. **Cuentas con cortes distintos.** El total lleva el corte más antiguo; cada
   cuenta enseña el suyo.
3. **Cobros aplicados a medias** (el aviso de `estadoCobros`). No afecta al saldo
   bancario —que sale del extracto— pero sí a lo vencido, así que el
   «disponible» puede quedarse corto. Si hay una aprobación incompleta, se avisa.
4. **Períodos no consecutivos.** Si la última aprobada es de junio y existe otra
   de abril, el saldo es el de junio: la última manda, no la suma.
5. **Moneda de la cuenta frente a moneda del comprobante.** El vencido se agrupa
   por la del comprobante; una cuenta USD solo se resta contra vencido en USD.

---

## 9 · Qué NO entra en la fase 1

Compromisos recurrentes · proyección · alertas de liquidez · saldo vivo entre
conciliaciones · conversión de moneda · herramientas nuevas del asistente.

Todo eso es fase 2 en adelante. **La fase 1 es honesta precisamente porque no
promete futuro**: solo dice, con fecha, lo que hay.

---

## 10 · Plan

| Paso | Entregable | Tocado |
|---|---|---|
| 1 | Migración `0050_posicion_caja.sql` | tabla nueva: ninguna. Solo una función |
| 2 | `src/lib/posicionCaja.ts` + tests | nuevo |
| 3 | `src/lib/posicionCaja-servidor.ts` | nuevo |
| 4 | Ruta `/caja` + entrada en la navegación | nuevo |
| 5 | Gancho de una línea en `/resumen` | una línea |

**Cero migraciones sobre tablas existentes. Cero cambios en el motor. Ninguna
pantalla actual cambia de comportamiento.** Si la fase 1 se revierte entera,
basta con quitar la ruta.
