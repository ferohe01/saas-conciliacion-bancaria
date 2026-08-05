/**
 * ¿De verdad está aprendiendo?
 *
 * El módulo de Aprendizaje afirmaba que el sistema mejora con el uso, pero no
 * había ninguna cifra que lo demostrara: solo el tamaño del pool de ejemplos,
 * que es una métrica de ENTRADA (cuánto se le da de comer), no de resultado.
 * Esto calcula la de resultado.
 *
 * ── Qué se mide, y por qué solo esto ────────────────────────────────────────
 *
 * Únicamente los matches con `metodo === "ia"`. La conciliación exacta no
 * mejora con el aprendizaje —un monto igual a otro seguirá siendo igual— así
 * que meterla en la cuenta diluiría la señal hasta hacerla inútil: el % global
 * de automatización subiría por tener datos más limpios, no por aprender.
 *
 * ── Qué cuenta como acierto ─────────────────────────────────────────────────
 *
 *   aceptado    → ACIERTO. Una persona miró la propuesta y la dio por buena.
 *   rechazado   → fallo.
 *   modificado  → fallo. La propuesta sirvió de punto de partida, pero alguien
 *                 tuvo que corregirla: para el usuario fue trabajo, no ahorro.
 *                 Se reporta aparte porque no es lo mismo que un rechazo.
 *
 * ⚠️ Los `auto` (IA por encima del umbral, conciliados sin preguntar) quedan
 * FUERA de la tasa. Nadie los revisó, así que no son evidencia de acierto:
 * incluirlos dispararía la cifra sin que signifique nada. Se cuentan aparte,
 * porque son el ahorro real de trabajo y merecen verse — pero no disfrazados de
 * precisión verificada.
 */

export type MatchMetrica = {
  metodo?: string;
  estado_revision?: string;
  decisiones?: { accion?: string; timestamp?: string; motivo?: string | null }[];
};

export type JobMetrica = {
  id: string;
  created_at?: string | null;
  resultado?: { matches?: MatchMetrica[] } | null;
};

export type PuntoAprendizaje = {
  jobId: string;
  fecha: string | null;
  /** Sugerencias de IA que una persona revisó (base de la tasa). */
  revisadas: number;
  aceptadas: number;
  rechazadas: number;
  modificadas: number;
  /** Conciliadas solas por confianza alta. No entran en la tasa. */
  automaticas: number;
  /** aceptadas / revisadas. `null` cuando nadie revisó ninguna. */
  tasa: number | null;
};

export type Tendencia = {
  tasaAntes: number;
  tasaDespues: number;
  /** Puntos porcentuales de diferencia (positivo = mejora). */
  delta: number;
};

export type MetricasAprendizaje = {
  puntos: PuntoAprendizaje[];
  revisadas: number;
  aceptadas: number;
  rechazadas: number;
  modificadas: number;
  automaticas: number;
  /** Tasa global de acierto, o `null` si nadie ha revisado nada aún. */
  tasa: number | null;
  /**
   * Comparación mitad antigua vs. mitad reciente. `null` cuando no hay datos
   * suficientes para que la comparación signifique algo — ver MIN_*.
   */
  tendencia: Tendencia | null;
  /** Por qué no hay tendencia todavía, en lenguaje de usuario. */
  motivoSinTendencia: string | null;
  /**
   * Códigos de motivo de cada rechazo, en crudo. Responde "¿en qué se equivoca
   * más?", que es lo accionable: si casi todo es "otro cliente", el problema
   * está en cómo compara nombres, no en las tolerancias de monto.
   */
  motivosRechazo: (string | null)[];
};

/**
 * Umbrales para atreverse a hablar de tendencia.
 *
 * Con tres sugerencias revisadas, pasar de 2/3 a 3/3 es un salto de 33 puntos
 * que no significa nada. Anunciar eso como "la IA mejoró un 33%" destruiría la
 * credibilidad de la cifra la primera vez que el cliente la mirase de cerca.
 */
const MIN_JOBS_POR_MITAD = 2;
const MIN_REVISADAS_POR_MITAD = 10;

/** Última acción humana sobre el match, si la hubo. */
function decisionHumana(m: MatchMetrica): string | null {
  const ultima = m.decisiones?.[m.decisiones.length - 1]?.accion;
  const estado = ultima ?? m.estado_revision;
  if (estado === "aceptado" || estado === "rechazado" || estado === "modificado") {
    return estado;
  }
  return null;
}

function puntoDeJob(job: JobMetrica): PuntoAprendizaje {
  let aceptadas = 0;
  let rechazadas = 0;
  let modificadas = 0;
  let automaticas = 0;

  for (const m of job.resultado?.matches ?? []) {
    if (m.metodo !== "ia") continue;
    const d = decisionHumana(m);
    if (d === "aceptado") aceptadas++;
    else if (d === "rechazado") rechazadas++;
    else if (d === "modificado") modificadas++;
    else if (m.estado_revision === "auto") automaticas++;
    // `pendiente` sin decidir no cuenta: todavía no dice nada.
  }

  const revisadas = aceptadas + rechazadas + modificadas;
  return {
    jobId: job.id,
    fecha: job.created_at ? String(job.created_at).slice(0, 10) : null,
    revisadas,
    aceptadas,
    rechazadas,
    modificadas,
    automaticas,
    tasa: revisadas > 0 ? aceptadas / revisadas : null,
  };
}

/** Agrega los puntos de un tramo en una sola tasa (ponderada por volumen). */
function tasaDeTramo(puntos: PuntoAprendizaje[]): {
  revisadas: number;
  tasa: number | null;
} {
  const revisadas = puntos.reduce((a, p) => a + p.revisadas, 0);
  const aceptadas = puntos.reduce((a, p) => a + p.aceptadas, 0);
  return { revisadas, tasa: revisadas > 0 ? aceptadas / revisadas : null };
}

/**
 * @param jobs Completados, **del más antiguo al más reciente**. El orden lo fija
 *   quien consulta; aquí no se reordena por fecha porque `created_at` puede
 *   faltar y una ordenación silenciosa escondería ese hueco.
 */
export function metricasAprendizaje(jobs: JobMetrica[]): MetricasAprendizaje {
  const todos = jobs.map(puntoDeJob);

  const motivosRechazo: (string | null)[] = [];
  for (const job of jobs) {
    for (const m of job.resultado?.matches ?? []) {
      if (m.metodo !== "ia") continue;
      if (decisionHumana(m) !== "rechazado") continue;
      motivosRechazo.push(
        m.decisiones?.[m.decisiones.length - 1]?.motivo ?? null,
      );
    }
  }
  // Solo interesan las corridas donde la IA propuso algo; las demás son ruido
  // en la gráfica y hunden visualmente la línea sin aportar información.
  const puntos = todos.filter((p) => p.revisadas > 0 || p.automaticas > 0);

  const revisadas = todos.reduce((a, p) => a + p.revisadas, 0);
  const aceptadas = todos.reduce((a, p) => a + p.aceptadas, 0);
  const rechazadas = todos.reduce((a, p) => a + p.rechazadas, 0);
  const modificadas = todos.reduce((a, p) => a + p.modificadas, 0);
  const automaticas = todos.reduce((a, p) => a + p.automaticas, 0);

  const conRevision = puntos.filter((p) => p.revisadas > 0);
  let tendencia: Tendencia | null = null;
  let motivoSinTendencia: string | null = null;

  if (conRevision.length < MIN_JOBS_POR_MITAD * 2) {
    motivoSinTendencia =
      "Hacen falta al menos cuatro conciliaciones con sugerencias revisadas para poder comparar.";
  } else {
    const corte = Math.floor(conRevision.length / 2);
    const antes = tasaDeTramo(conRevision.slice(0, corte));
    const despues = tasaDeTramo(conRevision.slice(corte));

    if (
      antes.revisadas < MIN_REVISADAS_POR_MITAD ||
      despues.revisadas < MIN_REVISADAS_POR_MITAD
    ) {
      motivoSinTendencia =
        "Todavía son pocas decisiones para que la comparación sea fiable.";
    } else if (antes.tasa !== null && despues.tasa !== null) {
      tendencia = {
        tasaAntes: antes.tasa,
        tasaDespues: despues.tasa,
        delta: Math.round((despues.tasa - antes.tasa) * 100),
      };
    }
  }

  return {
    puntos,
    revisadas,
    aceptadas,
    rechazadas,
    modificadas,
    automaticas,
    tasa: revisadas > 0 ? aceptadas / revisadas : null,
    tendencia,
    motivoSinTendencia,
    motivosRechazo,
  };
}

/** Porcentaje entero para pantalla. */
export function pct(t: number | null): string {
  return t === null ? "—" : `${Math.round(t * 100)}%`;
}
