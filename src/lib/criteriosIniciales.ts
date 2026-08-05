/**
 * Arranque en frío: el criterio que la empresa DECLARA, mientras no tiene
 * decisiones que enseñar.
 *
 * El aprendizaje se alimenta de lo que la gente decide. Una empresa nueva no ha
 * decidido nada, y eso ocurre justo durante los 30 días de prueba: el
 * diferenciador del producto está vacío exactamente cuando se está evaluando el
 * producto. Esto lo llena con algo real —criterio de esa empresa— sin esperar.
 *
 * ⚠️ NO es lo mismo que una decisión y no se presenta como tal: es lo que dicen
 * que hacen, no lo que hacen. Por eso viaja al prompt en su propia sección
 * ("CRITERIO DECLARADO") y nunca se mezcla con las decisiones reales, que son
 * las que valen cuando existen.
 *
 * Puro y con tests.
 */

export type CriterioInicial = {
  id: string;
  /** Lo que ve el usuario: una afirmación sobre su negocio, no un ajuste. */
  label: string;
  /** Para qué sirve saberlo, en su idioma. */
  ayuda: string;
  /** Cómo se le cuenta a la IA. */
  paraIa: string;
};

/**
 * Afirmaciones, no perillas. La pregunta "¿cuántos ejemplos few-shot quieres?"
 * es incontestable para una PyME; "¿tus clientes suelen pagar varias facturas
 * juntas?" la responde cualquiera que lleve el negocio.
 */
export const CRITERIOS_INICIALES: readonly CriterioInicial[] = [
  {
    id: "tolera_comision",
    label: "El banco me descuenta comisión de los depósitos",
    ayuda: "Entonces un cobro puede llegar por unos soles menos y seguir siendo el mismo.",
    paraIa:
      "es normal que el abono llegue con una pequeña comisión bancaria descontada",
  },
  {
    id: "pagos_agrupados",
    label: "Mis clientes suelen pagar varias facturas juntas",
    ayuda: "Un solo depósito puede corresponder a tres o cuatro documentos.",
    paraIa: "es habitual que un solo depósito cubra varias facturas a la vez",
  },
  {
    id: "nombre_distinto",
    label: "En el extracto no aparece el nombre de mi cliente",
    ayuda:
      "Pasa cuando paga una persona a nombre de la empresa, o el banco recorta el nombre.",
    paraIa:
      "el nombre de la glosa del banco no suele coincidir con la razón social del cliente",
  },
  {
    id: "pagos_tardios",
    label: "Los cobros se reflejan días después de la factura",
    ayuda: "Habitual si vendes a crédito o el banco tarda en acreditar.",
    paraIa:
      "el abono suele aparecer bastantes días después de la fecha del documento",
  },
  {
    id: "pagos_parciales",
    label: "Es normal que me paguen una parte",
    ayuda: "Entonces un cobro menor al total no es un error, es un pago a cuenta.",
    paraIa: "son habituales los pagos parciales a cuenta de una factura",
  },
] as const;

export function buscarCriterio(id: string): CriterioInicial | undefined {
  return CRITERIOS_INICIALES.find((c) => c.id === id);
}

/** Códigos válidos, descartando los desconocidos y los repetidos. */
export function normalizarCriterios(valores: unknown): string[] {
  if (!Array.isArray(valores)) return [];
  const validos = new Set(CRITERIOS_INICIALES.map((c) => c.id));
  return [...new Set(valores.filter((v): v is string => typeof v === "string"))]
    .filter((v) => validos.has(v));
}

/** Frases para el prompt, en el orden del catálogo. */
export function criteriosParaIa(ids: string[]): string[] {
  const elegidos = new Set(normalizarCriterios(ids));
  return CRITERIOS_INICIALES.filter((c) => elegidos.has(c.id)).map((c) => c.paraIa);
}

/**
 * Cuántas decisiones humanas hacen falta antes de que el aprendizaje real
 * mande sobre lo declarado.
 *
 * Diez es un número elegido para ser alcanzable en la primera o segunda
 * conciliación: si la "fase de entrenamiento" durase meses, el mensaje dejaría
 * de motivar y pasaría a ser una excusa permanente.
 */
export const DECISIONES_PARA_CALIBRAR = 10;

export type FaseAprendizaje = {
  fase: "sin_datos" | "entrenamiento" | "calibrada";
  decisiones: number;
  /** Cuántas faltan para salir de entrenamiento. 0 si ya salió. */
  faltan: number;
  /** 0–100, para la barra de progreso. */
  progreso: number;
};

export function faseAprendizaje(decisiones: number): FaseAprendizaje {
  const n = Math.max(0, decisiones);
  const faltan = Math.max(0, DECISIONES_PARA_CALIBRAR - n);
  const progreso = Math.min(
    100,
    Math.round((n / DECISIONES_PARA_CALIBRAR) * 100),
  );

  if (n === 0) return { fase: "sin_datos", decisiones: 0, faltan, progreso: 0 };
  if (faltan > 0) return { fase: "entrenamiento", decisiones: n, faltan, progreso };
  return { fase: "calibrada", decisiones: n, faltan: 0, progreso: 100 };
}
