# Juego de pruebas — COBROS ENTRE MESES

> Existe para demostrar **un solo problema**: los comprobantes se eligen por
> fecha de emisión dentro del período, así que una factura de junio cobrada en
> julio **no se puede conciliar en ningún período**.
> Ver `docs/analisis-periodo-comprobantes.md`.

Se regenera con:

```bash
node ops/generar-pruebas-arrastre.mjs --salida ./pruebas-arrastre
```

## Los archivos

| Archivo | Contenido |
|---|---|
| `mayor-junio-2026.xlsx` | **92 comprobantes** · 20 al contado, 60 a crédito 30 días, 12 pagos |
| `extracto-bcp-junio-2026.xlsx` | **34 movimientos** |
| `mayor-julio-2026.xlsx` | **72 comprobantes** · 20 al contado, 40 a crédito, 12 pagos |
| `extracto-bcp-julio-2026.xlsx` | **94 movimientos**, de los que **62 pagan facturas de JUNIO** |

Formato idéntico al juego de la plantilla, así que el mapeo guardado de la
cuenta BCP sirve tal cual.

⚠️ **Los pares cruzados comparten importe y referencia exactos.** La capa exacta
los casaría sin dudar: lo único que se lo impide es el filtro de período. Si tras
el cambio siguieran sin casar, la causa sería otra — y eso es justo lo que un
juego de pruebas tiene que poder distinguir.

## Para el Paso 1

| | Saldo según libros (final) | Saldo extracto inicial |
|---|---|---|
| **Junio** (01/06–30/06) | **1.023.846,28** | 120.000,00 |
| **Julio** (01/07–31/07) | **1.614.580,67** | 1.070.620,20 *(lo detecta solo)* |

## Qué debe salir HOY

```
junio    92 internos · 34 movimientos  →  30 pares ·  62 internos sueltos ·   4 mov. sueltos
julio    72 internos · 94 movimientos  →  28 pares ·  44 internos sueltos ·  66 MOV. SUELTOS
```

⚠️ Los **66 movimientos sueltos de julio** son el síntoma: el 70 % del extracto
sin explicar, y son los abonos de mayor importe. Sesenta y dos de ellos pagan
facturas de junio que julio no puede ver.

**El de junio no es un fallo**: al 30/06 las ventas a crédito todavía no se han
cobrado, así que quedan pendientes con razón. Eso es un depósito en tránsito de
manual.

### El cuadre lo dice con dinero

| | Diferencia de julio |
|---|---|
| Hoy | **−824.149,24** ← exactamente el arrastre de junio |
| Con el arreglo | **−54,40** |

Los 54,40 que quedan son los **gastos bancarios de junio** (mantenimiento,
portes, comisión, ITF) que los libros nunca registraron. Es un hallazgo legítimo
del cuadre, no un residuo del error: en la vida real se contabilizan tras cerrar
junio y entonces cierra a cero.

⚠️ El cuadre de **junio cierra en 0,00 exacto**. El juego es consistente consigo
mismo, así que cualquier diferencia distinta de estas dos es un hallazgo de
verdad.

## Qué debe salir DESPUÉS del arreglo

```
julio   134 internos (72 de julio + 62 arrastrados)
        →  90 pares ·  44 internos sueltos ·  4 mov. sueltos
```

**De 66 movimientos sueltos a 4.**

⚠️ Los **44 internos sueltos tienen que seguir sueltos**: son las ventas a
crédito de julio, que se cobran en agosto. Si desaparecieran, el arrastre
estaría casando cosas que no debe.

## Qué debe medir `/cuando-pagan`

Con junio y julio conciliados y aprobados, cada cliente con su costumbre:

| Cliente | Documentos | Mediana | Rango |
|---|---|---|---|
| Distribuciones Puno S.R.L. | 6 | **+20** | 15 … 25 |
| Corporación Huancayo S.A.C. | 6 | **+18** | 8 … 19 |
| Ferretería Lima Norte E.I.R.L. | 6 | **+11,5** | 7 … 12 |
| Minimarket Los Olivos E.I.R.L. | 6 | **+9** | 9 … 10 |
| Textiles Gamarra S.A. | 6 | **+7** | 7 … 8 |
| Importaciones Piura S.A.C. | 6 | **+4** | 4 … 5 |
| Servicios Generales Arequipa E.I.R.L. | 6 | **+3** | 3 … 4 |
| Comercial Ñuñez S.A.C. | 6 | **0** | 0 … 1 |
| Julio César Vargas Ríos | 6 | **−2** | −2 … −2 |
| Agroindustrias del Norte S.A.C. | 6 | **−6** | −6 … −6 |
| Bodega Santa Rosa, Cliente mostrador, Farmacia San Juan, Librería El Estudiante | 10 c/u | **0** | 0 … 0 |

Cubre los cuatro tramos de `puntualidad()` —antes, puntual, algo tarde, tarde— y
además pone al lado los dos casos que dan **0 días y significan lo contrario**:
los de mostrador (*«paga puntual, medido en 10 documentos»*) frente a cualquiera
sin historial (*«se usará el vencimiento»*).

⚠️ **Hoy esta tabla no puede salir.** Sin arrastre, las ventas a crédito de junio
nunca se concilian, así que no hay ni una observación con retraso distinto de
cero: los únicos pares medibles serían los de mostrador.

## Cómo correrlo

1. Vaciar la empresa (`ops/limpiar-empresa.sql`) — **conserva** cuentas y mapeos.
2. Cargar `mayor-junio-2026.xlsx` → conciliar junio → **aprobar**.
3. Cargar `mayor-julio-2026.xlsx` → conciliar julio → **aprobar**.
4. Anotar los números de arriba **antes** de tocar el código: son la línea base.

## Detalles del formato

- `monto` siempre positivo; el signo lo pone `tipo`.
- `referencia` (serie) es única en los dos meses: el índice de la `0018` no
  rechaza nada.
- `referencia_externa` es el código de operación del banco, **único por
  comprobante**: aquí no se prueba la agrupación 1:N, se prueba el período.
- Fechas `dd/mm/aaaa`, sin domingos, una sola moneda (PEN).
- Sin detracciones, retenciones ni notas de crédito: esa casuística ya la cubre
  el juego de la plantilla. **Este juego prueba una cosa sola.**
