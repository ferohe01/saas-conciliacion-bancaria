/**
 * «Mi archivo tiene 452.605 filas y el panel dice 452.177. ¿Dónde están las
 * otras 428?»
 *
 * La pregunta salió en una demo y no había forma de contestarla desde la
 * aplicación: hubo que abrir el Excel y cruzarlo a mano contra la base para
 * reconstruir una cuenta que el sistema tenía delante. Cada resta era legítima
 * —filas repetidas, comprobantes de otro mes— pero descubrirlas por tu cuenta
 * es lo que convierte un número correcto en un número sospechoso. Y la sospecha
 * no se queda en ese número: contamina todos los demás de la pantalla.
 *
 * Este módulo convierte la foto que se guardó al conciliar
 * (`jobs_conciliacion.origen_partidas`, migración 0043) en una cascada donde
 * **cada resta lleva su explicación** y el total siempre cierra.
 *
 * ⚠️ Es puro y tiene tests. La cuenta que sale de aquí es la que el usuario va a
 * comparar con su Excel: si no cuadrara, el remedio sería peor que la
 * enfermedad.
 */

/** La foto que devuelve `origen_partidas(...)`, ya en camelCase. */
export type OrigenPartidas = {
  /**
   * `cargas` = se pudo acotar a las importaciones que alimentan el período.
   * `empresa` = no hay ninguna registrada (datos anteriores a la 0043) y los
   * conteos son de toda la empresa. La pantalla tiene que decirlo: si no,
   * "fuera del período" mezclaría meses que nadie estaba mirando.
   */
  alcance: "cargas" | "empresa";
  cargas: number;
  archivoFilas: number;
  archivoRepetidas: number;
  archivoInvalidas: number;
  archivoExistentes: number;
  archivoInsertados: number;
  cargados: number;
  fueraPeriodo: number;
  yaCobrados: number;
  otraMoneda: number;
  internos: number;
};

/** Lo que dijo el motor, del `resumen` del job. */
export type ResultadoMotor = {
  internos: number;
  conciliados: number;
};

export type Linea = {
  clave: string;
  etiqueta: string;
  cantidad: number;
  /** `inicio` y `total` son cifras; `resta` es lo que se va por el camino. */
  tipo: "inicio" | "resta" | "total";
  explicacion: string;
  /** Lo que no se pudo atribuir a una causa concreta. Se dice, no se esconde. */
  sinExplicar?: boolean;
};

export type Bloque = {
  clave: string;
  titulo: string;
  lineas: Linea[];
};

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Normaliza la fila que devuelve Postgres. */
export function leerOrigen(fila: Record<string, unknown> | null | undefined): OrigenPartidas | null {
  if (!fila) return null;
  const alcance = fila.alcance === "cargas" ? "cargas" : "empresa";
  return {
    alcance,
    cargas: n(fila.cargas),
    archivoFilas: n(fila.archivo_filas ?? fila.archivoFilas),
    archivoRepetidas: n(fila.archivo_repetidas ?? fila.archivoRepetidas),
    archivoInvalidas: n(fila.archivo_invalidas ?? fila.archivoInvalidas),
    archivoExistentes: n(fila.archivo_existentes ?? fila.archivoExistentes),
    archivoInsertados: n(fila.archivo_insertados ?? fila.archivoInsertados),
    cargados: n(fila.cargados),
    fueraPeriodo: n(fila.fuera_periodo ?? fila.fueraPeriodo),
    yaCobrados: n(fila.ya_cobrados ?? fila.yaCobrados),
    otraMoneda: n(fila.otra_moneda ?? fila.otraMoneda),
    internos: n(fila.internos),
  };
}

/**
 * Añade las restas conocidas y, si no suman lo que tienen que sumar, una línea
 * con el resto.
 *
 * ⚠️ Esa línea de cierre es la pieza importante del módulo. Sin ella, un caso no
 * previsto —comprobantes borrados a mano, dos cargas de las que una se
 * deshizo— produciría una cascada que **no cuadra**, y una explicación que no
 * cuadra es peor que ninguna: convierte una duda concreta en desconfianza
 * general.
 */
function restar(
  lineas: Linea[],
  conocidas: Omit<Linea, "tipo">[],
  desde: number,
  hasta: number,
  etiquetaResto: string,
  explicacionResto: string,
): void {
  let usado = 0;
  for (const c of conocidas) {
    usado += c.cantidad;
    lineas.push({ ...c, tipo: "resta" });
  }
  const resto = desde - hasta - usado;
  if (resto !== 0) {
    lineas.push({
      clave: "resto",
      etiqueta: etiquetaResto,
      cantidad: resto,
      tipo: "resta",
      explicacion: explicacionResto,
      sinExplicar: true,
    });
  }
}

/**
 * La cascada completa: del archivo que subió el usuario a lo que quedó sin
 * conciliar.
 *
 * `origen` puede ser `null` (conciliaciones anteriores a la 0043): entonces se
 * devuelve solo el último bloque, que sale del resultado del motor y siempre
 * está disponible. Inventar los otros dos sería peor que no tenerlos.
 */
export function cascadaPartidas(
  origen: OrigenPartidas | null,
  motor: ResultadoMotor | null,
): Bloque[] {
  const bloques: Bloque[] = [];

  if (origen && origen.alcance === "cargas" && origen.archivoFilas > 0) {
    const lineas: Linea[] = [
      {
        clave: "archivo",
        etiqueta:
          origen.cargas === 1
            ? "Filas del archivo que subiste"
            : `Filas de las ${origen.cargas} cargas de este período`,
        cantidad: origen.archivoFilas,
        tipo: "inicio",
        explicacion:
          "Todo lo que el sistema leyó del archivo, incluidas las filas que " +
          "después se descartaron.",
      },
    ];
    restar(
      lineas,
      [
        {
          clave: "repetidas",
          etiqueta: "Repetidas dentro del archivo",
          cantidad: origen.archivoRepetidas,
          explicacion:
            "El mismo número de documento aparecía dos veces. Se conservó la " +
            "primera: si fueran dos cobros distintos, necesitan números distintos.",
        },
        {
          clave: "invalidas",
          etiqueta: "Sin fecha, importe o tipo",
          cantidad: origen.archivoInvalidas,
          explicacion:
            "Una fila sin alguno de esos tres datos no es un comprobante " +
            "incompleto: no es un comprobante.",
        },
        {
          clave: "existentes",
          etiqueta: "Ya estaban cargadas",
          cantidad: origen.archivoExistentes,
          explicacion:
            "Mismo tipo y mismo número que un comprobante ya cargado. No se " +
            "actualiza: puede tener cobros aplicados y reescribirlo dejaría el " +
            "saldo mintiendo.",
        },
      ],
      origen.archivoFilas,
      origen.archivoInsertados,
      "Otras filas no cargadas",
      "No se pudo atribuir a ninguna de las causas de arriba.",
    );
    lineas.push({
      clave: "insertados",
      etiqueta: "Comprobantes guardados",
      cantidad: origen.archivoInsertados,
      tipo: "total",
      explicacion: "Lo que quedó en el sistema tras esas cargas.",
    });
    bloques.push({
      clave: "archivo",
      titulo: "Del archivo a tus comprobantes",
      lineas,
    });
  }

  if (origen) {
    // ⚠️ El bloque arranca en lo que se INSERTÓ, no en lo que hay hoy: entre las
    // dos cosas puede haber un borrado, y si el inicio ya lo tuviera descontado
    // la línea que lo explica descuadraría el bloque. Empezar por el número que
    // el bloque anterior dejó como total es además lo que encadena la cascada.
    const conArchivo = origen.alcance === "cargas" && origen.archivoFilas > 0;
    const inicio = conArchivo ? origen.archivoInsertados : origen.cargados;

    const lineas: Linea[] = [
      {
        clave: "cargados",
        etiqueta:
          origen.alcance === "cargas"
            ? "Comprobantes de estas cargas"
            : "Comprobantes cargados",
        cantidad: inicio,
        tipo: "inicio",
        explicacion:
          origen.alcance === "cargas"
            ? "Los que entraron al sistema desde las cargas de este período."
            : "Todos los de la empresa: esta conciliación se corrió antes de que " +
              "se registrara qué carga trajo cada comprobante.",
      },
    ];

    const conocidas: Omit<Linea, "tipo">[] = [];
    // Entre lo que se insertó y lo que hay puede haber un borrado posterior.
    if (inicio !== origen.cargados) {
      conocidas.push({
        clave: "borrados",
        etiqueta: "Se quitaron después de cargarlas",
        cantidad: inicio - origen.cargados,
        explicacion:
          "Alguien deshizo una carga o borró comprobantes entre la importación " +
          "y esta conciliación.",
      });
    }
    restar(
      lineas,
      [
        ...conocidas,
        {
          clave: "fuera",
          etiqueta: "De fechas fuera del período",
          cantidad: origen.fueraPeriodo,
          explicacion:
            "Están cargados y siguen ahí, pero su fecha cae fuera del rango que " +
            "elegiste. Entran en cuanto concilies el período al que pertenecen.",
        },
        {
          clave: "cobrados",
          etiqueta: "Ya cobrados o anulados",
          cantidad: origen.yaCobrados,
          explicacion:
            "Lo que ya se saldó no vuelve a la mesa: ofrecerlo otra vez llevaría " +
            "a descontar su importe dos veces desde otra cuenta.",
        },
        {
          clave: "moneda",
          etiqueta: "En otra moneda que la cuenta",
          cantidad: origen.otraMoneda,
          explicacion:
            "No se cruzan monedas: una factura de 200 USD y un depósito de " +
            "S/ 200 tienen el mismo número y no son lo mismo.",
        },
      ],
      inicio,
      origen.internos,
      "Otros comprobantes fuera de esta corrida",
      "No se pudo atribuir a ninguna de las causas de arriba.",
    );
    lineas.push({
      clave: "internos",
      etiqueta: "Registros internos a conciliar",
      cantidad: origen.internos,
      tipo: "total",
      explicacion: "Lo que el motor recibió de tu lado.",
    });
    bloques.push({
      clave: "seleccion",
      titulo: "De tus comprobantes a esta conciliación",
      lineas,
    });
  }

  if (motor) {
    const lineas: Linea[] = [
      {
        clave: "internos",
        etiqueta: "Registros internos a conciliar",
        cantidad: motor.internos,
        tipo: "inicio",
        explicacion: "Las partidas que entraron al motor por tu lado.",
      },
    ];
    // Si la foto y el motor no dicen lo mismo, se enseña la diferencia en vez
    // de elegir cuál de los dos números creerse.
    if (origen && origen.internos !== motor.internos) {
      lineas.push({
        clave: "descuadre",
        etiqueta: "Diferencia con el recuento previo",
        cantidad: origen.internos - motor.internos,
        tipo: "resta",
        explicacion:
          "El recuento hecho al preparar la conciliación y el que informó el " +
          "motor no coinciden. Merece una mirada.",
        sinExplicar: true,
      });
    }
    lineas.push({
      clave: "conciliados",
      etiqueta: "Conciliados con el banco",
      cantidad: motor.conciliados,
      tipo: "resta",
      explicacion: "Emparejados con un movimiento del extracto.",
    });
    lineas.push({
      clave: "sin_conciliar",
      etiqueta: "Sin conciliar",
      cantidad: motor.internos - motor.conciliados,
      tipo: "total",
      explicacion:
        "No se encontró movimiento que les corresponda. Cada uno puede " +
        "preguntarse «¿por qué?» en la pantalla de la conciliación.",
    });
    bloques.push({
      clave: "motor",
      titulo: "De las partidas a lo conciliado",
      lineas,
    });
  }

  return bloques;
}

/**
 * Una frase para el panel: cuántas partidas de tu archivo no acabaron
 * conciliadas, y en qué se fueron.
 *
 * Devuelve `null` cuando no hay nada que explicar —todo lo cargado entró y todo
 * se concilió—, porque un aviso que sale siempre se aprende a despachar sin
 * leer.
 */
export function resumenDiferencia(
  origen: OrigenPartidas | null,
  motor: ResultadoMotor | null,
): { total: number; base: string; frase: string } | null {
  if (!origen || !motor) return null;
  const conArchivo = origen.alcance === "cargas" && origen.archivoFilas > 0;
  const partida = conArchivo ? origen.archivoFilas : origen.cargados;
  const total = partida - motor.conciliados;
  if (total <= 0) return null;

  // ⚠️ Las causas son EXACTAMENTE las de la cascada, con sus mismas palabras. La
  // primera versión metía en un solo saco «no llegaron a cargarse» todo lo que
  // no estaba hoy en la base, y eso dijo «1.348 no llegaron a cargarse» sobre
  // una empresa donde 282 no llegaron y **1.066 sí llegaron y se borraron
  // después**. La frase contradecía a la tabla que tenía justo debajo.
  const causas: { n: number; texto: string }[] = [
    { n: origen.archivoRepetidas, texto: "venían repetidas en el archivo" },
    { n: origen.archivoInvalidas, texto: "no traían fecha, importe o tipo" },
    { n: origen.archivoExistentes, texto: "ya estaban cargadas de antes" },
    {
      n: conArchivo ? Math.max(0, origen.archivoInsertados - origen.cargados) : 0,
      texto: "se quitaron después de cargarlas",
    },
    { n: origen.fueraPeriodo, texto: "son de fechas fuera del período" },
    { n: origen.yaCobrados, texto: "ya estaban cobradas o anuladas" },
    { n: origen.otraMoneda, texto: "están en otra moneda" },
    {
      n: motor.internos - motor.conciliados,
      texto: "entraron pero no encontraron pareja",
    },
  ].filter((c) => c.n > 0);

  causas.sort((a, b) => b.n - a.n);
  const dichas = causas.slice(0, 3).map((c) => `${fmt(c.n)} ${c.texto}`);
  const resto = causas.length - dichas.length;
  if (resto > 0) dichas.push(`${resto} causa${resto === 1 ? "" : "s"} más`);

  return {
    total,
    // ⚠️ Se nombra la BASE. Con ocho cargas del mismo archivo, «partidas de tu
    // archivo» es falso: el archivo tiene 236 filas y la suma de lo leído son
    // 1.584. Decir de dónde sale el número es lo que permite reconocerlo.
    base: conArchivo
      ? origen.cargas === 1
        ? "de tu archivo"
        : `de las ${fmt(origen.cargas)} cargas de este período`
      : "de tus comprobantes",
    frase:
      dichas.length > 0
        ? `${dichas.slice(0, -1).join(", ")}${dichas.length > 1 ? " y " : ""}${dichas.at(-1)}.`
        : "El detalle está en la cascada.",
  };
}

const fmt = (x: number) => x.toLocaleString("es-PE");
