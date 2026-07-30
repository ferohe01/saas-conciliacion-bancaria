/**
 * Fase A — cerrar el bucle: del resultado de la conciliación de vuelta al
 * comprobante.
 *
 * El `resultado` que devuelve n8n solo referencia IDs. Para saber qué factura
 * quedó cobrada hay que volver al `payload_entrada` del job, que es donde vive
 * el puente `id_interno → comprobante_id`.
 *
 * Función pura: aquí se decide cuánto dinero se le descuenta a cada factura, y
 * eso tiene que ser verificable sin base de datos delante.
 */

export type RegistroPayload = {
  id_interno: string;
  monto: number;
  comprobante_id?: string | null;
};

export type MovimientoPayload = {
  id_movimiento: string;
  monto: number;
};

export type MatchLite = {
  ids_internos: string[];
  ids_movimientos: string[];
  estado_revision?: string | null;
};

export type Aplicacion = {
  comprobante_id: string;
  id_movimiento: string;
  monto_aplicado: number;
};

/**
 * Estados en los que un emparejamiento **se sostiene** y por tanto descuenta
 * saldo. Los valores son los de `EstadoRevision` del contrato.
 *
 *  - `auto`: lo concilió el motor dentro de las tolerancias de la empresa
 *    (exacta, difusa, o IA por encima de `umbral_confianza_auto`). Cuenta:
 *    exigir un clic humano en cada match exacto vaciaría de sentido el
 *    producto — la conciliación automática ES la función.
 *  - `aceptado` / `modificado`: una persona lo confirmó.
 *
 * Fuera quedan `pendiente` (espera criterio humano) y `rechazado` (lo negó).
 *
 * ⚠️ Esta lista se leyó del enum y se verificó contra lo que emiten los nodos
 * de n8n (`01_exacta.js`, `02_difusa.js`, `03_ia.js`). La primera versión la
 * dedujo de los nombres y omitió `auto`: el resultado fue que 29 de 33 pares
 * conciliados no descontaban nada.
 */
export const ESTADOS_CONFIRMADOS = ["auto", "aceptado", "modificado"] as const;

export function estaConfirmado(m: MatchLite): boolean {
  return (ESTADOS_CONFIRMADOS as readonly string[]).includes(
    m.estado_revision ?? "",
  );
}

const abs = (n: number) => Math.abs(Number(n) || 0);
const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Traduce los matches confirmados en aplicaciones de cobro.
 *
 * **Cuánto se aplica.** Se reparte lo que de verdad entró por banco, en
 * proporción al peso de cada comprobante dentro del match:
 *
 *     aplicado = |monto del registro| × min(1, total_banco / total_registros)
 *
 * Con eso salen bien los tres casos reales sin tratarlos por separado:
 *  - 1:1 exacto → se aplica el importe completo
 *  - pago parcial (entró menos que la factura) → queda saldo pendiente
 *  - agrupación 1:N (un depósito cubre varias facturas) → cada una su parte
 *
 * El factor se limita a 1: si entró de más (una comisión a favor, un redondeo)
 * no se le "cobra" a la factura más de lo que vale.
 */
export function calcularAplicaciones(
  matches: MatchLite[],
  registros: RegistroPayload[],
  movimientos: MovimientoPayload[],
): Aplicacion[] {
  const porRegistro = new Map(registros.map((r) => [r.id_interno, r]));
  const porMovimiento = new Map(movimientos.map((m) => [m.id_movimiento, m]));
  const salida: Aplicacion[] = [];

  for (const m of matches) {
    if (!estaConfirmado(m)) continue;

    const regs = m.ids_internos
      .map((id) => porRegistro.get(id))
      .filter((r): r is RegistroPayload => !!r?.comprobante_id);

    // Un match sin comprobantes detrás (la fuente fue un Excel suelto) no
    // tiene nada que actualizar. No es un error.
    if (regs.length === 0) continue;

    const totalRegistros = regs.reduce((s, r) => s + abs(r.monto), 0);
    if (totalRegistros === 0) continue;

    const totalBanco = m.ids_movimientos.reduce(
      (s, id) => s + abs(porMovimiento.get(id)?.monto ?? 0),
      0,
    );

    // Sin datos del movimiento (p. ej. un extracto en PDF, que procesa n8n y
    // no viaja en el payload) se asume cobro completo: es lo que la persona
    // acaba de confirmar mirando ambos lados.
    const factor =
      totalBanco > 0 ? Math.min(1, totalBanco / totalRegistros) : 1;

    // Clave estable del conjunto de movimientos que pagó: hace la operación
    // idempotente contra la restricción única de la tabla.
    const clave = [...m.ids_movimientos].sort().join("+") || "sin-movimiento";

    for (const r of regs) {
      const monto = redondear(abs(r.monto) * factor);
      if (monto <= 0) continue;
      salida.push({
        comprobante_id: r.comprobante_id!,
        id_movimiento: clave,
        monto_aplicado: monto,
      });
    }
  }

  return salida;
}
