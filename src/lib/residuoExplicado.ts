/**
 * «¿Y esas 4.384 partidas qué son?»
 *
 * La cascada de `origenPartidas.ts` llega hasta «sin conciliar» y ahí se para.
 * Esa cifra es justo la que abre la pregunta siguiente, y contestarla exigía
 * abrir los dos Excel y cruzarlos a mano. `residuo_explicado` (migración 0044)
 * hace ese cruce en la base; este módulo lo pone en palabras.
 *
 * ⚠️⚠️ **Lo que se afirma es más modesto de lo que parece, a propósito.** El
 * sistema puede comprobar que *el código de un recibo no aparece en ningún
 * movimiento del extracto*. NO puede afirmar que «se cobró por otro canal»: eso
 * es una lectura del negocio, muy probable pero no comprobada, y ponerla en
 * boca del sistema la convertiría en un hecho. Cada línea dice el hecho, y la
 * interpretación va aparte y en condicional.
 *
 * Es el mismo criterio de `precedentes.ts` («decidiste algo parecido antes», no
 * «la IA lo propuso por esto») y de `diagnosticoPartida.ts`.
 */

export type MotivoResiduo = "sin_rastro" | "codigo_en_el_otro_lado" | "sin_codigo";

export type ConteoResiduo = {
  motivo: MotivoResiduo;
  partidas: number;
  importe: number;
};

export type SerieResiduo = {
  serie: string;
  /** Códigos distintos de esa serie que trae cada lado. */
  banco: number;
  libros: number;
  bancoSinConciliar: number;
  librosSinConciliar: number;
};

export type ResiduoExplicado = {
  moneda: string;
  internos: ConteoResiduo[];
  movimientos: ConteoResiduo[];
  series: SerieResiduo[];
};

export type LineaResiduo = {
  clave: string;
  partidas: number;
  importe: number;
  /** El hecho comprobado. Nunca una conclusión. */
  hecho: string;
  /** Qué suele significar. En condicional, y separado del hecho. */
  lectura: string;
};

const MOTIVOS: Record<
  MotivoResiduo,
  { lado: Record<"interno" | "banco", { hecho: string; lectura: string }> }
> = {
  sin_rastro: {
    lado: {
      interno: {
        hecho:
          "su código no aparece en ningún movimiento del extracto de esta cuenta",
        lectura:
          "Suelen ser cobros que entraron por otra vía —otro banco, otra red de recaudo— o de un período distinto. No hay nada que emparejar aquí.",
      },
      banco: {
        hecho: "su código no aparece en ninguno de tus comprobantes del período",
        lectura:
          "El banco cobró algo que tus libros no documentan todavía, o el documento está en otro período.",
      },
    },
  },
  codigo_en_el_otro_lado: {
    lado: {
      interno: {
        hecho: "su código SÍ está en el extracto, pero no llegaron a emparejarse",
        lectura:
          "Normalmente el importe no coincide (un cobro parcial, una comisión) o ese movimiento ya se llevó otro comprobante con el mismo código. Son los que más merecen una mirada: aquí sí hay las dos caras.",
      },
      banco: {
        hecho: "su código SÍ está en tus comprobantes, pero no llegaron a emparejarse",
        lectura:
          "Mismo caso al revés: el importe difiere o el comprobante ya se emparejó con otro movimiento.",
      },
    },
  },
  sin_codigo: {
    lado: {
      interno: {
        hecho: "no traen código de operación",
        lectura:
          "Sin código solo se puede emparejar por importe y fecha, que a este volumen no basta.",
      },
      banco: {
        hecho: "no traen código de operación",
        lectura:
          "Sin código solo se puede emparejar por importe y fecha, que a este volumen no basta.",
      },
    },
  },
};

const ORDEN: MotivoResiduo[] = ["sin_rastro", "codigo_en_el_otro_lado", "sin_codigo"];

/** Normaliza lo que devuelve Postgres. `null` cuando no hay diagnóstico. */
export function leerResiduo(crudo: unknown): ResiduoExplicado | null {
  if (crudo == null || typeof crudo !== "object") return null;
  const o = crudo as Record<string, unknown>;
  const conteos = (v: unknown): ConteoResiduo[] =>
    (Array.isArray(v) ? v : [])
      .map((x) => {
        const r = x as Record<string, unknown>;
        const motivo = String(r.motivo ?? "");
        if (!ORDEN.includes(motivo as MotivoResiduo)) return null;
        return {
          motivo: motivo as MotivoResiduo,
          partidas: Number(r.partidas ?? 0),
          importe: Number(r.importe ?? 0),
        };
      })
      .filter((x): x is ConteoResiduo => x != null && x.partidas > 0)
      .sort((a, b) => ORDEN.indexOf(a.motivo) - ORDEN.indexOf(b.motivo));

  return {
    moneda: String(o.moneda ?? "PEN"),
    internos: conteos(o.internos),
    movimientos: conteos(o.movimientos),
    series: (Array.isArray(o.series) ? o.series : [])
      .map((x) => {
        const r = x as Record<string, unknown>;
        return {
          serie: String(r.serie ?? ""),
          banco: Number(r.banco ?? 0),
          libros: Number(r.libros ?? 0),
          bancoSinConciliar: Number(r.banco_sin_conciliar ?? 0),
          librosSinConciliar: Number(r.libros_sin_conciliar ?? 0),
        };
      })
      .filter((s) => s.serie !== ""),
  };
}

/** Las líneas de un lado, ya redactadas. */
export function lineasDeLado(
  r: ResiduoExplicado | null,
  lado: "interno" | "banco",
): LineaResiduo[] {
  if (!r) return [];
  const conteos = lado === "interno" ? r.internos : r.movimientos;
  return conteos.map((c) => ({
    clave: c.motivo,
    partidas: c.partidas,
    importe: c.importe,
    hecho: MOTIVOS[c.motivo].lado[lado].hecho,
    lectura: MOTIVOS[c.motivo].lado[lado].lectura,
  }));
}

/**
 * Series donde a un lado le FALTAN documentos respecto del otro.
 *
 * ⚠️ Es la línea que destapó el caso real: de la serie `S001` el banco traía
 * 559 códigos y los libros solo 276. Eso no es un problema de emparejamiento —
 * es que faltan documentos, y ninguna mejora del motor lo va a arreglar.
 *
 * Solo se devuelven las series donde la diferencia es REAL (un lado tiene al
 * menos un 10 % más de códigos que el otro, y al menos 20 de diferencia).
 * Enseñar todas las series con su empate exacto sería ruido.
 */
export function seriesDesiguales(r: ResiduoExplicado | null): (SerieResiduo & {
  faltanEn: "libros" | "banco";
  faltan: number;
})[] {
  if (!r) return [];
  const MIN_DIF = 20;
  const MIN_PCT = 0.1;
  return r.series
    .map((s) => {
      const faltanEn = s.banco > s.libros ? ("libros" as const) : ("banco" as const);
      const faltan = Math.abs(s.banco - s.libros);
      return { ...s, faltanEn, faltan };
    })
    .filter((s) => {
      const mayor = Math.max(s.banco, s.libros);
      return s.faltan >= MIN_DIF && mayor > 0 && s.faltan / mayor >= MIN_PCT;
    });
}

/** ¿Hay algo que enseñar? Sin partidas sueltas no se pinta la sección. */
export function hayResiduo(r: ResiduoExplicado | null): boolean {
  if (!r) return false;
  return r.internos.length > 0 || r.movimientos.length > 0;
}
