/**
 * Utilidades de período. Un período del MVP es un mes calendario; se deriva su
 * rango [desde, hasta] en ISO. Todo en UTC para evitar corrimientos de zona.
 */

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export type OpcionPeriodo = {
  valor: string; // "YYYY-MM"
  etiqueta: string; // "Junio 2026"
  desde: string; // "YYYY-MM-01"
  hasta: string; // último día del mes
};

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function nombreMes(mes1a12: number): string {
  return MESES[mes1a12 - 1] ?? "";
}

/** Rango [desde, hasta] de un mes dado. */
export function rangoDeMes(anio: number, mes1a12: number): {
  desde: string;
  hasta: string;
} {
  const ultimoDia = new Date(Date.UTC(anio, mes1a12, 0)).getUTCDate();
  return {
    desde: `${anio}-${pad(mes1a12)}-01`,
    hasta: `${anio}-${pad(mes1a12)}-${pad(ultimoDia)}`,
  };
}

export function opcionPeriodo(anio: number, mes1a12: number): OpcionPeriodo {
  const { desde, hasta } = rangoDeMes(anio, mes1a12);
  return {
    valor: `${anio}-${pad(mes1a12)}`,
    etiqueta: `${nombreMes(mes1a12)} ${anio}`,
    desde,
    hasta,
  };
}

/** Lista los últimos `cantidad` meses (incluyendo el actual), del más reciente. */
export function mesesRecientes(
  cantidad = 12,
  hoy = new Date(),
): OpcionPeriodo[] {
  const opciones: OpcionPeriodo[] = [];
  let anio = hoy.getUTCFullYear();
  let mes = hoy.getUTCMonth() + 1;
  for (let i = 0; i < cantidad; i++) {
    opciones.push(opcionPeriodo(anio, mes));
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      anio -= 1;
    }
  }
  return opciones;
}

/** Mes ("YYYY-MM") de una fecha ISO. */
export function mesDeISO(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * ── Rango libre de fechas ───────────────────────────────────────────────────
 *
 * El mes calendario cubre al caso más común y por eso sigue siendo lo primero
 * del desplegable. Pero hay
 * clientes cuyo período natural NO es el mes: una recaudadora con 450.000
 * movimientos mensuales concilia por día —su día pico son 36.390 partidas— y
 * con solo meses no podía expresar su propio corte. El motor ya lo aguantaba;
 * la pantalla no lo dejaba pedir.
 *
 * El resto del sistema no necesitó cambios: `validarCoherencia` ya recibía
 * `{desde, hasta}`, la idempotencia compara las dos fechas exactas y los
 * reportes deduplican por rango exacto (no por mes) desde la Fase 9.
 */

/** Valor centinela del desplegable para "no es un mes, es un rango". */
export const VALOR_RANGO = "rango";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** dd/mm/yyyy, la forma en que se leen las fechas en pantalla. */
function aLegible(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Período a partir de dos fechas ISO. Devuelve `null` si el rango no sirve —
 * incompleto o del revés—, y quien lo llama debe bloquear en vez de inventarse
 * un valor: conciliar un período que el usuario no pidió es peor que no
 * conciliar.
 */
export function periodoDeRango(
  desde: string,
  hasta: string,
): OpcionPeriodo | null {
  if (!ISO.test(desde) || !ISO.test(hasta) || desde > hasta) return null;
  return {
    valor: VALOR_RANGO,
    // Un solo día se dice como un día. "30/06/2026 a 30/06/2026" se lee como un
    // error de la aplicación, y el corte diario es justo el caso que motivó esto.
    etiqueta:
      desde === hasta
        ? aLegible(desde)
        : `${aLegible(desde)} a ${aLegible(hasta)}`,
    desde,
    hasta,
  };
}
