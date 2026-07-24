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
