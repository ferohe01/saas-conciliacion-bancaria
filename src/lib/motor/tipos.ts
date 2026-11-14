import type {
  MovimientoBancario,
  RegistroInterno,
} from "@/lib/contract/payload";
import type { ConfigConciliacion } from "@/lib/contract/config";
import type { Match } from "@/lib/contract/resultado";

/**
 * El estado que pasa de una capa del motor a la siguiente.
 *
 * Es la misma forma que se pasaban los nodos de n8n (`matches`,
 * `pendientes_internos`, `pendientes_bancarios`): cada capa recibe lo que dejó
 * la anterior, añade sus pares y devuelve lo que sigue suelto. Ninguna capa
 * modifica su entrada — devuelve una etapa nueva.
 */
export type Etapa = {
  matches: Match[];
  pendientesInternos: RegistroInterno[];
  pendientesBancarios: MovimientoBancario[];
};

/**
 * La configuración tal como la lee el motor. Todo opcional: los nodos de n8n
 * aplicaban sus propios valores por defecto y el motor los conserva, así que
 * una config incompleta se comporta exactamente igual que antes.
 */
export type ConfigMotor = Partial<ConfigConciliacion> & {
  /** Cuántos registros se le preguntan al LLM como máximo (150). */
  max_consultas_ia?: number;
};

export const MS_DIA = 86_400_000;
