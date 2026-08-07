import { normalizarFecha } from "./fecha";
import { normalizarMonto } from "./monto";
import type { MapeoColumnas } from "@/lib/parsing/deteccion";
import type {
  RegistroInterno,
  MovimientoBancario,
} from "@/lib/contract/payload";

/**
 * Normalización canónica: convierte filas crudas + mapeo de columnas en las
 * formas exactas del contrato con n8n (§7.2). Aquí se aplica la convención de
 * signos ÚNICA del sistema:
 *   - entradas (cobranza / abono) → monto POSITIVO
 *   - salidas   (pago / cargo)     → monto NEGATIVO
 */

function texto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

const ENTRADA = new Set(["cobranza", "abono", "ingreso", "deposito", "credito"]);
const SALIDA = new Set(["pago", "cargo", "egreso", "retiro", "debito"]);

function normalizarTipoTexto(v: unknown): "entrada" | "salida" | null {
  const s = String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (ENTRADA.has(s)) return "entrada";
  if (SALIDA.has(s)) return "salida";
  return null;
}

/**
 * Determina si un movimiento es entrada o salida. Prioridad:
 *  1) columna `tipo` mapeada con un valor reconocible,
 *  2) signo del monto (>= 0 entrada, < 0 salida).
 */
function determinarDireccion(
  fila: Record<string, unknown>,
  mapeo: MapeoColumnas,
  montoRaw: number,
): "entrada" | "salida" {
  if (mapeo.tipo) {
    const t = normalizarTipoTexto(fila[mapeo.tipo]);
    if (t) return t;
  }
  return montoRaw >= 0 ? "entrada" : "salida";
}

export type ResultadoNormalizacion<T> = {
  filas: T[];
  invalidas: number;
};

/** Convierte filas de registros internos a RegistroInterno[] canónicos. */
export function normalizarInternos(
  filas: Record<string, unknown>[],
  mapeo: MapeoColumnas,
): ResultadoNormalizacion<RegistroInterno> {
  const out: RegistroInterno[] = [];
  let invalidas = 0;

  filas.forEach((fila, i) => {
    const fecha = mapeo.fecha ? normalizarFecha(fila[mapeo.fecha]) : null;
    const montoRaw = mapeo.monto ? normalizarMonto(fila[mapeo.monto]) : null;
    if (!fecha || montoRaw == null) {
      invalidas++;
      return;
    }
    const dir = determinarDireccion(fila, mapeo, montoRaw);
    const monto = dir === "entrada" ? Math.abs(montoRaw) : -Math.abs(montoRaw);
    out.push({
      id_interno: `REG-${String(i + 1).padStart(4, "0")}`,
      fecha,
      monto,
      tipo: dir === "entrada" ? "cobranza" : "pago",
      referencia: mapeo.referencia ? texto(fila[mapeo.referencia]) : null,
      contraparte: mapeo.contraparte ? texto(fila[mapeo.contraparte]) : null,
      descripcion: mapeo.descripcion ? texto(fila[mapeo.descripcion]) : null,
    });
  });

  return { filas: out, invalidas };
}

/**
 * Un movimiento bancario canónico a partir de UNA fila cruda. `null` si le
 * falta lo imprescindible (fecha o monto).
 *
 * Existe suelta —y no dentro del bucle de `normalizarBancarios`— porque la
 * ingesta en servidor lee el archivo a trozos y normaliza fila a fila, sin
 * tener nunca el array entero en memoria. Que las dos rutas compartan ESTA
 * función es lo que garantiza que un extracto grande y uno pequeño se
 * interpreten igual; con dos copias, la convención de signos acabaría
 * divergiendo entre el camino del navegador y el del servidor.
 *
 * `indice` es la posición en el archivo: de ahí sale el `id_movimiento`
 * sintético, que tiene que ser estable entre corridas.
 */
export function normalizarMovimiento(
  fila: Record<string, unknown>,
  mapeo: MapeoColumnas,
  indice: number,
): MovimientoBancario | null {
  const fecha = mapeo.fecha ? normalizarFecha(fila[mapeo.fecha]) : null;
  const montoRaw = mapeo.monto ? normalizarMonto(fila[mapeo.monto]) : null;
  if (!fecha || montoRaw == null) return null;

  const dir = determinarDireccion(fila, mapeo, montoRaw);
  const monto = dir === "entrada" ? Math.abs(montoRaw) : -Math.abs(montoRaw);
  return {
    id_movimiento: `BCO-${String(indice + 1).padStart(4, "0")}`,
    fecha,
    monto,
    tipo: dir === "entrada" ? "abono" : "cargo",
    glosa: mapeo.descripcion ? texto(fila[mapeo.descripcion]) : null,
    referencia_banco: mapeo.referencia ? texto(fila[mapeo.referencia]) : null,
  };
}

/** Convierte filas de extracto bancario a MovimientoBancario[] canónicos. */
export function normalizarBancarios(
  filas: Record<string, unknown>[],
  mapeo: MapeoColumnas,
): ResultadoNormalizacion<MovimientoBancario> {
  const out: MovimientoBancario[] = [];
  let invalidas = 0;

  filas.forEach((fila, i) => {
    const m = normalizarMovimiento(fila, mapeo, i);
    if (m) out.push(m);
    else invalidas++;
  });

  return { filas: out, invalidas };
}
