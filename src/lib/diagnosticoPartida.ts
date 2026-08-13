import { palabras } from "@/lib/precedentes";
import { normRef } from "@/lib/normalizacion/referencia";

/**
 * ¿Por qué no se concilió esta partida?
 *
 * ── El problema ────────────────────────────────────────────────────────────
 *
 * `04_ensamblar.js` etiqueta cada pendiente por su signo:
 *
 *     sugerencia: it.monto >= 0 ? 'Posible depósito en tránsito' : 'Posible cheque no cobrado'
 *
 * Eso dice lo mismo de las 4.382 partidas del residuo. El usuario ve "sin
 * conciliar" y no tiene por dónde empezar — y el sistema **sí sabe** por qué:
 * están los montos, las referencias, las fechas y qué movimiento se llevó cada
 * par. Nadie los había cruzado para esa fila concreta.
 *
 * ── ⚠️ Qué se afirma, y qué NO ──────────────────────────────────────────────
 *
 * El motor vive en `n8n/*.js` y es fuente única: no se puede importar, no entra
 * en el typecheck y no se ejecuta en los tests. Reimplementar aquí sus
 * criterios crearía un segundo motor que diverge en silencio — el riesgo que la
 * 0029 documenta con `ref_norm`.
 *
 * Por eso este diagnóstico **no dice "el motor lo rechazó porque X"**. Dice
 * *"lo más parecido que hay en tu extracto es esto, y se diferencia en esto"*:
 * una observación sobre los datos, no una reconstrucción del motor. No puede
 * divergir de él porque no está hablando de él.
 *
 * Las dos únicas excepciones son hechos **consultables**, no reconstrucciones:
 * `ya_emparejado` (el movimiento está en `matches_conciliacion` con otro
 * comprobante) y `referencia_contradice` (las dos referencias existen y
 * difieren).
 *
 * ── Por qué es TypeScript y no SQL ─────────────────────────────────────────
 *
 * Las partidas viven en dos sitios según el tamaño del job: en tablas
 * (`comprobantes` / `movimientos_extracto`) o dentro del JSONB
 * `payload_entrada`. Con la decisión en SQL harían falta dos implementaciones
 * —otra vez el problema de los dos lenguajes—. Aquí SQL solo **busca**
 * (`candidatos_partida`, migración 0038), que es lo que hace bien, y decidir lo
 * hace una única función pura con tests.
 */

/** Una partida sin conciliar, de cualquiera de los dos lados. */
export type PartidaSuelta = {
  id: string;
  fecha: string;
  monto: number;
  /** Contraparte (interno) o glosa (banco). */
  texto: string;
  referencia: string;
};

/** Una partida del lado contrario que podría haberle correspondido. */
export type CandidatoPartida = PartidaSuelta & {
  /**
   * Con qué partida quedó emparejada, si lo está. `null` = libre.
   *
   * Es el dato que hace posible el diagnóstico más valioso y hoy invisible:
   * "había un movimiento que casaba, pero se lo llevó otra factura".
   */
  ocupadoPor: string | null;
};

export type CodigoDiagnostico =
  | "ya_emparejado"
  | "referencia_contradice"
  | "monto_diferente"
  | "fuera_de_ventana"
  | "signo_contrario"
  | "agrupacion_posible"
  | "sin_candidato";

export type Diagnostico = {
  codigo: CodigoDiagnostico;
  titulo: string;
  detalle: string;
  /** Qué puede hacer el usuario desde esta pantalla. `null` si no hay nada. */
  accion: string | null;
  /** Las partidas concretas en que se apoya. Sin esto no es verificable. */
  evidencia: CandidatoPartida[];
};

export type ConfigDiagnostico = {
  tolerancia_dias: number;
  ventana_ia_dias: number;
  max_combinacion: number;
};

const MS_DIA = 86_400_000;

/**
 * Misma normalización que `normRef` en n8n/01_exacta.js y que `ref_norm`.
 *
 * Se re-exporta —en vez de definirse aquí, como estaba— para que el diagnóstico
 * no pueda contestar «no coincide la referencia» sobre dos códigos que el motor
 * SÍ considera el mismo. Fuente única en `lib/normalizacion/referencia.ts`.
 */
export { normRef };

const cent = (m: number) => Math.round(m * 100);
const dias = (a: string, b: string) =>
  Math.abs((Date.parse(a) - Date.parse(b)) / MS_DIA);

function comparten(a: string, b: string): boolean {
  const pa = new Set(palabras(a));
  if (pa.size === 0) return false;
  return palabras(b).some((p) => pa.has(p));
}

const fmt = (n: number) =>
  n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dia = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
};

/** Cómo referirse a una partida en el texto: "S/ 99.00 del 03/07/2026". */
function describir(p: PartidaSuelta): string {
  return `${fmt(p.monto)} del ${dia(p.fecha)}`;
}

/**
 * Diagnostica una partida contra los candidatos del lado contrario.
 *
 * `hermanas` son otras partidas pendientes del MISMO lado, para detectar
 * agrupaciones 1:N. Puede venir vacío: entonces esa comprobación no se hace y
 * no se afirma nada sobre ella.
 */
export function diagnosticarPartida(
  partida: PartidaSuelta,
  candidatos: CandidatoPartida[],
  config: ConfigDiagnostico,
  hermanas: PartidaSuelta[] = [],
): Diagnostico {
  const refP = normRef(partida.referencia);
  const cP = cent(partida.monto);

  const rasgos = candidatos.map((c) => {
    const refC = normRef(c.referencia);
    return {
      c,
      mismoImporte: cent(c.monto) === cP,
      mismoAbs: Math.abs(cent(c.monto)) === Math.abs(cP),
      difMonto: Math.abs(c.monto - partida.monto),
      d: dias(partida.fecha, c.fecha),
      mismaRef: refP !== "" && refP === refC,
      refContradice: refP !== "" && refC !== "" && refP !== refC,
      nombre: comparten(partida.texto, c.texto),
    };
  });

  // ── 1. Se lo llevó otra partida ─────────────────────────────────────────
  //
  // Va primero porque es correcto, invisible y es la primera pregunta de quien
  // mira una fila concreta. La capa exacta numera los dos lados y empareja por
  // número ("toma el siguiente libre"): con cientos de recibos idénticos, que a
  // ESTA factura le tocara quedarse fuera es inexplicable desde la pantalla.
  const robado = rasgos.find(
    (r) => r.c.ocupadoPor !== null && r.mismoImporte && (r.mismaRef || r.d === 0),
  );
  if (robado) {
    return {
      codigo: "ya_emparejado",
      titulo: "Había un movimiento que casaba, pero se lo llevó otra partida",
      detalle:
        `El movimiento de ${describir(robado.c)} coincide en importe` +
        (robado.mismaRef ? " y referencia" : " y fecha") +
        `, pero ya quedó emparejado con ${robado.c.ocupadoPor}. Cuando varias ` +
        "partidas comparten importe y referencia, cada movimiento se asigna a " +
        "una sola y alguna se queda fuera.",
      accion:
        "Si el emparejamiento correcto era con esta, deshaz el otro par y " +
        "concilia a mano.",
      evidencia: [robado.c],
    };
  }

  // ── 2. Las referencias se contradicen ───────────────────────────────────
  //
  // El motor descarta ese par DELIBERADAMENTE —es la guarda que evitó 541 pares
  // falsos marcados `auto`— y desde la pantalla parece un olvido.
  const contradice = rasgos.find(
    (r) => r.c.ocupadoPor === null && r.mismoImporte && r.d === 0 && r.refContradice,
  );
  if (contradice) {
    return {
      codigo: "referencia_contradice",
      titulo: "Coincide en importe y fecha, pero es otra operación",
      detalle:
        `El movimiento de ${describir(contradice.c)} tiene el mismo importe y ` +
        `la misma fecha, pero su referencia es «${contradice.c.referencia}» y ` +
        `la de esta partida es «${partida.referencia}». No se emparejan a ` +
        "propósito: dos referencias distintas son dos operaciones distintas, " +
        "por mucho que el importe coincida.",
      accion:
        "Si en realidad son la misma operación, corrige la referencia o " +
        "concilia a mano.",
      evidencia: [contradice.c],
    };
  }

  // ── 3. El importe no cuadra ─────────────────────────────────────────────
  const porImporte = rasgos
    .filter(
      (r) =>
        r.c.ocupadoPor === null &&
        !r.mismoImporte &&
        (r.mismaRef || (r.nombre && r.d <= config.tolerancia_dias)),
    )
    .sort((a, b) => a.difMonto - b.difMonto)[0];
  if (porImporte) {
    return {
      codigo: "monto_diferente",
      titulo: `Hay un movimiento que corresponde, con ${fmt(porImporte.difMonto)} de diferencia`,
      detalle:
        `El movimiento de ${describir(porImporte.c)} coincide en ` +
        (porImporte.mismaRef ? "referencia" : "nombre y fecha") +
        `, pero el importe difiere en ${fmt(porImporte.difMonto)}. Suele ser ` +
        "una comisión bancaria, un cobro parcial o una diferencia de cambio.",
      accion:
        "Si es la misma operación, concílialos a mano: la diferencia quedará " +
        "registrada en el cuadre.",
      evidencia: [porImporte.c],
    };
  }

  // ── 4. Está, pero demasiado lejos en el tiempo ──────────────────────────
  const lejos = rasgos
    .filter(
      (r) =>
        r.c.ocupadoPor === null &&
        r.mismoImporte &&
        r.nombre &&
        r.d > config.ventana_ia_dias,
    )
    .sort((a, b) => a.d - b.d)[0];
  if (lejos) {
    return {
      codigo: "fuera_de_ventana",
      titulo: `Coincide, pero con ${Math.round(lejos.d)} días de diferencia`,
      detalle:
        `El movimiento de ${describir(lejos.c)} tiene el mismo importe y un ` +
        `nombre parecido, pero está a ${Math.round(lejos.d)} días — por encima ` +
        `de los ${config.ventana_ia_dias} que se consideran. Fuera de esa ` +
        "ventana no se empareja solo, porque a esa distancia dos importes " +
        "iguales suelen ser operaciones distintas.",
      accion:
        "Si es el mismo cobro, concílialo a mano. Si se repite, amplía la " +
        "ventana en Configuración.",
      evidencia: [lejos.c],
    };
  }

  // ── 5. El mismo importe, pero al revés ──────────────────────────────────
  const alReves = rasgos.find(
    (r) => r.c.ocupadoPor === null && !r.mismoImporte && r.mismoAbs,
  );
  if (alReves) {
    return {
      codigo: "signo_contrario",
      titulo: "Hay un movimiento por el mismo importe, pero en sentido contrario",
      detalle:
        `El movimiento de ${describir(alReves.c)} tiene el mismo importe con ` +
        "el signo cambiado: uno es dinero que entra y el otro dinero que sale. " +
        "No se emparejan porque no son la misma operación — puede ser una " +
        "devolución, o un tipo de comprobante mal indicado al cargarlo.",
      accion:
        "Comprueba si el comprobante está registrado como cobranza cuando " +
        "debería ser pago, o al revés.",
      evidencia: [alReves.c],
    };
  }

  // ── 6. Sumada con otras, cuadra ─────────────────────────────────────────
  const grupo = buscarAgrupacion(partida, rasgos.map((r) => r.c), hermanas, config);
  if (grupo) {
    return grupo;
  }

  // ── 7. No hay nada parecido ─────────────────────────────────────────────
  //
  // Es el resultado MÁS COMÚN y no es un fallo: en una cuenta recaudadora la
  // mayoría de estas partidas se cobraron por otro banco o simplemente no se
  // han cobrado. Se muestra lo más cercano encontrado para que se vea que se
  // buscó — un "no encontré nada" a secas parece que el sistema no miró.
  const cercano = [...rasgos].sort((a, b) => a.difMonto - b.difMonto)[0];
  return {
    codigo: "sin_candidato",
    titulo: "No aparece nada parecido en el extracto",
    detalle:
      "No hay ningún movimiento del banco que coincida en importe, referencia " +
      "ni nombre con esta partida. Lo más habitual es que el cobro todavía no " +
      "haya entrado, que se haya cobrado por otra cuenta, o que el extracto no " +
      "cubra la fecha en que llegó." +
      (cercano
        ? ` Lo más cercano que hay es un movimiento de ${describir(cercano.c)}.`
        : ""),
    accion:
      "Si no debería estar aquí, déjala pendiente: entra al cuadre como " +
      "partida en tránsito.",
    evidencia: cercano ? [cercano.c] : [],
  };
}

/**
 * ¿Esta partida, sumada con otras del mismo lado, cuadra con un movimiento?
 *
 * ⚠️ Solo se combinan hermanas que **comparten identidad** con la partida
 * (misma referencia o alguna palabra del nombre). Sin ese prefiltro, un
 * subset-sum empareja partidas sin relación cuya suma cuadra por azar y el
 * resultado parece correcto — es la misma lección que la capa de agrupación de
 * n8n aprendió por las malas.
 */
function buscarAgrupacion(
  partida: PartidaSuelta,
  candidatos: CandidatoPartida[],
  hermanas: PartidaSuelta[],
  config: ConfigDiagnostico,
): Diagnostico | null {
  const libres = candidatos.filter((c) => c.ocupadoPor === null);
  if (libres.length === 0 || hermanas.length === 0) return null;

  const refP = normRef(partida.referencia);
  const afines = hermanas
    .filter((hb) => hb.id !== partida.id)
    .filter((hb) => {
      const refH = normRef(hb.referencia);
      if (refP !== "" && refP === refH) return true;
      return comparten(partida.texto, hb.texto);
    })
    // Acotado: el coste de un subset-sum crece muy rápido y esto corre al
    // pinchar una fila, no en lote.
    .slice(0, 20);

  if (afines.length === 0) return null;

  const objetivo = new Map<number, CandidatoPartida>();
  for (const c of libres) objetivo.set(cent(c.monto), c);

  const maxExtra = Math.max(1, config.max_combinacion - 1);
  const base = cent(partida.monto);

  // Combinaciones de 1..maxExtra hermanas, por tamaño creciente: el grupo más
  // pequeño que cuadre es el más creíble.
  for (let k = 1; k <= maxExtra; k++) {
    const encontrado = combinar(afines, k, (grupo) => {
      const suma = grupo.reduce((a, x) => a + cent(x.monto), base);
      const mov = objetivo.get(suma);
      return mov ? { mov, grupo } : null;
    });
    if (encontrado) {
      const { mov, grupo } = encontrado;
      const cuantas = grupo.length + 1;
      return {
        codigo: "agrupacion_posible",
        titulo: `Junto con otras ${grupo.length}, suma un movimiento del extracto`,
        detalle:
          `Esta partida y ${grupo.length === 1 ? "otra" : `otras ${grupo.length}`} ` +
          `suman exactamente ${fmt(mov.monto)}, que es el movimiento del ` +
          `${dia(mov.fecha)}. Es el caso típico de un cliente que paga varios ` +
          "documentos en un solo depósito.",
        accion: `Marca las ${cuantas} partidas y el movimiento, y concilia a mano.`,
        evidencia: [mov],
      };
    }
  }

  return null;
}

/** Recorre combinaciones de tamaño `k` y devuelve el primer resultado no nulo. */
function combinar<T, R>(
  items: T[],
  k: number,
  probar: (grupo: T[]) => R | null,
): R | null {
  const grupo: T[] = [];
  function paso(desde: number): R | null {
    if (grupo.length === k) return probar(grupo);
    for (let i = desde; i < items.length; i++) {
      grupo.push(items[i]!);
      const r = paso(i + 1);
      grupo.pop();
      if (r) return r;
    }
    return null;
  }
  return paso(0);
}
