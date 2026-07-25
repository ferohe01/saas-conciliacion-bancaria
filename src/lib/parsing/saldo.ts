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

export function detectarSaldoFinal(
  headers: string[],
  filas: Record<string, unknown>[],
): number | null {
  const col = headers.find(esColumnaSaldo);
  if (!col || filas.length === 0) return null;

  // Último valor no vacío de la columna de saldo.
  for (let i = filas.length - 1; i >= 0; i--) {
    const v = normalizarMonto(filas[i]?.[col]);
    if (v != null) return v;
  }
  return null;
}
