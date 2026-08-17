# Fase 3 — Flujo de caja proyectado (`/flujo`)

> Tercer módulo de la plataforma financiera. La conciliación dice **qué pasó**;
> la posición de caja, **cuánto hay**; esto dice **si alcanza**.

## 0 · La tesis, y por qué este módulo es distinto de los dos anteriores

Los dos primeros módulos solo afirman hechos. Este es el primero que **habla del
futuro**, y eso cambia todas las reglas: un número futuro no se puede verificar
contra nada. Nadie va a descubrir que estaba mal hasta que sea tarde.

Por eso la pregunta de diseño no es «¿cómo proyectamos?» —eso es aritmética—
sino **«¿por qué habría alguien de creerse esta curva?»**.

La respuesta es lo único que este producto tiene y una plantilla de Excel no:

> **La proyección se calibra con el historial CONCILIADO de la propia empresa.**
> No estimamos cuándo paga un cliente: lo **medimos**, contra el extracto del
> banco, en las conciliaciones que esa empresa ya aprobó.

Una hoja de cálculo asume que la factura a 30 días se cobra el día 30. Nosotros
sabemos que Comercial Ñuñez paga a 12 días de su vencimiento y que Minimarket
Los Olivos a 41, porque lo hemos visto ocurrir. **Esa diferencia es el módulo
entero.**

---

## 1 · Tres clases de peso, y no se mezclan nunca

Es la regla que hereda de los otros dos módulos —lo probado no se funde con lo
provisional— llevada un paso más allá:

| | Qué es | Qué se estima | Ejemplo |
|---|---|---|---|
| **Hecho** | El saldo de partida | nada | S/ 1.611.395,80 al 15/08 |
| **Comprometido** | Existe un documento con importe y vencimiento | **cuándo**, no si | Factura F001-2841 de S/ 14.107 |
| **Previsto** | No hay documento; se repite | **cuándo y cuánto** | Planilla, alquiler, IGV |

⚠️ **En lo comprometido la incertidumbre está en la FECHA, no en el hecho.** La
factura existe, el cliente debe ese dinero. Lo que no se sabe es qué día entra.
En lo previsto se estiman las dos cosas. Confundir ambas categorías es lo que
hace que una proyección parezca más firme de lo que es.

⚠️⚠️ **Y una proyección no puede ser más firme que su punto de partida.** Si
arranca del saldo vivo —provisional, sin conciliar— la curva **entera** es
provisional, por mucho que las facturas sean reales. La pantalla hereda la
etiqueta de su origen y lo dice arriba. No hay una versión «medio probada».

---

## 2 · El calibrado: cuándo paga de verdad cada contraparte

El dato ya existe y nadie lo ha mirado todavía:

```
comprobantes ──► matches_conciliacion ──► movimientos_extracto
   (vencimiento)     (par conciliado)          (fecha real del abono)
```

`matches_conciliacion` guarda `comprobante_ids uuid[]` y `movimiento_ids uuid[]`
**como claves reales**, así que se puede saber en qué fecha del extracto se
cobró cada factura. Con eso:

```
retraso(comprobante) = fecha del movimiento − fecha_vencimiento
dias_pago(contraparte) = MEDIANA de sus retrasos
```

Decisiones que hacen que la cifra valga algo:

- ⚠️ **Mediana, no media.** Un cliente que una vez pagó a 180 días desplazaría
  toda su previsión. La mediana describe lo que suele pasar, que es lo que se
  proyecta.
- ⚠️ **Solo conciliaciones APROBADAS** y pares en `ESTADOS_CONFIRMADOS`
  (`auto`, `aceptado`, `modificado`). Misma regla que el resto del sistema: lo
  que no está aprobado no ha movido un céntimo y no puede enseñar nada.
- ⚠️ **Mínimo de observaciones (3).** Con una factura no hay costumbre que medir.
  Sin historial suficiente se cae, en este orden, a **la mediana de la empresa**
  y luego al **vencimiento tal cual** — y la pantalla dice cuál se usó.
- ⚠️⚠️ **«Paga puntual» y «no lo sabemos» dan los dos 0 días, y no son lo
  mismo.** Se distinguen siempre en el detalle: *«a 2 días de su vencimiento,
  medido en 8 facturas»* frente a *«sin historial: se usa el vencimiento»*.
- **Se calibra por contraparte y por signo.** Lo que tarda un cliente en pagarte
  no dice nada de lo que tardas tú en pagar a un proveedor.
- Solo modo tabla. Los jobs antiguos guardan los pares en el JSONB y no
  participan del calibrado; se dice en vez de mezclarlos.

**Esto es también el mejor argumento comercial del producto entero**: el valor de
conciliar deja de ser «cuadrar» y pasa a ser «saber cuándo te van a pagar».

---

## 3 · Lo que se repite todos los meses

Una proyección de caja que ignora la planilla no es una proyección de caja: es
una lista de facturas. Y su error es **sistemáticamente optimista**, que es la
peor dirección posible para esta pantalla.

Pero los sueldos, el alquiler y los tributos no tienen comprobante en el sistema
(o lo tienen tarde). Hay dos salidas y ninguna sirve sola:

- **Que el usuario los declare.** Correcto, y nadie lo hace: es un formulario en
  blanco frente a alguien que solo quería ver un gráfico.
- **Detectarlos.** Cómodo, y adivinar un compromiso de S/ 45.000 que no existe
  arruina la curva sin que nadie lo note.

La salida es la de siempre en este proyecto: **se afirma el hecho y decide la
persona.** Del historial conciliado se extraen los movimientos que **se repiten**
—misma glosa normalizada, ≥3 meses distintos, importe estable— y se proponen con
su evidencia:

> *«PAGO TRIBUTOS SUNAT IGV salió el 15/06 (S/ 18.400), el 15/07 (S/ 21.100) y
> el 14/08 (S/ 19.800). ¿Lo cuento cada mes?»*

Eso no es una predicción, es una observación sobre su extracto. El usuario
confirma, ajusta el importe o lo descarta.

⚠️ **Y mientras no haya ninguno confirmado, la pantalla dice lo que NO está
contando**, con la cifra sacada del propio historial: *«esta proyección no
incluye sueldos, alquiler ni tributos; en tus últimos tres meses eso fueron unos
S/ 62.000 mensuales»*. Un silencio ahí convierte una curva optimista en una
mentira. Y es además lo que empuja a confirmarlos.

---

## 4 · Qué se ve

**El resultado no es la curva: es la primera fecha en rojo.** La curva es el
soporte de esa frase.

```
Flujo de caja proyectado                     Parte de S/ 1.611.395,80 al 15/08
                                             ~ saldo sin conciliar · provisional

┌───────────────────────────────────────────────────────────────────────────┐
│  ⚠️  Te quedas corto la semana del 21/09                                   │
│      Faltan S/ 34.200 para cubrir los pagos de esa semana.                 │
│      [ Ver qué compone esa semana ]                                       │
└───────────────────────────────────────────────────────────────────────────┘

   S/                                                            
 1.8M ┤ ●───●                                                    
 1.2M ┤       ●───●───●                                          
 600k ┤                   ●───●                                  
    0 ┼───────────────────────────●───●─────────────────────      
      │ 17/08  24/08  31/08  07/09  14/09  21/09  28/09  …        

  Semana        Entradas    Salidas    Saldo al cierre
  17/08–23/08   142.300     −88.400    1.665.295
  24/08–30/08    98.100    −210.500    1.552.895   ← planilla
  …
```

- **13 semanas.** Es el horizonte estándar de tesorería y el que responde las dos
  preguntas reales: *¿llego a fin de mes?* y *¿puedo pagar la planilla del 30?*
- **Cada semana se puede abrir** y ver de qué partidas está hecha, cada una con
  su clase (comprometido / previsto) y, en las comprometidas, **por qué está en
  esa semana**: *«vence el 10/09; este cliente paga a 12 días»*.
- ⚠️ **Si no puedes ver de qué está hecho un número, no deberías decidir con él.**
  El desglose no es una función avanzada: es lo que hace responsable a la curva.
- **Cuando no hay rojo, se dice igual**, con el punto más bajo: *«tu momento más
  ajustado son S/ 42.000 la semana del 14/09»*. Una pantalla que solo habla
  cuando hay problemas deja sin saber si el silencio es «vas bien» o «no se
  miró».
- **Un bloque por moneda**, sin convertir ni sumar entre ellas (misma regla que
  `agingPorMoneda` y la posición de caja).

---

## 5 · Datos

Una tabla nueva y tres funciones. **Ninguna tabla existente cambia.**

```sql
-- 0052
create table compromisos_recurrentes (
  id, empresa_id, cuenta_id,
  descripcion text, monto numeric, moneda text,
  dia_del_mes int,              -- 1..31; se recorta al último día del mes
  signo int check (signo in (-1, 1)),
  origen text check (origen in ('detectado', 'declarado')),
  activo boolean default true,
  ...
);

-- Ingredientes; la composición se hace en TypeScript (ver §6)
dias_pago_contraparte()   -- mediana de retraso, por contraparte y signo
pendientes_proyectables() -- comprobantes con saldo > 0 y su vencimiento
recurrentes_detectados()  -- candidatos del historial, con su evidencia
```

Todas `security definer` con la empresa resuelta desde `auth.uid()`, nunca por
parámetro, y con `revoke ... from public, anon` — el patrón de `resumen_saldos`
(0021), `resumen_ejecutivo` (0032) y `posicion_caja` (0050).

⚠️ **Las tres devuelven hechos agregados, no la proyección.** Colocar cada
partida en su semana y arrastrar el saldo es una regla de negocio: vive en
`src/lib/flujoCaja.ts`, puro y con tests. Es la misma división que
`candidatos_partida` / `diagnosticoPartida`: **SQL busca, TypeScript decide.**

---

## 6 · Lógica pura: `src/lib/flujoCaja.ts`

```ts
export type Clase = "comprometido" | "previsto";

export type Partida = {
  fecha: string;          // la fecha PROYECTADA, no el vencimiento
  monto: number;          // con signo: entra +, sale −
  clase: Clase;
  concepto: string;
  contraparte: string | null;
  /** Por qué cae en esa fecha. Se enseña en el desglose. */
  porQue: string;         // «vence el 10/09; este cliente paga a 12 días»
};

export type Semana = {
  desde: string; hasta: string;
  entradas: number; salidas: number;
  saldoCierre: number;
  partidas: Partida[];
};

export function proyectar(
  inicio: { saldo: number; fecha: string; probado: boolean },
  pendientes: Pendiente[],
  calibrado: Map<string, Calibrado>,
  recurrentes: Recurrente[],
  semanas: number,
): { semanas: Semana[]; primerRojo: Semana | null; minimo: Semana };
```

**Invariantes que fijan los tests:**

1. Una partida vencida y no cobrada **no desaparece**: se proyecta en la primera
   semana, no en el pasado. Ignorarla sería asumir que ya no se va a cobrar.
2. Nunca se suman monedas distintas.
3. El saldo de cierre de una semana es el de apertura de la siguiente. Sin
   huecos, sin dobles conteos.
4. `primerRojo` es `null` cuando la curva nunca baja de cero — y entonces se
   informa del `minimo`, que siempre existe.
5. Toda partida lleva `porQue` no vacío. Un peso sin explicación no entra.
6. Cambiar el calibrado mueve partidas de semana **sin cambiar el total**: lo que
   se estima es el cuándo.

---

## 7 · Casos límite resueltos antes de escribir código

1. **Factura vencida hace tres meses.** Se proyecta ya, en la primera semana, y
   se marca. Descartarla decide por el usuario que es incobrable.
2. **Contraparte sin historial.** Se usa el vencimiento y **se dice**.
3. **Comprobante sin `fecha_vencimiento`.** Muchas ventas son al contado: se usa
   `fecha`, igual que hace `diasVencido` en el aging. Una sola regla para los dos
   sitios.
4. **Sin ninguna conciliación aprobada.** No hay punto de partida ni calibrado:
   estado vacío que lleva a conciliar, no una curva desde cero.
5. **Recurrente que cae en 31 y el mes tiene 30.** Al último día del mes.
6. **Cobro parcial.** Se proyecta el `saldo`, no el `monto`. Lo ya cobrado está
   en el saldo de partida.

---

## 8 · El riesgo del módulo, escrito por delante

**Que la curva se use como si fuera cierta.** Es el modo de fallo natural de
cualquier proyección, y aquí duele más porque las otras dos pantallas del
producto sí son verificables: el usuario llega entrenado a fiarse.

Se acota con lo de arriba —tres clases visibles, desglose por semana, `porQue` en
cada partida, la etiqueta del origen— y con una regla de contención:

> ⚠️ **La proyección no se exporta a Excel en la fase 3.** Fuera de la pantalla
> pierde las etiquetas que la hacen honesta y se convierte en una tabla de
> números que alguien pega en un informe. Cuando se exporte, será con sus clases
> y sus porqués, o no se exporta.

---

## 9 · Qué NO entra

Escenarios y *what-if* · líneas de crédito · conversión de moneda · alertas por
correo · cobranza automática · un LLM que redacte la previsión. Y **nada de
sugerir acciones** («llama a este cliente»): el módulo informa, no dirige.

---

## 10 · Plan, en tres entregas desplegables

| # | Entregable | Qué desbloquea |
|---|---|---|
| **3a** | Migración `0052` + `dias_pago_contraparte()` + pantalla **«Cuándo te pagan de verdad»** | Valor solo, sin proyectar nada. Es la mitad más creíble del módulo y se puede enseñar ya |
| **3b** | `pendientes_proyectables()` + `flujoCaja.ts` + `/flujo` con comprometidos | La curva, honesta sobre lo que omite |
| **3c** | `recurrentes_detectados()` + confirmación + su peso en la curva | La proyección deja de ser optimista |

**3a merece ir sola.** Responde *«¿quién me paga tarde?»* con datos medidos, no
proyecta nada, y por tanto no puede equivocarse sobre el futuro. Si el módulo
entero se parara ahí, seguiría siendo lo más valioso que se ha construido encima
de la conciliación.

**Cero cambios en tablas existentes. Cero cambios en el motor. Si la fase 3 se
revierte, basta con quitar la ruta.**
