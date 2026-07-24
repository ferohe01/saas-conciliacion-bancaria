import { mesDeISO, nombreMes } from "@/lib/periodo";

/**
 * Validación de coherencia entre las fechas de un archivo y el período
 * seleccionado. No bloquea: solo advierte si buena parte de los movimientos
 * caen fuera del período (típico error de subir el archivo del mes equivocado).
 */

const UMBRAL_ADVERTENCIA = 0.3; // 30% o más fuera → advertir

export type ResultadoCoherencia = {
  totalConFecha: number;
  fuera: number;
  fueraPct: number; // 0..1
  advertir: boolean;
  mensaje: string | null;
};

function mesLegible(mesISO: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mesISO);
  if (!m) return mesISO;
  return `${nombreMes(Number(m[2]))} ${m[1]}`;
}

export function validarCoherencia(
  fechasISO: string[],
  periodo: { desde: string; hasta: string },
): ResultadoCoherencia {
  const conFecha = fechasISO.filter(Boolean);
  const total = conFecha.length;

  if (total === 0) {
    return {
      totalConFecha: 0,
      fuera: 0,
      fueraPct: 0,
      advertir: false,
      mensaje: null,
    };
  }

  const fuera = conFecha.filter(
    (f) => f < periodo.desde || f > periodo.hasta,
  ).length;
  const fueraPct = fuera / total;
  const advertir = fueraPct >= UMBRAL_ADVERTENCIA;

  let mensaje: string | null = null;
  if (advertir) {
    // Mes dominante entre las fechas fuera de rango, para un aviso claro.
    const conteo = new Map<string, number>();
    for (const f of conFecha) {
      const mes = mesDeISO(f);
      if (mes) conteo.set(mes, (conteo.get(mes) ?? 0) + 1);
    }
    let mesTop = "";
    let maxTop = 0;
    for (const [mes, n] of conteo) {
      if (n > maxTop) {
        maxTop = n;
        mesTop = mes;
      }
    }
    const pct = Math.round((maxTop / total) * 100);
    mensaje =
      `El ${pct}% de los movimientos de este archivo son de ` +
      `${mesLegible(mesTop)}. ¿Es el archivo correcto para el período elegido?`;
  }

  return { totalConFecha: total, fuera, fueraPct, advertir, mensaje };
}
