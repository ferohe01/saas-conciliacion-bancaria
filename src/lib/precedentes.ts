/**
 * "Esto ya lo resolviste una vez."
 *
 * Al revisar una sugerencia, un score de confianza no dice nada que ayude a
 * decidir: 0.82 no es un argumento. Un caso concreto que la propia empresa ya
 * resolvió, sí — «en marzo aceptaste una comisión de S/12 con este mismo
 * cliente». Convierte un número opaco en un recuerdo reconocible.
 *
 * ⚠️ HONESTIDAD DE LO QUE SE AFIRMA. Esto NO dice "la IA propuso esto por aquel
 * caso": el modelo nunca informa de qué ejemplo pesó en su decisión, y fabricar
 * esa causa sería inventarle un razonamiento. Lo que se afirma es más modesto y
 * verificable: *este caso se parece a uno que ya decidiste*. La búsqueda es
 * determinística y ocurre en la app, no en el LLM.
 *
 * Puro y con tests.
 */

export type CasoResuelto = {
  /** Qué decidió la persona sobre aquel par. */
  decision: "aceptado" | "rechazado";
  fecha: string | null;
  contraparte: string;
  glosa: string;
  montoInterno: number;
  montoBanco: number;
  /** interno − banco, con signo. */
  diferencia: number;
  categoria: string | null;
};

export type CasoNuevo = {
  contraparte: string;
  glosa: string;
  montoInterno: number;
  montoBanco: number;
  diferencia: number;
  categoria: string | null;
};

export type Precedente = {
  caso: CasoResuelto;
  /** Por qué se parece, en lenguaje de usuario. */
  motivo: string;
};

const VACIAS = new Set([
  "sac", "srl", "eirl", "sa", "s.a.", "s.a.c.", "de", "del", "la", "las",
  "el", "los", "y", "e", "cia", "compania", "compañia", "peru", "the",
  "transferencia", "deposito", "abono", "pago", "cargo",
]);

/** Palabras significativas de un nombre, sin tildes ni ruido societario. */
export function palabras(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !VACIAS.has(p));
}

/** ¿Comparten al menos una palabra significativa? */
function mismaContraparte(a: string, b: string): boolean {
  const pa = new Set(palabras(a));
  if (pa.size === 0) return false;
  return palabras(b).some((p) => pa.has(p));
}

const CENTIMOS = 0.5;

/**
 * Puntuación de parecido. Los pesos reflejan qué convence a una persona:
 *
 *   3 · misma contraparte  — el argumento más fuerte con diferencia. "Con este
 *       cliente ya pasó" cierra la duda; el resto son coincidencias.
 *   2 · misma diferencia   — la comisión de siempre, el redondeo de siempre.
 *   1 · misma categoría    — apoya, pero por sí sola no dice gran cosa: hay
 *       cientos de "comision_bancaria" que no se parecen en nada.
 */
function puntuar(nuevo: CasoNuevo, viejo: CasoResuelto): number {
  let p = 0;
  if (mismaContraparte(nuevo.contraparte, viejo.contraparte)) p += 3;
  // También cuenta que el nombre del nuevo aparezca en la glosa del banco de
  // aquel caso, que es como suele venir el dato en un extracto.
  else if (mismaContraparte(nuevo.contraparte, viejo.glosa)) p += 3;

  const difA = Math.abs(nuevo.diferencia);
  const difB = Math.abs(viejo.diferencia);
  if (difA > 0.005 && Math.abs(difA - difB) <= CENTIMOS) p += 2;

  if (nuevo.categoria && nuevo.categoria === viejo.categoria) p += 1;
  return p;
}

/** Con menos de esto, lo "parecido" es ruido y estorba más de lo que ayuda. */
const PUNTUACION_MINIMA = 3;

function motivoDe(nuevo: CasoNuevo, viejo: CasoResuelto): string {
  const mismoCliente =
    mismaContraparte(nuevo.contraparte, viejo.contraparte) ||
    mismaContraparte(nuevo.contraparte, viejo.glosa);
  const difA = Math.abs(nuevo.diferencia);
  const mismaDif =
    difA > 0.005 && Math.abs(difA - Math.abs(viejo.diferencia)) <= CENTIMOS;

  if (mismoCliente && mismaDif) return "mismo cliente y misma diferencia";
  if (mismoCliente) return "mismo cliente";
  if (mismaDif) return "misma diferencia";
  return "mismo tipo de diferencia";
}

/**
 * Busca el precedente más convincente. `null` cuando no hay nada que se parezca
 * de verdad — preferible a rellenar la pantalla con parecidos forzados, que
 * enseñan a ignorar el recuadro.
 *
 * @param historial De más reciente a más antiguo: en empate gana el reciente,
 *   que es el criterio vigente de la empresa.
 */
export function buscarPrecedente(
  nuevo: CasoNuevo,
  historial: CasoResuelto[],
): Precedente | null {
  let mejor: CasoResuelto | null = null;
  let mejorPunt = 0;

  for (const viejo of historial) {
    const p = puntuar(nuevo, viejo);
    if (p > mejorPunt) {
      mejor = viejo;
      mejorPunt = p;
    }
  }

  if (!mejor || mejorPunt < PUNTUACION_MINIMA) return null;
  return { caso: mejor, motivo: motivoDe(nuevo, mejor) };
}

/**
 * Clave de un match para llevar los precedentes del servidor al cliente.
 * Se usa el par de ids porque es lo único estable: los índices del array se
 * mueven en cuanto se decide una sugerencia y la cola se reordena.
 */
export function clavePrecedente(
  idsInternos: string[],
  idsMovimientos: string[],
): string {
  return `${[...idsInternos].sort().join("|")}::${[...idsMovimientos].sort().join("|")}`;
}

// ── Extracción del historial ────────────────────────────────────────────────

type RegLite = {
  id_interno: string;
  fecha: string;
  monto: number;
  contraparte?: string | null;
  descripcion?: string | null;
};
type MovLite = { id_movimiento: string; fecha: string; monto: number; glosa?: string | null };
type MatchLite = {
  ids_internos?: string[];
  ids_movimientos?: string[];
  metodo?: string;
  categoria_diferencia?: string | null;
  estado_revision?: string;
  decisiones?: { accion?: string; timestamp?: string }[];
};

export type JobHistorico = {
  payload_entrada?: {
    registros_internos?: RegLite[];
    movimientos_bancarios?: MovLite[];
  } | null;
  resultado?: { matches?: MatchLite[] } | null;
};

/** Decisión humana explícita, o null si nadie tocó el match. */
function decisionDe(m: MatchLite): "aceptado" | "rechazado" | null {
  const ultima = m.decisiones?.[m.decisiones.length - 1]?.accion;
  const estado = ultima ?? m.estado_revision;
  if (estado === "rechazado") return "rechazado";
  // 'modificado' entra como aceptado: la persona confirmó que esos documentos
  // se corresponden, aunque ajustara el emparejamiento.
  if (estado === "aceptado" || estado === "modificado") return "aceptado";
  return null;
}

/**
 * Convierte jobs anteriores en casos consultables.
 *
 * Solo lo que una persona DECIDIÓ. Lo auto-conciliado no sirve como precedente:
 * nadie lo miró, así que citarlo como "tú resolviste esto así" sería falso.
 */
export function extraerCasos(jobs: JobHistorico[]): CasoResuelto[] {
  const casos: CasoResuelto[] = [];

  for (const job of jobs) {
    const regs = new Map(
      (job.payload_entrada?.registros_internos ?? []).map((r) => [r.id_interno, r]),
    );
    const movs = new Map(
      (job.payload_entrada?.movimientos_bancarios ?? []).map((m) => [m.id_movimiento, m]),
    );

    for (const m of job.resultado?.matches ?? []) {
      const decision = decisionDe(m);
      if (!decision) continue;

      const rs = (m.ids_internos ?? [])
        .map((id) => regs.get(id))
        .filter((r): r is RegLite => Boolean(r));
      const ms = (m.ids_movimientos ?? [])
        .map((id) => movs.get(id))
        .filter((x): x is MovLite => Boolean(x));
      if (!rs.length || !ms.length) continue;

      const montoInterno = rs.reduce((a, r) => a + r.monto, 0);
      const montoBanco = ms.reduce((a, x) => a + x.monto, 0);

      casos.push({
        decision,
        fecha: m.decisiones?.[m.decisiones.length - 1]?.timestamp?.slice(0, 10)
          ?? rs[0]!.fecha
          ?? null,
        contraparte: (rs[0]!.contraparte ?? rs[0]!.descripcion ?? "").trim(),
        glosa: (ms[0]!.glosa ?? "").trim(),
        montoInterno,
        montoBanco,
        diferencia: Number((montoInterno - montoBanco).toFixed(2)),
        categoria: m.categoria_diferencia ?? null,
      });
    }
  }

  return casos;
}
