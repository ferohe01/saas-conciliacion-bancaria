/**
 * Similitud de nombres para la capa de sugerencias (IA). Compara la contraparte
 * de un registro interno con la glosa bancaria buscando palabras en común,
 * ignorando términos bancarios genéricos (DEPÓSITO, TRANSFERENCIA, etc.).
 */

// Términos que NO aportan identidad (verbos bancarios, conectores, siglas).
const STOPWORDS = new Set([
  "DEPOSITO",
  "TRANSFERENCIA",
  "TRANSF",
  "TRANSFER",
  "RECIBIDA",
  "RECIBIDO",
  "ENVIADA",
  "ENVIADO",
  "PAGO",
  "PAGOS",
  "ABONO",
  "CARGO",
  "CUOTA",
  "REPETICION",
  "DEVOLUCION",
  "CCE",
  "INTERBANCARIA",
  "INTERBANCARIO",
  "OPERACION",
  "NRO",
  "REF",
  "REFERENCIA",
  "FACTURA",
  "BOLETA",
  "SAC",
  "EIRL",
  "SRL",
  "DEL",
  "LOS",
  "LAS",
  "POR",
  "CON",
]);

/** Normaliza y tokeniza: MAYÚSCULAS sin acentos, palabras de ≥3 letras útiles. */
export function palabras(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Palabras en común entre dos textos (identidad compartida). */
export function palabrasComunes(
  a: string | null | undefined,
  b: string | null | undefined,
): string[] {
  const setB = new Set(palabras(b));
  const comunes = new Set<string>();
  for (const p of palabras(a)) if (setB.has(p)) comunes.add(p);
  return [...comunes];
}
