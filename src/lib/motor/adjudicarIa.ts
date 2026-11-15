import { diferencia } from "./texto";
import type { Shortlist } from "./candidatosIa";
import type { ConfigMotor, Etapa } from "./tipos";

/**
 * IA (2/2): adjudicar la respuesta del LLM validando contra los candidatos.
 *
 * El LLM eligió, por registro interno, un candidato de la shortlist (o
 * "ninguno"). Aquí se valida que el id elegido REALMENTE estaba entre los
 * candidatos de ese interno (anti-alucinación fuerte), se fuerza 1-a-1 y se
 * agregan como método "ia".
 *
 * `respuesta` es el texto del modelo, o `null` si no contestó: entonces no hay
 * adjudicaciones y todo queda pendiente de revisión humana, que es donde
 * estaba. Un fallo de la IA no puede tumbar la conciliación.
 */
export function adjudicarIa(
  prev: Etapa,
  shortlists: Shortlist[],
  respuesta: unknown,
  config: ConfigMotor,
): Etapa {
  const matches = [...prev.matches];
  const internos = prev.pendientesInternos;
  const bancarios = prev.pendientesBancarios;
  const umbral = Number(config.umbral_confianza_auto ?? 0.95);

  const candPorInterno = new Map<
    string,
    { set: Set<string>; catPorMov: Map<string, string> }
  >();
  for (const s of shortlists) {
    const set = new Set<string>();
    const catPorMov = new Map<string, string>();
    for (const c of s.candidatos) {
      set.add(c.id_movimiento);
      catPorMov.set(c.id_movimiento, c.categoria_probable);
    }
    candPorInterno.set(s.id_interno, { set, catPorMov });
  }

  const pares = extraerPares(respuesta);

  const idxInt = new Map(internos.map((r, i) => [r.id_interno, i]));
  const idxBanc = new Map(bancarios.map((m, j) => [m.id_movimiento, j]));
  const intUsado = new Set<number>();
  const bancUsado = new Set<number>();

  for (const p of pares) {
    const idI = typeof p.id_interno === "string" ? p.id_interno : "";
    const idB = typeof p.id_movimiento === "string" ? p.id_movimiento : "";
    if (!idB || idB === "ninguno") continue;
    const cand = candPorInterno.get(idI);
    if (!cand || !cand.set.has(idB)) continue; // debía estar entre los candidatos
    const i = idxInt.get(idI);
    const j = idxBanc.get(idB);
    if (i == null || j == null || intUsado.has(i) || bancUsado.has(j)) continue;
    const it = internos[i]!;
    const bc = bancarios[j]!;
    const bruta = Number(p.confianza ?? 0.8);
    const confianza = Math.max(0, Math.min(1, Number.isFinite(bruta) ? bruta : 0.8));
    const categoria =
      (typeof p.categoria === "string" ? p.categoria : null) ??
      cand.catPorMov.get(idB) ??
      "requiere_investigacion";
    // ⚠️ Un pago parcial NUNCA se auto-concilia, diga lo que diga la confianza.
    // Aceptarlo descuenta solo lo cobrado y deja el comprobante en `parcial`:
    // es una decisión sobre el dinero de un cliente, y la toma una persona. Se
    // mira también la categoría que dieron los números, por si el modelo la
    // etiquetó de otra forma.
    const esParcial =
      categoria === "pago_parcial" || cand.catPorMov.get(idB) === "pago_parcial";
    matches.push({
      ids_internos: [idI],
      ids_movimientos: [idB],
      metodo: "ia",
      confianza,
      diferencia_monto: diferencia(it.monto, bc.monto),
      categoria_diferencia: categoria,
      justificacion:
        typeof p.justificacion === "string" ? p.justificacion : "Sugerido por IA.",
      // La IA nunca concilia sola por debajo del umbral.
      estado_revision: confianza >= umbral && !esParcial ? "auto" : "pendiente",
    });
    intUsado.add(i);
    bancUsado.add(j);
  }

  return {
    matches,
    pendientesInternos: internos.filter((_, i) => !intUsado.has(i)),
    pendientesBancarios: bancarios.filter((_, j) => !bancUsado.has(j)),
  };
}

type ParIa = Record<string, unknown>;

/**
 * Los pares de la respuesta del modelo. Acepta el objeto ya parseado o el
 * texto, con o sin cerco de ```json, y `{pares:[...]}` o el array suelto. Lo
 * que no se entienda es "ningún par", nunca un error.
 */
export function extraerPares(respuesta: unknown): ParIa[] {
  let parsed: unknown = respuesta;
  if (typeof respuesta === "string") {
    const texto = respuesta
      .trim()
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();
    try {
      parsed = JSON.parse(texto);
    } catch {
      parsed = null;
    }
  }
  const lista = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { pares?: unknown }).pares)
      ? (parsed as { pares: unknown[] }).pares
      : [];
  return lista.filter((p): p is ParIa => p != null && typeof p === "object");
}
