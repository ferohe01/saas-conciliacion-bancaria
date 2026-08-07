import { describe, it, expect } from "vitest";
import {
  saludDelJob,
  bloqueaRelanzamiento,
  minutosDesde,
  MINUTOS_LENTO,
  MINUTOS_DETENIDO,
} from "@/lib/jobsAtascados";

const ahora = new Date("2026-08-07T12:00:00Z");
const haceMinutos = (m: number) =>
  new Date(ahora.getTime() - m * 60000).toISOString();

describe("saludDelJob", () => {
  it("un job recién lanzado es normal", () => {
    expect(saludDelJob("procesando", haceMinutos(1), ahora)).toBe("normal");
  });

  it("pasa a lento y luego a detenido", () => {
    expect(saludDelJob("procesando", haceMinutos(MINUTOS_LENTO), ahora)).toBe("lento");
    expect(saludDelJob("procesando", haceMinutos(MINUTOS_DETENIDO), ahora)).toBe("detenido");
  });

  it("vale igual para `pendiente`", () => {
    // El caso de "entrega incierta": n8n no confirmó y el job se queda en
    // pendiente. Si nunca lo recibió, se cuelga exactamente igual.
    expect(saludDelJob("pendiente", haceMinutos(45), ahora)).toBe("detenido");
  });

  it("un job terminado NUNCA se declara detenido, por viejo que sea", () => {
    // Lo contrario pintaría de rojo todo el historial: un job de hace un año
    // lleva un año "sin avanzar", y es que ya terminó.
    expect(saludDelJob("completado", haceMinutos(60 * 24 * 365), ahora)).toBe("normal");
    expect(saludDelJob("error", haceMinutos(60 * 24 * 365), ahora)).toBe("normal");
  });

  it("una fecha ilegible no declara nada detenido", () => {
    // Sin dato fiable la respuesta honesta es "no lo sé", y "no lo sé" no puede
    // acabar en un cartel que diga que la conciliación falló.
    expect(minutosDesde("no es una fecha", ahora)).toBe(0);
    expect(saludDelJob("procesando", "no es una fecha", ahora)).toBe("normal");
  });

  it("los umbrales dejan margen de sobra sobre lo medido", () => {
    // Corridas reales: 68.571 partidas en 23–34 s. Si alguien bajara el umbral
    // a menos de dos minutos, empezaría a llamar "detenidas" a las que van bien.
    expect(MINUTOS_LENTO).toBeGreaterThanOrEqual(2);
    expect(MINUTOS_DETENIDO).toBeGreaterThan(MINUTOS_LENTO);
  });
});

describe("bloqueaRelanzamiento", () => {
  it("un job en vuelo reserva su período", () => {
    // Es para lo que existe la idempotencia: dos clics no crean dos jobs.
    expect(bloqueaRelanzamiento("procesando", haceMinutos(2), ahora)).toBe(true);
    expect(bloqueaRelanzamiento("pendiente", haceMinutos(2), ahora)).toBe(true);
  });

  it("deja de reservarlo cuando se da por detenido", () => {
    // Nadie hace doble clic media hora después: pasado el umbral la reserva ya
    // no protege de nada y solo encierra al usuario en un período que no puede
    // relanzar.
    expect(bloqueaRelanzamiento("procesando", haceMinutos(MINUTOS_DETENIDO), ahora)).toBe(false);
  });

  it("un job terminado no reserva nada", () => {
    // Si lo hiciera, un período solo podría conciliarse una vez en la vida.
    expect(bloqueaRelanzamiento("completado", haceMinutos(1), ahora)).toBe(false);
    expect(bloqueaRelanzamiento("error", haceMinutos(1), ahora)).toBe(false);
  });
});
