/**
 * Por qué se rechaza una sugerencia.
 *
 * Hasta ahora un rechazo era solo "rechazado": se guardaba QUÉ decidió la
 * persona y se tiraba **por qué**, que es la señal más informativa de todo el
 * ciclo. "Rechazado" le dice a la IA que se equivocó; "rechazado porque era otra
 * contraparte" le dice **en qué** se equivocó, que es lo único que permite no
 * repetirlo.
 *
 * Son códigos y no texto libre a propósito: el texto libre no se puede agregar
 * («¿de qué falla la IA más a menudo?») ni resumir en un prompt sin volverse
 * ruido. La nota libre sigue existiendo aparte, para el matiz.
 *
 * ⚠️ Estos códigos viajan al prompt del LLM y se guardan en el histórico. Añadir
 * uno nuevo es barato; **renombrar o borrar uno rompe la lectura del histórico**,
 * porque las decisiones ya guardadas seguirán trayendo el código viejo.
 */

export type MotivoRechazo =
  | "otra_contraparte"
  | "monto_no_corresponde"
  | "fecha_no_cuadra"
  | "ya_conciliado"
  | "documento_distinto"
  | "otro";

export type OpcionMotivo = {
  id: MotivoRechazo;
  /** Lo que ve el usuario. En su idioma, no en el del contador. */
  label: string;
  /** Cómo se le cuenta a la IA. Frase corta, en primera persona del criterio. */
  paraIa: string;
};

export const MOTIVOS_RECHAZO: readonly OpcionMotivo[] = [
  {
    id: "otra_contraparte",
    label: "Es otro cliente o proveedor",
    paraIa: "no era la misma contraparte",
  },
  {
    id: "monto_no_corresponde",
    label: "El monto no corresponde",
    paraIa: "la diferencia de monto no era aceptable",
  },
  {
    id: "fecha_no_cuadra",
    label: "La fecha no cuadra",
    paraIa: "la fecha estaba demasiado lejos",
  },
  {
    id: "ya_conciliado",
    label: "Ese movimiento ya era de otra factura",
    paraIa: "ese movimiento correspondía a otro documento",
  },
  {
    id: "documento_distinto",
    label: "Es un documento parecido, pero no ese",
    paraIa: "era un documento parecido pero no el correcto",
  },
  { id: "otro", label: "Otro motivo", paraIa: "no correspondía" },
] as const;

export function buscarMotivo(id: string): OpcionMotivo | undefined {
  return MOTIVOS_RECHAZO.find((m) => m.id === id);
}

/** Etiqueta para pantalla; nunca deja el hueco en blanco. */
export function etiquetaMotivo(id: string | null | undefined): string {
  if (!id) return "Sin motivo indicado";
  return buscarMotivo(id)?.label ?? id;
}

export type ConteoMotivo = { id: string; label: string; n: number };

/**
 * Agrega los motivos para el módulo de Aprendizaje. Ordena de más a menos
 * frecuente: la pregunta que responde es "¿en qué se equivoca más?".
 *
 * Los rechazos sin motivo (los anteriores a esta función) se cuentan aparte en
 * vez de desaparecer: si no, el total no cuadraría con el de rechazos y el
 * panel parecería estar perdiendo datos.
 */
export function contarMotivos(
  motivos: (string | null | undefined)[],
): { filas: ConteoMotivo[]; sinMotivo: number } {
  const cuenta = new Map<string, number>();
  let sinMotivo = 0;

  for (const m of motivos) {
    if (!m) {
      sinMotivo++;
      continue;
    }
    cuenta.set(m, (cuenta.get(m) ?? 0) + 1);
  }

  const filas = [...cuenta.entries()]
    .map(([id, n]) => ({ id, label: etiquetaMotivo(id), n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "es"));

  return { filas, sinMotivo };
}
