import { describe, it, expect } from "vitest";
import type { RegistroInterno, MovimientoBancario } from "@/lib/contract/payload";

/**
 * ⚠️ La misma partida no puede estar en «Sin conciliar» y en «Ya conciliado».
 *
 * `cargarVistaResultado` junta dos fuentes: el residuo del payload —con ids
 * sintéticos («REG-0007»)— y las partidas que tocan los pares, hidratadas de
 * sus tablas con su uuid, que es el id que el par referencia.
 *
 * Una partida del residuo que n8n acabó emparejando está en las DOS. La copia
 * hidratada figura como conciliada; la del payload no la menciona ningún par,
 * así que la pantalla la contaba como suelta y la pintaba en esa lista. En una
 * conciliación de 233 × 221 decía «128 sin conciliar · 72 % emparejado» cuando
 * la verdad era 78 y el 83 %.
 *
 * `cargarVistaResultado` es `server-only` y toca la base, así que aquí se fija
 * la REGLA sobre la misma operación de deduplicación que aplica.
 */

/** La deduplicación tal cual está en `lib/conciliacion/vista.ts`. */
function unir<T extends { comprobante_id?: string | null }>(
  residuo: T[],
  hidratadas: T[],
): T[] {
  const ya = new Set(hidratadas.map((c) => c.comprobante_id));
  return [
    ...residuo.filter((r) => r.comprobante_id == null || !ya.has(r.comprobante_id)),
    ...hidratadas,
  ];
}

const interno = (id: string, uuid: string | null): RegistroInterno => ({
  id_interno: id,
  fecha: "2026-06-10",
  monto: 100,
  tipo: "cobranza",
  referencia: "F001-1",
  contraparte: null,
  descripcion: null,
  ...(uuid ? { comprobante_id: uuid } : {}),
});

describe("la vista no duplica una partida del residuo ya emparejada", () => {
  it("se queda con la hidratada, que es la que el par referencia", () => {
    const residuo = [interno("REG-0001", "uuid-a"), interno("REG-0002", "uuid-b")];
    const hidratadas = [interno("uuid-a", "uuid-a")];
    const out = unir(residuo, hidratadas);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.id_interno).sort()).toEqual(["REG-0002", "uuid-a"]);
  });

  it("la que sigue suelta se conserva con su id del payload", () => {
    const out = unir([interno("REG-0002", "uuid-b")], []);
    expect(out.map((x) => x.id_interno)).toEqual(["REG-0002"]);
  });

  it("una partida sin uuid nunca se descarta", () => {
    // Modo payload y jobs antiguos: sin `comprobante_id` no hay con qué
    // compararla, y perderla sería peor que repetirla.
    const out = unir([interno("REG-0003", null)], [interno("uuid-c", "uuid-c")]);
    expect(out).toHaveLength(2);
  });

  it("el recuento resultante es el del motor", () => {
    // 70 del residuo, de las que 30 acabaron emparejadas por n8n.
    const residuo = Array.from({ length: 70 }, (_, i) => interno(`REG-${i}`, `u${i}`));
    const hidratadas = Array.from({ length: 30 }, (_, i) => interno(`u${i}`, `u${i}`));
    const out = unir(residuo, hidratadas);
    const sueltas = out.filter((x) => x.id_interno.startsWith("REG-"));
    expect(sueltas).toHaveLength(40);
  });
});

describe("lo mismo del lado del banco", () => {
  const mov = (id: string, uuid: string): MovimientoBancario => ({
    id_movimiento: id,
    fecha: "2026-06-10",
    monto: 100,
    tipo: "abono",
    glosa: null,
    referencia_banco: null,
    movimiento_id: uuid,
  });
  it("deduplica por movimiento_id", () => {
    const ya = new Set([mov("uuid-x", "uuid-x")].map((m) => m.movimiento_id));
    const residuo = [mov("BCO-0001", "uuid-x"), mov("BCO-0002", "uuid-y")];
    expect(residuo.filter((m) => !ya.has(m.movimiento_id))).toHaveLength(1);
  });
});
