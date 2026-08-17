/**
 * CUÁNDO TE PAGAN DE VERDAD — fase 3a del flujo de caja proyectado.
 *
 * Mide, no proyecta. Cada cifra sale de comparar el vencimiento de una factura
 * con la fecha del movimiento del extracto que la pagó, en conciliaciones que la
 * empresa ya aprobó. Es un hecho consultable, no una estimación.
 *
 * ⚠️ Es también lo que hará creíble la curva de la fase 3b: una hoja de cálculo
 * asume que la factura a 30 días se cobra el día 30; aquí se sabe que este
 * cliente paga a 12 y aquel a 41 **porque se ha visto ocurrir**.
 *
 * SQL busca (`dias_pago_contraparte`, 0052), TypeScript decide: qué mediana se
 * usa, cuándo hay historial suficiente y cómo se dice.
 */

/** Una fila de `dias_pago_contraparte()`, en camelCase. */
export type ObservacionPago = {
  nivel: "contraparte" | "empresa" | "no_calculado";
  contraparte: string | null;
  ruc: string | null;
  tipo: "cobranza" | "pago";
  moneda: string;
  observaciones: number;
  diasMediana: number | null;
  diasMin: number | null;
  diasMax: number | null;
  ultimoPago: string | null;
  montoTotal: number;
};

/**
 * Cuántas facturas hacen falta para hablar de la costumbre de alguien.
 *
 * ⚠️ Con una sola no hay costumbre que medir, y con dos una casualidad manda
 * sobre la mediana. Tres es poco y es lo mínimo defendible; por debajo se dice
 * que no se sabe, que es una respuesta mejor que un número inventado.
 */
export const MIN_OBSERVACIONES = 3;

/** De dónde sale el número de días que se usará para proyectar. */
export type FuenteDias = "contraparte" | "empresa" | "vencimiento";

export type Calibrado = {
  contraparte: string;
  ruc: string | null;
  tipo: "cobranza" | "pago";
  moneda: string;
  /** Los días que se usarán al proyectar. */
  dias: number;
  fuente: FuenteDias;
  /** Cuántas facturas suyas se midieron. Cero si la fuente no es la contraparte. */
  observaciones: number;
  diasMin: number | null;
  diasMax: number | null;
  ultimoPago: string | null;
  montoTotal: number;
  /** Cuántas se midieron de esta contraparte, aunque no lleguen al mínimo. */
  observacionesPropias: number;
};

export type Puntualidad = "antes" | "puntual" | "algo_tarde" | "tarde" | "muy_tarde";

/**
 * Cómo se lee un número de días.
 *
 * Los cortes no son estadística, son gestión: hasta 3 días es ruido de proceso
 * (fines de semana, el banco acredita al día siguiente); a partir de 45 el
 * cliente está financiándose contigo.
 */
export function puntualidad(dias: number): Puntualidad {
  if (dias < -1) return "antes";
  if (dias <= 3) return "puntual";
  if (dias <= 15) return "algo_tarde";
  if (dias <= 45) return "tarde";
  return "muy_tarde";
}

export const ETIQUETA_PUNTUALIDAD: Record<Puntualidad, string> = {
  antes: "Paga antes de vencer",
  puntual: "Paga puntual",
  algo_tarde: "Se retrasa poco",
  tarde: "Se retrasa",
  muy_tarde: "Se retrasa mucho",
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Convierte las observaciones en el calibrado que usará la proyección.
 *
 * La cadena de respaldo es: mediana de la contraparte → mediana de la empresa →
 * el vencimiento tal cual (0 días). **Nunca se salta un escalón en silencio**:
 * `fuente` dice cuál se aplicó y la pantalla lo enseña.
 */
export function calibrar(filas: readonly ObservacionPago[]): Calibrado[] {
  const empresa = new Map<string, ObservacionPago>();
  for (const f of filas) {
    if (f.nivel === "empresa") empresa.set(`${f.tipo}|${f.moneda}`, f);
  }

  return filas
    .filter((f) => f.nivel === "contraparte" && f.contraparte != null)
    .map((f) => {
      const propias = f.observaciones;
      const suficientes = propias >= MIN_OBSERVACIONES && f.diasMediana != null;
      const global = empresa.get(`${f.tipo}|${f.moneda}`);

      let dias = 0;
      let fuente: FuenteDias = "vencimiento";
      let observaciones = 0;

      if (suficientes) {
        dias = r1(f.diasMediana!);
        fuente = "contraparte";
        observaciones = propias;
      } else if (global?.diasMediana != null && global.observaciones >= MIN_OBSERVACIONES) {
        dias = r1(global.diasMediana);
        fuente = "empresa";
        observaciones = global.observaciones;
      }

      return {
        contraparte: f.contraparte!,
        ruc: f.ruc,
        tipo: f.tipo,
        moneda: f.moneda,
        dias,
        fuente,
        observaciones,
        // ⚠️ El rango se enseña SOLO cuando la contraparte tiene historial
        // propio: pegarle el mínimo y el máximo de toda la empresa a un cliente
        // del que no sabemos nada sería atribuirle un comportamiento ajeno.
        diasMin: suficientes ? f.diasMin : null,
        diasMax: suficientes ? f.diasMax : null,
        ultimoPago: f.ultimoPago,
        montoTotal: f.montoTotal,
        observacionesPropias: propias,
      };
    });
}

/**
 * Cómo se dice, en una frase.
 *
 * ⚠️⚠️ «Paga puntual» y «no lo sabemos» dan los dos 0 días y NO son lo mismo.
 * Es la distinción que este módulo no puede perder: uno es un hecho medido y el
 * otro es la ausencia de datos, y llevan a decisiones opuestas —al primero le
 * das crédito, al segundo lo vigilas—. Por eso la frase nunca es solo el número.
 */
export function frase(c: Calibrado): string {
  const doc = (n: number) => `${n} ${n === 1 ? "documento" : "documentos"}`;

  if (c.fuente === "contraparte") {
    const cuando =
      c.dias === 0
        ? "paga el día de su vencimiento"
        : c.dias < 0
          ? `paga ${Math.abs(c.dias)} días antes de vencer`
          : `paga a ${c.dias} días de su vencimiento`;
    const rango =
      c.diasMin != null && c.diasMax != null && c.diasMin !== c.diasMax
        ? ` (entre ${c.diasMin} y ${c.diasMax})`
        : "";
    return `${cuando}${rango} · medido en ${doc(c.observaciones)}`;
  }

  if (c.fuente === "empresa") {
    const suyas =
      c.observacionesPropias > 0
        ? `solo ${doc(c.observacionesPropias)} suyos, no bastan`
        : "sin historial propio";
    return `${suyas} · se usa la media de tus cobros: ${c.dias} días`;
  }

  return "sin historial: se usará el vencimiento tal cual";
}

/** Los que peor pagan primero: es el orden en el que hay que actuar. */
export function ordenarPorRetraso(cs: readonly Calibrado[]): Calibrado[] {
  return [...cs].sort((a, b) => {
    // Los medidos van antes que los que no lo están: un 30 real pesa más que
    // un 30 heredado de la media de la empresa.
    if (a.fuente !== b.fuente) {
      const peso = { contraparte: 0, empresa: 1, vencimiento: 2 } as const;
      return peso[a.fuente] - peso[b.fuente];
    }
    if (b.dias !== a.dias) return b.dias - a.dias;
    return b.montoTotal - a.montoTotal;
  });
}

/** La mediana de la empresa para un tipo y moneda, si la hay. */
export function medianaEmpresa(
  filas: readonly ObservacionPago[],
  tipo: "cobranza" | "pago",
  moneda: string,
): { dias: number; observaciones: number } | null {
  const f = filas.find(
    (x) => x.nivel === "empresa" && x.tipo === tipo && x.moneda === moneda,
  );
  if (!f || f.diasMediana == null || f.observaciones < MIN_OBSERVACIONES) return null;
  return { dias: r1(f.diasMediana), observaciones: f.observaciones };
}

/**
 * ¿Se pudo calcular?
 *
 * ⚠️ `no_calculado` NO es «no hay historial»: es «hay demasiado y no se
 * intentó». Confundirlos diría que una empresa con medio millón de pares
 * conciliados no tiene datos.
 */
export function noCalculado(filas: readonly ObservacionPago[]): number | null {
  const f = filas.find((x) => x.nivel === "no_calculado");
  return f ? f.observaciones : null;
}
