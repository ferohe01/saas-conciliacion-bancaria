import { z } from "zod";

/**
 * Lectura de extractos bancarios en PDF con IA — la parte pura.
 *
 * El modelo lee el PDF y devuelve los movimientos; TODO lo que decide algo
 * sobre el dinero se hace aquí, en código con tests:
 *
 *  - El modelo copia CARGO y ABONO tal como figuran, en columnas separadas, y el
 *    signo lo pone `normalizar` (abono +, cargo −, la convención única del
 *    sistema). Pedirle un importe con signo es pedirle que interprete la
 *    convención, que es justo donde más fácil se equivoca sin que se note.
 *  - `verificar` comprueba que saldo inicial + movimientos = saldo final, y la
 *    cadena de saldos fila a fila. Es el control anti-invención: un movimiento
 *    que el modelo se saltó, duplicó o leyó mal rompe la suma.
 *  - El resultado sale como CSV de columnas fijas, para que el wizard lo trate
 *    como cualquier extracto (mapeo, saldo final, importación por lotes).
 */

const Numero = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  // "1.234,56" / "1,234.56" / "-50.00" → número. El último separador decide.
  const s = String(v).replace(/[^\d,.-]/g, "");
  const ultimoPunto = s.lastIndexOf(".");
  const ultimaComa = s.lastIndexOf(",");
  const decimal = ultimaComa > ultimoPunto ? "," : ".";
  const limpio = decimal === "," ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());

export const MovimientoPdf = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descripcion: z.string().nullable().optional(),
  referencia: z.string().nullable().optional(),
  cargo: Numero.optional(),
  abono: Numero.optional(),
  saldo: Numero.optional(),
});
export type MovimientoPdf = z.infer<typeof MovimientoPdf>;

export const LecturaPdf = z.object({
  saldo_inicial: Numero.optional(),
  saldo_final: Numero.optional(),
  movimientos: z.array(MovimientoPdf),
  /** El modelo avisa si el documento no parece un extracto o viene ilegible. */
  advertencia: z.string().nullable().optional(),
});
export type LecturaPdf = z.infer<typeof LecturaPdf>;

export type FilaExtracto = {
  fecha: string;
  descripcion: string;
  referencia: string;
  monto: number;
  saldo: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Abono +, cargo −. Una fila sin importe no es un movimiento y se descarta. */
export function normalizar(lectura: LecturaPdf): FilaExtracto[] {
  const filas: FilaExtracto[] = [];
  for (const m of lectura.movimientos) {
    const abono = Math.abs(m.abono ?? 0);
    const cargo = Math.abs(m.cargo ?? 0);
    const monto = r2(abono - cargo);
    if (monto === 0) continue;
    filas.push({
      fecha: m.fecha,
      descripcion: (m.descripcion ?? "").trim(),
      referencia: (m.referencia ?? "").trim(),
      monto,
      saldo: m.saldo ?? null,
    });
  }
  return filas;
}

export type Verificacion = {
  /** `null` = el PDF no trae saldo inicial y final: no se pudo comprobar. */
  cuadra: boolean | null;
  /** saldo inicial + movimientos − saldo final. 0 cuando cuadra. */
  diferencia: number | null;
  /** Filas cuyo saldo no sigue a la anterior más su movimiento. */
  saltosDeSaldo: number;
};

export function verificar(
  filas: FilaExtracto[],
  saldoInicial: number | null | undefined,
  saldoFinal: number | null | undefined,
): Verificacion {
  let saltos = 0;
  for (let i = 1; i < filas.length; i++) {
    const prev = filas[i - 1]!;
    const act = filas[i]!;
    if (prev.saldo == null || act.saldo == null) continue;
    if (Math.abs(r2(prev.saldo + act.monto) - act.saldo) > 0.01) saltos++;
  }
  if (saldoInicial == null || saldoFinal == null) {
    return { cuadra: null, diferencia: null, saltosDeSaldo: saltos };
  }
  const suma = filas.reduce((a, f) => a + f.monto, 0);
  const diferencia = r2(saldoInicial + suma - saldoFinal);
  return { cuadra: Math.abs(diferencia) < 0.01, diferencia, saltosDeSaldo: saltos };
}

const celda = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV de columnas fijas. Los nombres son los que la detección del wizard ya
 * reconoce sin preguntar: Fecha, Descripción, Referencia, Monto y Saldo.
 */
export function aCsv(filas: FilaExtracto[]): string {
  const lineas = ["Fecha,Descripcion,Referencia,Monto,Saldo"];
  for (const f of filas) {
    lineas.push([f.fecha, f.descripcion, f.referencia, f.monto.toFixed(2), f.saldo == null ? null : f.saldo.toFixed(2)].map(celda).join(","));
  }
  return lineas.join("\n") + "\n";
}

/** Páginas de un PDF, contadas por sus objetos `/Type /Page`. Aproximado pero suficiente para un tope. */
export function contarPaginas(bytes: Uint8Array): number {
  const texto = new TextDecoder("latin1").decode(bytes);
  return (texto.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

export const MAX_PAGINAS_PDF = 30;
export const MAX_BYTES_PDF = 10 * 1024 * 1024;

export const PROMPT_SISTEMA_PDF = [
  "Eres un asistente que transcribe estados de cuenta bancarios peruanos a datos.",
  "Lee el PDF adjunto y devuelve ÚNICAMENTE un JSON con esta forma:",
  '{"saldo_inicial": número o null, "saldo_final": número o null,',
  ' "movimientos": [{"fecha": "YYYY-MM-DD", "descripcion": "...", "referencia": "... o null",',
  ' "cargo": número o null, "abono": número o null, "saldo": número o null}],',
  ' "advertencia": "texto o null"}',
  "",
  "Reglas:",
  "- Transcribe TODOS los movimientos, en el orden del documento, sin resumir ni omitir ninguno.",
  "- Copia los importes tal como figuran: un cargo/débito/retiro en `cargo`, un abono/crédito/depósito en `abono`.",
  "  Ambos en positivo. No inventes signos ni importes.",
  "- `referencia`: el número de operación, documento o código que figure en la línea; null si no hay.",
  "- `saldo`: el saldo de esa línea si el documento lo muestra; si no, null.",
  "- Fechas en formato YYYY-MM-DD. Si el documento solo muestra día y mes, toma el año del período del estado de cuenta.",
  "- `saldo_inicial` y `saldo_final`: los del resumen del período (saldo anterior / saldo al cierre); null si no figuran.",
  "- No incluyas filas de totales, subtotales ni saldos arrastrados como movimientos.",
  "- Si el documento no es un estado de cuenta bancario o no se puede leer, devuelve movimientos vacío y explícalo en `advertencia`.",
].join("\n");
