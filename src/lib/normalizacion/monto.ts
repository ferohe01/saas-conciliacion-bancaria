/**
 * Normalización de montos a número decimal (sin formato).
 *
 * Acepta lo que aparece en archivos peruanos:
 *  - "1,234.56"  → 1234.56  (coma miles, punto decimal — convención local)
 *  - "1.234,56"  → 1234.56  (formato europeo)
 *  - "S/ 1,234.56", "$ 1234.56", "PEN 1234"  → se quita el símbolo
 *  - "(1,234.56)" o "-1234.56"  → negativo
 *  - 1234.56 (número) → tal cual
 *
 * Regla de separadores: si aparecen coma y punto, el que está más a la derecha
 * es el decimal. Si solo hay uno y va seguido de exactamente 3 dígitos, se
 * asume separador de miles (sin decimales); en otro caso, decimal.
 */
export function normalizarMonto(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : null;
  }

  let s = String(valor).trim();
  if (!s) return null;

  // Negativo por paréntesis contable.
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (s.includes("-")) negativo = true;

  // Quitar todo lo que no sea dígito, coma o punto.
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;

  const ultimaComa = s.lastIndexOf(",");
  const ultimoPunto = s.lastIndexOf(".");

  let normal: string;
  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    // Ambos: el de más a la derecha es el decimal.
    const decimalEsComa = ultimaComa > ultimoPunto;
    const sepMiles = decimalEsComa ? /\./g : /,/g;
    normal = s.replace(sepMiles, "");
    normal = decimalEsComa ? normal.replace(",", ".") : normal;
  } else if (ultimaComa !== -1) {
    // Solo coma.
    const decimales = s.length - ultimaComa - 1;
    normal =
      decimales === 3 && s.indexOf(",") === ultimaComa
        ? s.replace(/,/g, "") // miles
        : s.replace(/,/g, "."); // decimal
  } else if (ultimoPunto !== -1) {
    // Solo punto.
    const decimales = s.length - ultimoPunto - 1;
    normal =
      decimales === 3 && s.indexOf(".") === ultimoPunto
        ? s.replace(/\./g, "") // miles
        : s; // decimal
  } else {
    normal = s;
  }

  const n = Number(normal);
  if (!Number.isFinite(n)) return null;
  return negativo ? -Math.abs(n) : n;
}
