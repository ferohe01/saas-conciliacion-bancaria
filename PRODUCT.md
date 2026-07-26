# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dos audiencias con **el mismo peso**, confirmadas por el usuario:

1. **Dueño o administrativo de una PyME peruana.** Lleva las cuentas de su
   propia empresa y **no es contador de profesión**. Necesita lenguaje simple,
   sin jerga contable, y saber en cada momento qué se espera de él.
2. **Contador externo que atiende varias PyMEs.** Profesional que concilia para
   varios clientes distintos. Conoce la terminología y valora la velocidad.

Ninguna de las dos manda sobre la otra: el producto debe ser comprensible para
quien no es contador **y** eficiente para quien sí lo es.

**Situación y trabajo:** cierre de un período (típicamente un mes). La persona
tiene por un lado sus registros internos (ventas, cobranzas, comprobantes) y por
otro el extracto que le dio el banco, y necesita dejarlos cuadrados,
justificando cada diferencia, antes de cerrar el mes.

**Cómo trabaja el contador externo con varios clientes (confirmado):** con **una
cuenta por cada cliente** — un login separado por PyME. No existe (ni está
comprometido) un selector de empresa dentro de una sola cuenta, ni ninguna vista
que cruce clientes. La tabla `usuarios_empresa` admite N empresas por usuario en
la base de datos, pero la aplicación no lo expone y **no debe asumirse**.

## Product Purpose

Dejar conciliado un período entre los registros internos de la empresa y el
extracto bancario, con la IA haciendo el trabajo repetitivo de emparejar y la
persona conservando la última palabra.

**La interfaz orquesta, normaliza y presenta; el motor de conciliación vive
fuera (n8n).** Este producto carga y normaliza los datos, dispara el proceso,
muestra el avance en vivo, presenta el resultado para revisión humana y persiste
cada decisión.

**Éxito** es un período cerrado y exportado a Excel, con cada diferencia
explicada y cada decisión humana registrada — no un porcentaje de automatización
alto a costa de matches que nadie miró.

## Positioning

Cuatro mecanismos que el usuario marcó como diferenciales que **trabajo futuro
no debe diluir**:

- **Aprende el criterio de TU empresa.** Las decisiones humanas confirmadas
  (aceptado / modificado / manual → positivo; rechazado → negativo) se
  reinyectan como ejemplos few-shot en el prompt de la IA en la siguiente
  corrida. Cada empresa calibra su propio umbral — cuánta comisión tolera,
  cuándo rechaza pese a montos iguales. Sin reentrenar ningún modelo.
- **Cualquier banco, sin integración.** Funciona con el extracto que el banco ya
  entrega en Excel, CSV o PDF. Cero APIs bancarias, cero Open Banking, cero
  espera de habilitación.
- **La IA propone, tú decides.** Nunca concilia sola por debajo del
  `umbral_confianza_auto`. Toda sugerencia pasa por revisión humana.
- **Explica cada diferencia.** No solo empareja: clasifica el porqué (comisión
  bancaria, pago parcial, diferencia temporal, diferencia de moneda, redondeo,
  agrupación 1:N).

## Operating Context

- **Ritual:** cierre mensual. El trabajo llega por período, no en tiempo real.
- **Volumen confirmado: 500 a 2000+ movimientos por conciliación.** Es una
  restricción de producto de primer orden: a esa escala la revisión humana **no
  es leer todo, es triaje** — el producto debe decir por dónde empezar
  (confianza, monto, tipo de diferencia) y permitir despachar en lote lo obvio.
- **Materiales de entrada:** archivo del banco (Excel / CSV / PDF) y registros
  internos, que pueden venir de un archivo, de la tabla `comprobantes` o de una
  plantilla Excel descargable. Cada banco peruano (BCP, BBVA, Interbank,
  Scotiabank…) trae su propio formato de columnas; el producto recuerda el mapeo
  por cuenta bancaria.
- **Flujo real:** wizard de 3 pasos (cargar → mapear columnas → confirmar y
  disparar) → pantalla de progreso en vivo → revisión de resultados en dos
  paneles → exportación a Excel. Además: historial, reportes analíticos,
  configuración de tolerancias por empresa y gestión de cuentas bancarias.
- **Asincronía:** una conciliación no es instantánea. El usuario dispara y
  espera, viendo la fase actual. Esa espera es parte de la experiencia, no un
  caso borde.
- **Moneda y formatos:** PEN (S/) por defecto. Fechas dd/mm/yyyy en pantalla,
  ISO 8601 en almacenamiento y transporte. Español de Perú.

## Capabilities and Constraints

**Existe y funciona hoy:** registro y login (email + contraseña), empresa y
cuentas bancarias, wizard completo con parsing real (SheetJS) y memoria de
formatos, disparo del motor con seguimiento en vivo (Supabase Realtime + polling
de respaldo), revisión humana con conciliación manual, exportación a Excel,
historial, configuración de tolerancias y umbrales por empresa, y reportes con
drill-down por método y por tipo de diferencia.

**Terminología canónica del dominio** (usar siempre estas palabras, no
sinónimos): conciliación · registros internos · movimientos bancarios · match ·
método (exacta / difusa / IA / manual) · categoría de diferencia · cuadre ·
período · job.

**Convención de signos única:** abonos y entradas positivos, cargos y salidas
negativos. Se fija al normalizar y nunca se reinterpreta.

**Restricciones técnicas:** el frontend nunca habla con n8n ni conoce keys
privilegiadas; todo pasa por el backend propio. RLS por empresa en todas las
tablas — la key `anon` jamás cruza empresas. TypeScript estricto. El motor de
conciliación **no vive en este repo**: cambiar su lógica es cambiar los nodos de
n8n.

**Fuera de alcance, deliberadamente:** equipos, roles, invitaciones y SSO ·
pgvector y búsqueda semántica · OCR y XML UBL de facturas · integraciones con
ERP, bancos u Open Banking · selector de empresa dentro de una cuenta.

**Decisiones abiertas:** ninguna registrada en esta ronda.

## Brand Commitments

- **Nombre vinculante: "Conciliaciones Inteligentes".** Es el nombre real del
  producto, no un placeholder. *Hecho observado:* el área autenticada
  (`src/components/app/AppNav.tsx`) lo abrevia hoy a "Conciliación" — es una
  inconsistencia existente, no una decisión.
- **Voz:** español de Perú, simple y amable. Se le explica a alguien que puede
  no ser contador, sin sonar condescendiente con quien sí lo es. Los mensajes de
  error dicen qué pasó y qué hacer.
- **Postura:** el producto no presume de autonomía. Presume de que tú decides.

## Evidence on Hand

- `interfaz.jpg` — mockup del Paso 1 del wizard, referencia de diseño del
  producto.
- **Compromiso comercial real (confirmado):** el primer período es gratis. Está
  vivo en `src/app/page.tsx` y es una promesa vinculante.
- Los datos del panel de la portada (`PARES`, "Venta 012", "S/ 450.00") son
  **ilustrativos**, no un caso real de cliente.

**Lo que NO existe y trabajo futuro tiene prohibido fabricar:** testimonios,
nombres de clientes, logos de empresas usuarias, número de usuarios, métricas de
resultados ("ahorra X horas", "99% de precisión"), benchmarks, cifras de precio
más allá del primer período gratis, certificaciones, menciones de prensa y
acuerdos con bancos.

## Product Principles

1. **La IA propone, la persona decide.** Nada se concilia solo por debajo del
   umbral, y el método de cada match siempre está a la vista. La confianza se
   gana mostrando el trabajo, no ocultándolo.
2. **Cada decisión humana es materia prima, no un click desechable.** Se
   persiste con usuario y timestamp, y vuelve a la IA en la siguiente corrida.
   Perder una decisión es perder aprendizaje.
3. **Explicar la diferencia vale tanto como emparejar.** Un match sin motivo
   obliga al usuario a investigar; el motivo es la mitad del producto.
4. **Cero fricción de integración.** El archivo que el banco ya te da tiene que
   bastar. Nada que pedirle a un banco, a un ERP ni a un área de sistemas.
5. **A dos mil movimientos, revisar es triaje.** El producto ordena por dónde
   empezar y deja despachar lo obvio en lote; nunca asume que alguien leerá cada
   fila.

## Accessibility & Inclusion

**Compromiso vinculante de todo el producto** (confirmado por el usuario):

- **El color nunca es el único portador de significado** — en ninguna pantalla.
  Estados de conciliación, etiquetas de método y categorías de diferencia llevan
  siempre texto, forma o ícono además del color.
- Donde el color codifica datos (gráficos de reportes), la paleta categórica es
  **Okabe-Ito**, validada para daltonismo. Ya en uso en `/reportes`.
- Contraste suficiente y foco visible en toda la aplicación.
- El usuario puede no ser contador: la accesibilidad aquí también es de
  lenguaje, no solo sensorial.
