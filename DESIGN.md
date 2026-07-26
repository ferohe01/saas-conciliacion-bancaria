---
name: Conciliaciones Inteligentes
description: Sistema visual de libro mayor para conciliación bancaria asistida por IA — papel administrativo preciso, color solo donde algo cuadró.
colors:
  azul-marcado: "#2563eb"
  azul-marcado-hover: "#1d4ed8"
  azul-marcado-borde: "#3b82f6"
  azul-marcado-halo: "#bfdbfe"
  azul-marcado-fondo: "#eff6ff"
  verde-cuadre: "#059669"
  verde-cuadre-texto: "#047857"
  verde-cuadre-borde: "#a7f3d0"
  verde-cuadre-fondo: "#ecfdf5"
  violeta-maquina: "#6d28d9"
  violeta-maquina-borde: "#ddd6fe"
  violeta-maquina-fondo: "#f5f3ff"
  ambar-agrupacion: "#b45309"
  ambar-agrupacion-fondo: "#fef3c7"
  rojo-descuadre: "#dc2626"
  rojo-descuadre-fondo: "#fef2f2"
  tinta: "#171717"
  tinta-hover: "#262626"
  grafito: "#404040"
  plomo: "#737373"
  plomo-claro: "#a3a3a3"
  linea: "#e5e5e5"
  linea-fuerte: "#d4d4d4"
  papel: "#f5f5f5"
  superficie: "#ffffff"
  dato-exacta: "#009E73"
  dato-difusa: "#0072B2"
  dato-ia: "#CC79A7"
  dato-sin-conciliar: "#D55E00"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(1.5rem, 3vw, 1.875rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  metric:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
  body-lg:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  dense:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.05em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  badge: "4px"
  control: "8px"
  campo: "12px"
  tarjeta: "16px"
  contenedor: "24px"
  pastilla: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  tarjeta: "20px"
  seccion: "24px"
  pagina: "32px"
components:
  button-primary:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.campo}"
    padding: "12px 24px"
    typography: "{typography.title}"
  button-primary-hover:
    backgroundColor: "{colors.tinta-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.linea-fuerte}"
    textColor: "{colors.superficie}"
  button-secondary:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.grafito}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-confirmar:
    backgroundColor: "{colors.verde-cuadre}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  input-field:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.grafito}"
    rounded: "{rounded.campo}"
    padding: "0 16px"
    height: "44px"
  card:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.tarjeta}"
    padding: "20px"
  shell-card:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.contenedor}"
    padding: "32px"
  badge-exacta:
    backgroundColor: "#d1fae5"
    textColor: "{colors.verde-cuadre-texto}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  badge-difusa:
    backgroundColor: "#dbeafe"
    textColor: "#1d4ed8"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  badge-ia:
    backgroundColor: "#ede9fe"
    textColor: "{colors.violeta-maquina}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  badge-manual:
    backgroundColor: "{colors.linea}"
    textColor: "{colors.grafito}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  step-active:
    backgroundColor: "{colors.azul-marcado}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.pastilla}"
    size: "28px"
  step-pending:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.plomo-claro}"
    rounded: "{rounded.pastilla}"
    size: "28px"
  upload-zone:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.plomo}"
    rounded: "{rounded.tarjeta}"
    padding: "32px 24px"
  upload-zone-loaded:
    backgroundColor: "{colors.verde-cuadre-fondo}"
    textColor: "#064e3b"
    rounded: "{rounded.tarjeta}"
    padding: "20px"
---

# Design System: Conciliaciones Inteligentes

## Overview

**Creative North Star: "El Libro Mayor Iluminado"**

Un libro mayor de toda la vida, pero legible. La forma primitiva del sistema es
el **par enfrentado** — `Tus registros ↔ Tu banco` — y todo lo demás existe para
servirlo: cifras tabulares que se alinean columna contra columna, superficies de
papel mate, líneas finas que separan sin gritar. El producto no le pide al
usuario que aprenda una interfaz nueva; le devuelve la que ya tenía en la cabeza,
ordenada.

La luz es el único lujo. Sobre ese papel neutro, el color aparece **solo cuando
algo pasó**: un par se emparejó, un saldo cuadró, la máquina propuso algo, una
cifra no calza. Nada es azul o verde por decoración. Esa disciplina es lo que
hace que el usuario pueda escanear dos mil movimientos y encontrar los doce que
importan — con 500 a 2000+ partidas por conciliación, revisar es triaje, y el
color es el instrumento del triaje.

El material es **papel administrativo, preciso**: superficies planas y mate,
definidas por línea antes que por sombra. Cuando algo sí lleva sombra, es porque
de verdad flota sobre lo demás (la barra pegajosa de conciliación manual, el
panel héroe de la portada). El sistema es sobrio sin ser frío: el radio generoso
de los contenedores (24px) y el aire alrededor de cada paso son el gesto de
hospitalidad hacia quien no es contador de profesión.

**Key Characteristics:**
- Par enfrentado como forma primitiva: dos columnas que se miran y un vínculo entre ellas.
- Cifras tabulares (`tabular-nums`) en absolutamente todo número.
- Plano por defecto: borde antes que sombra; la sombra es funcional, nunca decorativa.
- Color ganado: el acento marca un evento, no adorna una superficie.
- Fuente del sistema, sin webfonts: rendimiento y familiaridad por encima de firma tipográfica.
- Español de Perú, cifras en `S/`, fechas dd/mm/yyyy en pantalla.

## Colors

Una base de papel y tinta sobre la que cuatro acentos hacen un trabajo semántico
estricto: cada uno nombra un estado del acto de conciliar, y ninguno se usa fuera
de ese estado.

### Primary

- **Azul de Marcado** (`#2563eb`): el paso vivo y el par señalado. Numera el paso
  activo del wizard, colorea su etiqueta, resalta las dos filas de un par cuando
  el usuario lo selecciona (`#eff6ff` de fondo con borde `#60a5fa`), y marca todo
  enlace. Es el color de "aquí estás mirando" — no el de "esto está bien".
- **Azul de Marcado (halo)** (`#bfdbfe`): el anillo de foco de todo campo, sobre
  borde `#3b82f6`. Un solo tratamiento de foco en toda la aplicación.

### Secondary

- **Verde de Cuadre** (`#059669`): lo que ya calzó. El check del archivo cargado,
  el botón Aceptar de una sugerencia, el montaje en positivo de un monto, el KPI
  héroe de automatización, y el veredicto `S/ 0.00 ✓` cuando el período cuadra.
  Verde nunca significa "activo" ni "primario": significa **conciliado**.

### Tertiary

- **Violeta de Máquina** (`#6d28d9`): todo lo que propuso la IA y nada más. El
  badge de método `IA`, la cola de sugerencias por revisar (`#f5f3ff` sobre borde
  `#ddd6fe`) y el panel de Aprendizaje. Es el color de una afirmación que todavía
  no ha sido aprobada por una persona.
- **Ámbar de Agrupación** (`#b45309` sobre `#fef3c7`): la etiqueta de agrupación
  1:N / N:1 y el conteo de partidas sin conciliar. Marca "requiere tu atención",
  distinto de "está mal".
- **Rojo de Descuadre** (`#dc2626`): montos negativos, diferencia de cuadre
  distinta de cero, y errores de acción (sobre `#fef2f2`). Es el único color de
  falla; no se usa para énfasis.

### Neutral

- **Tinta** (`#171717`): texto principal y **el botón de acción primario**. Que
  el botón primario sea negro y no azul es deliberado: el azul ya está ocupado
  marcando el paso vivo, y un negro pleno gana cualquier competencia de jerarquía
  sin sumar un color más.
- **Grafito** (`#404040`) y **Plomo** (`#737373`): texto de campo y texto
  secundario. **Plomo Claro** (`#a3a3a3`): texto terciario, pasos aún no
  alcanzados, ayudas de formato.
- **Línea** (`#e5e5e5`) y **Línea Fuerte** (`#d4d4d4`): borde de tarjeta y borde
  de control/campo respectivamente.
- **Papel** (`#f5f5f5`): el fondo de trabajo de toda el área autenticada.
  **Superficie** (`#ffffff`): toda tarjeta, campo y panel.

### Datos (paleta categórica de gráficos)

Paleta **Okabe-Ito**, validada para daltonismo, usada exclusivamente en los
gráficos de `/reportes`: **Exacta** `#009E73` · **Difusa** `#0072B2` ·
**Sugerido IA** `#CC79A7` · **Sin conciliar** `#D55E00`.

### Named Rules

**La Regla del Color Ganado.** El color aparece cuando algo *pasó*: se emparejó
(azul), cuadró (verde), lo propuso la máquina (violeta), requiere atención
(ámbar), no calza (rojo). Ninguna superficie, borde o texto es de color por
decoración. Prueba: si al quitarle el color a un elemento no se pierde ninguna
información de estado, ese color sobraba.

**La Regla del Método Visible.** El método de cada match (Exacta / Difusa /
IA n% / Manual) está siempre presente como **badge con texto**, nunca solo como
color. Es el compromiso de accesibilidad del producto y también su postura: la
IA muestra su trabajo.

**La Regla de las Dos Encarnaciones.** Un mismo mapeo conceptual vive en dos
paletas que no se mezclan: la **UI** usa la escala semántica (verde/azul/violeta/
neutral en los badges), los **gráficos** usan Okabe-Ito. Nunca uses `#CC79A7` en
un badge ni `#6d28d9` en un gráfico. Si un elemento es ambiguo, decide por su
contenedor: dentro de una tarjeta de gráfico, manda Okabe-Ito.

## Typography

**Display Font:** fuente del sistema (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`)
**Body Font:** la misma
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` (solo identificadores de job)

**Character:** una sola familia, la del sistema operativo del usuario. No hay
webfonts y esa es una **decisión, no una omisión**: el producto se abre para
trabajar, no para ser admirado, y una PyME peruana con conexión modesta no debe
esperar a que cargue una tipografía. Toda la personalidad tipográfica se
construye con peso, escala y `tabular-nums`.

### Hierarchy

- **Display** (800, `clamp(2.25rem, 5vw, 3.75rem)`, 1.05, `-0.03em`): exclusivo
  del H1 de la portada. El único momento de escala expresiva del sistema.
- **Headline** (700, 1.5–1.875rem, 1.2, `-0.025em`): títulos de sección en
  superficies de persuasión y encabezados de página.
- **Title** (600, 1rem, 1.4): el encabezado de toda tarjeta y panel. Es el
  caballo de batalla de la jerarquía en la app.
- **Metric** (700, 1.875rem, `tabular-nums`): la cifra de un KPI o de un
  contador. El número manda; su etiqueta va en Label encima, pequeña y en Plomo.
- **Body** (400, 0.875rem, 1.6): texto de tabla, listas, descripciones. Es el
  cuerpo por defecto de la aplicación.
- **Body-lg** (400, 0.9375rem, 1.6): el cuerpo de las superficies de
  persuasión y lectura (portada), donde el texto se lee en párrafo y no se
  escanea. Ancho máximo de ~65ch.
- **Dense** (400, 0.8125rem, 1.45): filas del par enfrentado y celdas de datos
  donde caben dos líneas por partida. Es el único escalón por debajo de Body y
  existe para que una lista de dos mil filas siga siendo legible.
- **Label** (500, 0.6875rem, `0.05em`, mayúsculas): rótulos de columna del par
  enfrentado (`TUS REGISTROS` / `TU BANCO`). En formularios, la etiqueta de campo
  usa 0.875rem/500 en Grafito, sin mayúsculas.
- **Mono** (400, 0.75rem): únicamente identificadores de job (`rec-2026-07-a8f3`)
  en Plomo Claro. Nunca para cifras.

### Named Rules

**La Regla de la Cifra Alineada.** Todo número que un usuario pueda comparar
verticalmente lleva `tabular-nums`: montos, porcentajes, conteos, saldos. Sin
excepción. Es lo que permite escanear una columna de dos mil montos y ver que uno
no cuadra. La regla se rompe solo en prosa corrida donde el número es narrativo.

**La Regla de la Cifra sin Adorno.** Las cifras nunca llevan color por énfasis,
solo por estado: negativo en Rojo de Descuadre, positivo en Verde de Cuadre,
neutro en Tinta. Un monto grande no se pinta para llamar la atención; se ordena.

## Layout

El área autenticada es un **lienzo de Papel** (`#f5f5f5`) sobre el que flotan
tarjetas blancas; la barra de navegación es blanca con una línea inferior. El
ritmo vertical entre bloques es constante: **24px** (`space-y-6`), con 32px de
respiro de página.

El ancho del contenedor lo dicta la tarea, no una grilla global:

| Superficie | Ancho | Por qué |
|---|---|---|
| Auth (login/registro) | 448px | Un formulario corto, centrado en pantalla completa |
| Configuración | 672px | Lista de campos numéricos, lectura en una columna |
| Wizard | 768px | Un paso a la vez, sin distracción lateral |
| Resultado de conciliación | 896px | Dos paneles enfrentados necesitan aire |
| Shell de la app (resto) | 1024px | Tablas y reportes |
| Portada | 1152px | Hero dividido a media página |

**Densidad y responsive.** El sistema es de una sola columna en móvil y abre a
dos en `lg` (1024px) para los pares estructurales: los dos paneles de revisión,
el gráfico mensual junto a la distribución de métodos, el hero. Los KPI van
`grid-cols-2` en móvil y `lg:grid-cols-4`. Toda tabla vive dentro de un
contenedor con `overflow-x: auto`; la página nunca hace scroll horizontal. Las
listas largas de partidas se contienen en `max-height: 28rem` con scroll propio,
para que el par enfrentado siga viéndose entero.

### Named Rules

**La Regla del Ancho por Tarea.** Antes de crear una pantalla, elige su ancho de
la tabla de arriba según la tarea, no por costumbre. Un ancho nuevo necesita
justificarse por una tarea que ninguna fila existente describe.

## Elevation & Depth

El sistema es **plano y definido por línea**. La profundidad se construye con
tres recursos, en este orden: borde (`1px` de Línea), cambio de superficie
(Papel debajo, Superficie encima) y, solo al final, sombra.

### Shadow Vocabulary

- **Asiento** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): campos, tarjetas de
  shell y botones secundarios. Apenas separa del papel; su función es dar borde
  óptico, no altura.
- **Flotante** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`):
  reservado a la barra pegajosa de conciliación manual, que de verdad se
  superpone al contenido mientras el usuario hace scroll.
- **Héroe** (`box-shadow: 0 25px 50px -12px rgb(23 37 84 / 0.25)`): un solo uso
  en todo el producto — el panel de conciliación de la portada, levantado sobre
  el campo azul. Es un recurso de persuasión, no de aplicación.

### Named Rules

**La Regla de la Sombra Honesta.** Un elemento lleva sombra únicamente si de
verdad flota sobre otro: se superpone al hacer scroll, se levanta de un fondo de
color, o es un overlay. Una tarjeta que simplemente está sobre el papel se define
por su borde. No existen sombras de hover en este sistema; el hover cambia color
de fondo o de borde.

## Shapes

El radio es el vocabulario de forma del sistema y **decrece con el anidamiento**:
contenedor 24px → tarjeta 16px → campo y botón primario 12px → control 8px →
badge 4px. Las pastillas (`9999px`) están reservadas a cosas que cuentan o
etiquetan: el número de paso, las barras de progreso, los chips de estado.

Los bordes son siempre de `1px` y de un solo tono por rol (Línea para tarjetas,
Línea Fuerte para controles). La **única excepción** es la zona de carga:
`2px` punteado, que es la señal universal de "suelta un archivo aquí" y el gesto
de forma más característico del wizard. Al arrastrar, ese borde punteado cambia a
Azul de Marcado sobre fondo `#eff6ff`; al cargarse, la zona se convierte en una
tarjeta sólida de Verde de Cuadre con check.

### Named Rules

**La Regla del Radio Decreciente.** Un elemento nunca tiene un radio mayor o
igual al de su contenedor. Si necesitas una tarjeta dentro de una tarjeta, baja
un escalón (16px → 12px). Un radio que empata con su padre delata un componente
pegado, no compuesto.

## Components

### Buttons

- **Shape:** esquinas de campo (12px) para acciones de página; de control (8px)
  para acciones dentro de una tarjeta o fila.
- **Primary:** Tinta (`#171717`) con texto blanco, `12px 24px`, peso 500.
  Hover a `#262626` con `transition-colors`. Deshabilitado: fondo Línea Fuerte
  (`#d4d4d4`) y `cursor: not-allowed` — se apaga el fondo, nunca la opacidad del
  texto.
- **Excepción de la portada:** su CTA principal es Azul de Marcado, no Tinta.
  Es la única superficie donde el azul es campo de marca comprometido (media
  página) y no marcador de paso, así que el botón se integra a ese campo. La
  excepción vive solo en `/`; dentro de la aplicación el primario siempre es
  Tinta.
- **Secondary / Ghost:** superficie blanca con borde Línea Fuerte y texto
  Grafito; hover a `#fafafa`. Es el "Rechazar", el "Limpiar", el "Cambiar
  archivo".
- **Confirmar:** Verde de Cuadre con texto blanco, solo para "Aceptar" una
  sugerencia de IA. Es la única acción del sistema con botón verde, porque es la
  única que produce una conciliación.
- **Hover / Focus:** todo interactivo lleva `transition-colors`. El foco de
  teclado usa el mismo halo azul que los campos.

### Cards / Containers

- **Corner Style:** 16px las tarjetas de contenido; 24px los contenedores de
  shell (wizard y auth).
- **Background:** Superficie blanca. Cuando una tarjeta representa un estado, su
  fondo pasa al tinte del acento correspondiente al 40–50% de opacidad (cola de
  IA en violeta, archivo cargado en verde, KPI héroe en verde).
- **Shadow Strategy:** Asiento en contenedores de shell; el resto, sin sombra.
- **Border:** `1px` de Línea; `1px` del borde del acento cuando la tarjeta lleva
  tinte de estado.
- **Internal Padding:** 20px las tarjetas de contenido, 24–32px los contenedores
  de shell.

### Inputs / Fields

- **Style:** altura 44px (48px en auth), superficie blanca, borde Línea Fuerte,
  radio de campo (12px), sombra de Asiento, placeholder en Plomo Claro.
- **Focus:** un tratamiento único en todo el producto — borde a `#3b82f6` con
  anillo de 2px en `#bfdbfe`, `outline: none`. No se sustituye por otro.
- **Etiqueta:** siempre visible encima del campo, 0.875rem/500 en Grafito.
  Nunca placeholder-como-etiqueta.

### Navigation

Barra blanca con línea inferior de Línea, contenida a 1024px. Los enlaces son
0.875rem en Plomo con radio de control; el activo se marca con fondo Papel y
texto Tinta en peso 500 — **fondo, no subrayado ni color de acento**, para que el
azul siga significando "paso vivo del wizard". El nombre de la empresa vive a la
derecha, truncado, junto al botón Salir.

### Badges de método

El componente más citado del sistema. Un rectángulo de radio 4px, `2px 6px`,
0.75rem/500, con el tinte 100 del acento como fondo y el tono 700 como texto:
Exacta en verde, Difusa en azul, **IA en violeta** (con el porcentaje de
confianza pegado al texto, `IA 96%`), Manual en neutral. Siempre lleva texto.

### Stepper

Tres pasos numerados en pastillas de 28px unidas por una línea de 1px. El paso
activo y los completados van en Azul de Marcado sobre blanco; los completados
cambian el número por un check. Los pendientes son un borde de 2px en Línea
Fuerte con número en Plomo Claro. El paso activo lleva `aria-current="step"`.

### El Par Enfrentado (componente insignia)

La forma primitiva del producto: dos columnas rotuladas (`Tus registros` /
`Tu banco`) con un vínculo entre ellas. En la portada es un check verde entre dos
filas; en la revisión son dos paneles `lg:grid-cols-2` donde al hacer clic en una
partida conciliada se resaltan **ambos lados** del par en Azul de Marcado. Cada
fila muestra fecha · monto (coloreado por signo) · identificador · glosa
truncada, y su badge de método a la derecha. Las partidas sin conciliar exponen
un checkbox en lugar del badge: seleccionarlas de ambos lados levanta la barra
flotante de conciliación manual.

### Motion

Un solo momento de movimiento orquestado, en la portada: `ci-rise` (10px hacia
arriba con fade, 0.7s), `ci-pop` (escala 0.94 → 1, 0.55s) y `ci-draw` (clip-path
de izquierda a derecha, 0.9s), todos con easing exponencial
`cubic-bezier(0.16, 1, 0.3, 1)` y escalonados de 0.12s entre pares. El estado por
defecto es **visible**: la animación corre solo dentro de
`@media (prefers-reduced-motion: no-preference)`, así que quien pidió menos
movimiento ve la página completa y quieta. En la aplicación no hay animación de
entrada — solo `transition-colors` en lo interactivo.

## Do's and Don'ts

### Do:
- **Do** poner `tabular-nums` en todo número comparable verticalmente: montos, porcentajes, conteos, saldos.
- **Do** definir las superficies por borde de `1px` (Línea `#e5e5e5`) y reservar la sombra para lo que de verdad flota.
- **Do** usar Tinta (`#171717`) para el botón de acción primario, no el azul: el azul ya significa "paso vivo".
- **Do** acompañar todo estado codificado por color con texto o forma — el badge de método siempre lleva su palabra.
- **Do** bajar un escalón de radio al anidar (contenedor 24 → tarjeta 16 → campo 12 → control 8 → badge 4).
- **Do** elegir el ancho de una pantalla nueva de la tabla de Layout, según su tarea.
- **Do** usar Okabe-Ito (`#009E73` / `#0072B2` / `#CC79A7` / `#D55E00`) en gráficos, y la escala semántica en la UI.
- **Do** mantener el estado por defecto visible y envolver toda animación en `prefers-reduced-motion: no-preference`.

### Don't:
- **Don't** parecerse a un **ERP contable de los 2000**: grillas grises densas, bordes biselados, menús anidados, barras de herramientas con iconitos.
- **Don't** parecerse a un **dashboard cripto oscuro**: fondo negro, gradientes neón, verde brillante sobre negro, gráficos con glow.
- **Don't** parecerse a una **landing SaaS genérica**: gradiente violeta-a-cian, blobs de fondo, tarjetas de features con iconitos, badges "Powered by AI".
- **Don't** parecerse a una **hoja de cálculo cruda**: tablas sin jerarquía ni estado visible. Si se ve como el Excel del que el usuario viene huyendo, el producto no justifica su existencia.
- **Don't** introducir webfonts. La fuente del sistema es una decisión de rendimiento y familiaridad.
- **Don't** usar verde para "activo" ni azul para "correcto". Verde es *conciliado*; azul es *dónde estás mirando*.
- **Don't** pintar una superficie de color sin un estado detrás. Si quitar el color no pierde información, sobraba.
- **Don't** mezclar las dos paletas: nunca `#CC79A7` en un badge ni `#6d28d9` en un gráfico.
- **Don't** sustituir el tratamiento de foco (`border #3b82f6` + anillo 2px `#bfdbfe`) por otro, ni eliminarlo con `outline: none` a secas.
- **Don't** añadir sombras de hover. El hover cambia fondo o borde.
