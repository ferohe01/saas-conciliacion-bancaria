import { normalizarMonto } from "@/lib/normalizacion/monto";

/**
 * Intenta detectar el saldo final del extracto a partir de una columna de
 * saldo/balance (toma el último valor no vacío). Muchos extractos bancarios
 * traen una columna de saldo corriente; su última fila es el saldo final.
 */

function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function esColumnaSaldo(header: string): boolean {
  const h = normalizarTexto(header);
  // "saldo", "saldo contable", "balance"; evita "saldo inicial".
  return (
    (h.includes("saldo") || h.includes("balance")) && !h.includes("inicial")
  );
}

/**
 * Qué columna es el saldo corriente, si alguna.
 *
 * ⚠️ Se expone aparte porque el saldo **NO es un campo del mapeo**: `CAMPOS` de
 * `deteccion.ts` tiene seis y ninguno es el saldo, así que el Paso 2 nunca lo
 * pregunta y `mapeo.saldo` no llega nunca relleno. La ingesta en servidor tiene
 * que detectarlo por su cuenta o el saldo declarado por el banco se pierde —
 * que es justo lo que pasaba: el extracto traía su columna `Saldo`, la caja lo
 * decía todo «calculado», y el camino principal del saldo vivo era código
 * inalcanzable.
 */
export function columnaSaldo(headers: string[]): string | null {
  return headers.find(esColumnaSaldo) ?? null;
}

export function detectarSaldoFinal(
  headers: string[],
  filas: Record<string, unknown>[],
): number | null {
  const col = columnaSaldo(headers);
  if (!col || filas.length === 0) return null;

  // Último valor no vacío de la columna de saldo.
  for (let i = filas.length - 1; i >= 0; i--) {
    const v = normalizarMonto(filas[i]?.[col]);
    if (v != null) return v;
  }
  return null;
}
