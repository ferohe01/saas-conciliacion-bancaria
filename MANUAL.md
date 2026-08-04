# MANUAL.md — Referencia funcional

Qué hace el sistema, cuándo se usa cada cosa y qué reglas impone. **No es el
manual operativo**: es el material del que se escribirá, con las decisiones y
los porqués que el manual tendrá que traducir a lenguaje de usuario final.

Complementa a los otros tres: `PRODUCT.md` dice para quién es, `DESIGN.md` cómo
se ve, `CLAUDE.md` cómo está construido. Aquí está **qué hace**.

Actualizado: 2026-08-04.

---

## 1. Los dos estados de una conciliación

La confusión más probable de todo el sistema, y hay que explicarla temprano:
una conciliación tiene **dos estados que no significan lo mismo**.

| | Qué responde | Valores |
|---|---|---|
| **Estado técnico** | ¿Terminó de procesarse? | En cola · Conciliando · Completada · Con error |
| **Estado contable** | ¿Este documento vale? | Borrador · Observada · **Aprobada** · Anulada · Reemplazada |

Son independientes. Una conciliación puede estar **Completada** (el motor
terminó) y ser todavía un **Borrador** (nadie la ha dado por buena). En la
pantalla del historial se ven las dos pastillas, una al lado de la otra.

**Por qué importa:** hasta que no se aprueba, **no cuenta para nada**. Ni en el
panel de control, ni en los reportes, ni en el saldo de los comprobantes.

### Qué significa cada estado contable

- **Borrador** — recién procesada. Se puede revisar y cambiar. No mueve saldos.
- **Observada** — alguien marcó que algo no cuadra. Deja de regir hasta que se
  resuelva y se apruebe.
- **Aprobada** — es la que vale para ese período. **La única que descuenta el
  saldo de los comprobantes** y la única que suma en el panel y los reportes.
- **Anulada** — se descartó. Se conserva como historial. **No admite vuelta
  atrás**: para rehacer el período, se concilia de nuevo.
- **Reemplazada** — otra versión del mismo período se aprobó en su lugar. No se
  elige: la pone el sistema. **Tampoco admite vuelta atrás.**

### Aprobar

Requiere que el proceso haya **terminado** (estado técnico *Completada*). Al
aprobar:

1. Se registra quién aprobó y cuándo.
2. Si había otra conciliación aprobada del mismo período y la misma cuenta,
   pasa automáticamente a **Reemplazada** y deja de descontar saldo.
3. Se aplican los cobros a los comprobantes: los saldos bajan.

> **Para el manual:** el usuario debe entender que aprobar es el acto que hace
> que su trabajo cuente. Si concilia y no aprueba, el panel seguirá igual que
> antes — por eso el panel avisa en ámbar cuando hay conciliaciones terminadas
> sin aprobar.

---

## 2. Varias conciliaciones del mismo período

Está permitido, y hay dos situaciones distintas que el manual debe separar.

### a) Varias corridas del mismo período y la misma cuenta → versiones

Reprocesar tras corregir datos, volver a correr por movimientos que llegaron
tarde, etc. Cada corrida es una **versión** (v1, v2, v3…) y se numeran solas.

**Regla que impone el sistema:** solo una puede estar aprobada. Aprobar la v3
deja la v2 en *Reemplazada* automáticamente. Ninguna se borra: el historial las
conserva todas, y la ficha de cada una dice de cuál viene.

### b) Cortes distintos del mismo mes → conciliaciones independientes

Conciliar del 1 al 10, del 11 al 20 y del 21 al 31. Los tres cortes conviven
aprobados porque **no se solapan**, y los reportes los suman.

**Regla que impone el sistema:** no puede haber dos conciliaciones aprobadas
cuyos rangos de fecha se pisen, en la misma cuenta. Si se intenta, la operación
se rechaza.

### c) Cuentas bancarias distintas, mismo período → permitido

Son extractos diferentes, así que ambas pueden estar aprobadas a la vez. Es lo
normal cuando la empresa tiene BCP e Interbank y concilia las dos en julio.

> **Cuidado documentado:** al usar la fuente "mis comprobantes", el sistema deja
> fuera los que ya están cobrados, para que la misma factura no se cobre dos
> veces desde dos cuentas distintas. Ver §4.

---

## 3. Conciliar un período (el flujo)

Tres pasos en `/wizard`:

1. **Cargar datos.** Se elige período y cuenta bancaria, el origen de los
   registros internos y se sube el extracto del banco (Excel, CSV o PDF).
2. **Mapear columnas.** El sistema detecta las columnas solo; se corrigen si
   hace falta. Recuerda el formato de cada cuenta para la próxima vez.
3. **Confirmar y conciliar.** Lo que se ve en pantalla es exactamente lo que se
   procesa.

### El origen de los registros internos

| Origen | Qué hace | Cierra el bucle de cobranzas |
|---|---|---|
| **Usar mis comprobantes** | Toma las facturas ya registradas | ✅ **sí** |
| Conectar sistema | Próximamente (ver §3.1) | — |

Los registros internos salen **siempre** de tus comprobantes. El extracto del
banco sí se sube como archivo (Excel, CSV o PDF): son cosas distintas.

> **Nota:** hubo una tercera opción, "Subir archivo", que se retiró. Conciliaba
> igual y se veía idéntica en pantalla, pero **ningún comprobante quedaba
> cobrado y ningún saldo se movía nunca** — el error silencioso más probable del
> producto. No falla nada; simplemente no ocurre lo que se espera. Por eso ya no
> se ofrece.

### 3.1 Conectar sistema (`/conexiones`)

La idea: que tus comprobantes lleguen solos desde donde los emites (Nubefact,
Defontana, tu ERP…), sin plantillas ni cargas manuales.

**Todavía no está disponible.** La pantalla sirve para dejarnos los datos de tu
sistema —cuál es, dónde vive su API, con quién coordinamos— y que preparemos la
conexión. Mientras el estado no diga **Activa**, no se sincroniza nada y se
concilia con los comprobantes como siempre.

- **No te pedimos contraseñas ni API keys**, y no las guardamos. La credencial
  se pide por un canal seguro el día que la conexión se active.
- **Probar conexión** no se conecta a nada todavía: revisa si nos falta algún
  dato para poder prepararla, y lo dice con esas palabras.
- Estados: *Registrada* (tenemos tus datos) → *En preparación* (la estamos
  montando) → *Activa* (ya trae comprobantes) / *En pausa*.

---

## 4. Comprobantes, por cobrar y por pagar

### Comprobantes (`/comprobantes`)

Todas las facturas: las que cobras y las que pagas. Se cargan con una plantilla
Excel descargable. Filtros: tipo, estado, año, mes y buscador por serie o
contraparte (ignora tildes: "nunez" encuentra "Ñuñez").

Cada documento enlaza a su **ficha** (§5).

**Estados** — los calcula el sistema a partir del saldo, no se editan a mano:

- **Pendiente** — no se ha cobrado nada.
- **Cobrado en parte** — entró algo, queda saldo.
- **Cobrado** — saldado.
- **Anulado** — dado de baja.

### Por cobrar (`/cobranzas`) y Por pagar (`/pagos`)

Antigüedad de la deuda agrupada por cliente o proveedor. Solo aparece lo que
tiene **saldo vivo**: lo saldado y lo anulado no son deuda.

Filtros: **tramo de antigüedad** (por vencer, 1-30, 31-60, 61-90, +90 días),
**solo vencido**, y buscador por contraparte, RUC o serie. No hay filtro de
período ni de estado a propósito — la pregunta aquí es *cuánto llevo sin
cobrar*, no *de qué mes es*.

Los totales de arriba siempre corresponden a lo filtrado.

### Cómo bajan los saldos

Solos, al **aprobar** una conciliación cuyos registros internos vinieron de los
comprobantes. Nadie los toca a mano. El reparto:

- Cobro exacto → se salda la factura.
- Entró menos → queda saldo pendiente (queda *Cobrado en parte*).
- Un depósito que cubre varias facturas → cada una recibe su parte proporcional.

**Una factura nunca puede recibir más de lo que vale.** El sistema lo impide en
tres capas: el wizard no ofrece las ya cobradas, el reparto tope en el saldo que
queda, y la base rechaza la escritura si aun así algo intentara pasarse.

---

## 5. Anular un cobro que el banco revirtió

Cheque devuelto, transferencia revertida, contracargo. El cobro se aplicó, pero
el dinero no llegó a quedarse.

**No hace falta anular la conciliación entera.** Se busca la factura en
`/comprobantes`, se abre su ficha y en la lista de cobros aplicados se pulsa
**"Anular este cobro"**, indicando el motivo.

Qué pasa:

- El saldo de esa factura vuelve, y su estado con él.
- **La conciliación sigue aprobada e intacta**, con sus demás cobros.
- El cobro anulado **no desaparece**: queda tachado con la fecha y el motivo. Se
  conservan las dos caras — que el cobro ocurrió y que se deshizo después.
- La factura vuelve a estar disponible para conciliarse en el futuro.
- Se puede **deshacer la anulación** si fue un error.

> **Para el manual:** explicar por qué el cobro anulado sigue visible. Un usuario
> podría esperar que desaparezca; que se quede es deliberado, porque una
> conciliación aprobada no debe cambiar retroactivamente.

---

## 6. Panel de control y reportes

### Panel (`/dashboard`)

Cuatro cifras del ejercicio: **por revisar**, **períodos cuadrados**,
**automatización** y **movimientos**; volumen mensual y distribución por método.

Filtros de ejercicio, mes, banco y cuenta. **Todo en la página respeta el
filtro**, incluidas las sugerencias pendientes y la lista de últimas
conciliaciones. El encabezado dice qué recorte se está mirando.

**Solo suma lo aprobado.** Si hay conciliaciones terminadas sin aprobar, avisa
en ámbar con el número, porque si no parecería que el trabajo se perdió. Las
*Reemplazadas* no avisan: no son trabajo pendiente, son versiones superadas.

### Reportes (`/reportes`)

Mismos KPIs con detalle por método, por tipo de diferencia y por banco.
Exportable a Excel. Cada método y cada tipo enlazan a su detalle por registro.

---

## 7. Revisión de sugerencias de la IA

El motor concilia en capas: coincidencia exacta, difusa, agrupación de varias
partidas y, por último, IA. **Lo que la IA propone nunca se concilia solo** por
debajo del umbral de confianza configurado: pasa a una cola de sugerencias donde
se acepta o rechaza, una a una o en lote.

Cada decisión queda guardada con usuario y fecha. Además de la trazabilidad,
alimentan el aprendizaje: las últimas decisiones de la empresa se le muestran a
la IA como ejemplos para que calibre su criterio.

Una conciliación **se puede aprobar con sugerencias sin revisar**. Las
pendientes no descuentan saldo — solo lo hacen las aceptadas, las modificadas y
las que el motor concilió automáticamente.

---

## 8. Configuración y límites

- **`/configuracion`** — tolerancias de monto, días y umbrales de la IA por
  empresa. Se aplican a cada conciliación nueva; **lo ya conciliado no se
  reinterpreta** si se cambian después.
- **Período de prueba** — 30 días. Al vencer se conserva **todo el acceso de
  lectura** (historial, reportes, cuentas, configuración) y se pierde una sola
  capacidad: **iniciar una conciliación nueva**.
- **Módulos** — cuentas por cobrar y por pagar pueden requerir contratación
  aparte; si no están activos, la pantalla lo explica.

---

## Apéndice — Preguntas que el manual debería responder

Recogidas de dudas reales durante el desarrollo:

1. *Concilié y el panel sigue en cero.* → No está aprobada. Ver §1.
2. *Concilié y los saldos de mis facturas no bajaron.* → Si es una conciliación
   antigua, el origen fue un archivo y no los comprobantes; esa opción ya no
   existe. Si es reciente, falta aprobarla. Ver §3 y §1.
3. *¿Puedo conciliar el mismo mes dos veces?* → Sí, son versiones. Ver §2a.
4. *¿Y por quincenas?* → Sí, son cortes independientes. Ver §2b.
5. *El banco me devolvió un cheque ya conciliado.* → Ver §5.
6. *Filtré por una cuenta y me seguían saliendo sugerencias de otra.* →
   Corregido; el filtro alcanza a toda la página.
7. *¿Por qué no me deja aprobar dos conciliaciones del mismo mes?* → Solo si son
   de la misma cuenta y sus fechas se pisan. Ver §2.
