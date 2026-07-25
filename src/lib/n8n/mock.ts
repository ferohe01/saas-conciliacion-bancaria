import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { palabrasComunes } from "@/lib/matching/similitud";
import type { PayloadConciliacion } from "@/lib/contract/payload";
import type {
  ResultadoConciliacion,
  Match,
  PartidaNoConciliada,
  ResumenResultado,
} from "@/lib/contract/resultado";

/**
 * Simulador local de n8n (cuando N8N_MOCK=true). Reproduce el patrón asíncrono:
 * responde de inmediato (lo hace el endpoint) y luego actualiza el job por
 * fases escribiendo en Supabase con service_role, igual que haría n8n.
 *
 * ⚠️ Solo desarrollo. Usa setTimeout en el proceso del servidor (válido en el
 * server node de dev/self-hosted; no en serverless). El motor real vive en n8n.
 */

function diasEntre(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  return Math.abs((da - db) / 86_400_000);
}

/** Matcher simple: exacto por monto+fecha, difuso por tolerancia, algo de IA. */
function conciliar(payload: PayloadConciliacion): ResultadoConciliacion {
  const { registros_internos: internos, movimientos_bancarios: bancarios } =
    payload;
  const {
    tolerancia_monto_abs,
    tolerancia_dias,
    tolerancia_ia_monto,
    umbral_confianza_auto,
  } = payload.config;

  const intUsados = new Set<number>();
  const bancUsados = new Set<number>();
  const matches: Match[] = [];

  // 1) Exactos: mismo monto (redondeado) y fecha dentro de tolerancia.
  internos.forEach((it, i) => {
    for (let j = 0; j < bancarios.length; j++) {
      if (bancUsados.has(j)) continue;
      const bc = bancarios[j]!;
      if (
        Math.round(it.monto * 100) === Math.round(bc.monto * 100) &&
        diasEntre(it.fecha, bc.fecha) <= tolerancia_dias
      ) {
        matches.push({
          ids_internos: [it.id_interno],
          ids_movimientos: [bc.id_movimiento],
          metodo: "exacta",
          confianza: null,
          diferencia_monto: 0,
          categoria_diferencia: null,
          justificacion: null,
          estado_revision: "auto",
        });
        intUsados.add(i);
        bancUsados.add(j);
        break;
      }
    }
  });

  // 2) Difusos: diferencia de monto dentro de tolerancia, fecha cercana Y al
  //    menos una palabra en común entre la contraparte y la glosa.
  internos.forEach((it, i) => {
    if (intUsados.has(i)) return;
    for (let j = 0; j < bancarios.length; j++) {
      if (bancUsados.has(j)) continue;
      const bc = bancarios[j]!;
      const dif = it.monto - bc.monto;
      const comunes = palabrasComunes(it.contraparte, bc.glosa);
      if (
        Math.sign(it.monto) === Math.sign(bc.monto) &&
        Math.abs(dif) <= tolerancia_monto_abs &&
        diasEntre(it.fecha, bc.fecha) <= tolerancia_dias &&
        comunes.length >= 1
      ) {
        matches.push({
          ids_internos: [it.id_interno],
          ids_movimientos: [bc.id_movimiento],
          metodo: "difusa",
          confianza: null,
          diferencia_monto: Number(dif.toFixed(2)),
          categoria_diferencia:
            Math.abs(dif) > 0 ? "comision_bancaria" : null,
          justificacion:
            Math.abs(dif) > 0
              ? `Coincidencia por nombre (${comunes.join(", ")}); diferencia de ${dif.toFixed(2)} compatible con comisión bancaria.`
              : `Coincidencia por nombre (${comunes.join(", ")}).`,
          estado_revision: "auto",
        });
        intUsados.add(i);
        bancUsados.add(j);
        break;
      }
    }
  });

  // 3) IA: sugiere solo con señales fuertes — monto dentro de la banda IA
  //    (|dif| <= tolerancia_ia_monto) Y al menos 1 palabra en común entre la
  //    contraparte y la glosa. La fecha debe estar razonablemente cerca.
  internos.forEach((it, i) => {
    if (intUsados.has(i)) return;
    let mejorJ = -1;
    let mejorComunes: string[] = [];
    let mejorDif = Infinity;
    for (let j = 0; j < bancarios.length; j++) {
      if (bancUsados.has(j)) continue;
      const bc = bancarios[j]!;
      if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
      const dif = Math.abs(it.monto - bc.monto);
      if (dif > tolerancia_ia_monto) continue;
      if (diasEntre(it.fecha, bc.fecha) > tolerancia_dias + 4) continue;
      const comunes = palabrasComunes(it.contraparte, bc.glosa);
      if (comunes.length === 0) continue;
      // Preferir más palabras en común y menor diferencia de monto.
      if (
        comunes.length > mejorComunes.length ||
        (comunes.length === mejorComunes.length && dif < mejorDif)
      ) {
        mejorJ = j;
        mejorComunes = comunes;
        mejorDif = dif;
      }
    }
    if (mejorJ === -1) return;
    const bc = bancarios[mejorJ]!;
    const dif = Number((it.monto - bc.monto).toFixed(2));
    const cercania = 1 - Math.abs(dif) / tolerancia_ia_monto; // 0..1
    const confianza = Math.min(
      0.94,
      Number(
        (0.7 + cercania * 0.15 + Math.min(mejorComunes.length, 2) * 0.05).toFixed(2),
      ),
    );
    matches.push({
      ids_internos: [it.id_interno],
      ids_movimientos: [bc.id_movimiento],
      metodo: "ia",
      confianza,
      diferencia_monto: dif,
      categoria_diferencia: "requiere_revision",
      justificacion: `Coincidencia por nombre (${mejorComunes.join(", ")}) y monto cercano (dif. ${dif.toFixed(2)}).`,
      estado_revision: confianza >= umbral_confianza_auto ? "auto" : "pendiente",
    });
    intUsados.add(i);
    bancUsados.add(mejorJ);
  });

  // 4) No conciliados.
  const noConciliados: PartidaNoConciliada[] = [];
  internos.forEach((it, i) => {
    if (!intUsados.has(i)) {
      noConciliados.push({
        id: it.id_interno,
        lado: "interno",
        categoria: "requiere_investigacion",
        sugerencia:
          it.monto >= 0 ? "Posible depósito en tránsito" : "Posible cheque no cobrado",
      });
    }
  });
  bancarios.forEach((bc, j) => {
    if (!bancUsados.has(j)) {
      noConciliados.push({
        id: bc.id_movimiento,
        lado: "bancario",
        categoria: "ajuste_requerido",
        sugerencia: "Cargo/abono no registrado en libros",
      });
    }
  });

  const conciliados_exactos = matches.filter((m) => m.metodo === "exacta").length;
  const conciliados_difusos = matches.filter((m) => m.metodo === "difusa").length;
  const sugeridos_ia = matches.filter((m) => m.metodo === "ia").length;
  const sinInternos = noConciliados.filter((n) => n.lado === "interno").length;
  const sinBancarios = noConciliados.filter((n) => n.lado === "bancario").length;

  const resumen: ResumenResultado = {
    total_internos: internos.length,
    total_bancarios: bancarios.length,
    conciliados_exactos,
    conciliados_difusos,
    sugeridos_ia,
    sin_conciliar_internos: sinInternos,
    sin_conciliar_bancarios: sinBancarios,
  };

  // Cuadre bancario a partir de los saldos y las partidas en tránsito.
  const saldoExtractoFinal = payload.metadata.saldos.saldo_extracto_final ?? 0;
  const depositosEnTransito = noConciliados
    .filter((n) => n.lado === "interno")
    .reduce((acc, n) => {
      const it = internos.find((x) => x.id_interno === n.id);
      return acc + (it && it.monto > 0 ? it.monto : 0);
    }, 0);
  const chequesNoCobrados = noConciliados
    .filter((n) => n.lado === "interno")
    .reduce((acc, n) => {
      const it = internos.find((x) => x.id_interno === n.id);
      return acc + (it && it.monto < 0 ? it.monto : 0);
    }, 0);
  const cargosNoRegistrados = noConciliados
    .filter((n) => n.lado === "bancario")
    .reduce((acc, n) => {
      const bc = bancarios.find((x) => x.id_movimiento === n.id);
      return acc + (bc && bc.monto < 0 ? bc.monto : 0);
    }, 0);
  const saldoBancoAjustado =
    saldoExtractoFinal +
    depositosEnTransito +
    chequesNoCobrados +
    cargosNoRegistrados;
  const saldoLibros = payload.metadata.saldos.saldo_libros_final;

  return {
    resumen,
    matches,
    no_conciliados: noConciliados,
    cuadre: {
      saldo_extracto_final: Number(saldoExtractoFinal.toFixed(2)),
      depositos_en_transito: Number(depositosEnTransito.toFixed(2)),
      cheques_no_cobrados: Number(chequesNoCobrados.toFixed(2)),
      cargos_no_registrados: Number(cargosNoRegistrados.toFixed(2)),
      saldo_banco_ajustado: Number(saldoBancoAjustado.toFixed(2)),
      saldo_libros_final: Number(saldoLibros.toFixed(2)),
      diferencia: Number((saldoBancoAjustado - saldoLibros).toFixed(2)),
    },
  };
}

function resumenParcial(
  full: ResumenResultado,
  hasta: "exacta" | "difusa" | "ia",
): ResumenResultado {
  return {
    total_internos: full.total_internos,
    total_bancarios: full.total_bancarios,
    conciliados_exactos: full.conciliados_exactos,
    conciliados_difusos: hasta === "exacta" ? 0 : full.conciliados_difusos,
    sugeridos_ia: hasta === "ia" ? full.sugeridos_ia : 0,
    sin_conciliar_internos: 0,
    sin_conciliar_bancarios: 0,
  };
}

/** Dispara la simulación por fases (fire-and-forget). */
export function simularConciliacion(
  jobId: string,
  payload: PayloadConciliacion,
): void {
  const admin = createAdminClient();
  const resultado = conciliar(payload);
  const r = resultado.resumen;

  // El query builder de PostgREST solo se ejecuta al await/then; por eso se
  // envuelve en una IIFE async dentro de cada setTimeout.
  const set = (campos: Record<string, unknown>) => {
    void (async () => {
      const { error } = await admin
        .from("jobs_conciliacion")
        .update(campos)
        .eq("id", jobId);
      if (error) console.error("[mock n8n] update falló:", error.message);
    })();
  };

  setTimeout(
    () =>
      set({
        estado: "procesando",
        fase_actual: "exacta",
        resultado: { resumen: resumenParcial(r, "exacta") },
      }),
    700,
  );
  setTimeout(
    () =>
      set({
        fase_actual: "difusa",
        resultado: { resumen: resumenParcial(r, "difusa") },
      }),
    1700,
  );
  setTimeout(
    () =>
      set({
        fase_actual: "ia",
        resultado: { resumen: resumenParcial(r, "ia") },
      }),
    2700,
  );
  setTimeout(
    () =>
      set({
        estado: "completado",
        fase_actual: "ia",
        resultado,
        completed_at: new Date().toISOString(),
      }),
    3800,
  );
}
