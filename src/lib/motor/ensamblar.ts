import type {
  PartidaNoConciliada,
  ResultadoConciliacion,
} from "@/lib/contract/resultado";
import { calcularCuadre } from "@/lib/conciliacion/cuadre";
import type { Etapa } from "./tipos";

/**
 * Ensamblar el RESULTADO (§7.3) + cuadre de saldos.
 *
 * Junta todos los matches, arma resumen y no_conciliados desde los pendientes,
 * y calcula el cuadre. Es exactamente lo que el flujo de n8n escribía en
 * `jobs_conciliacion.resultado`, así que todo lo de después —la absorción a
 * `matches_conciliacion`, la pantalla, reportes y aprendizaje— no cambia.
 *
 * El cuadre sale de `calcularCuadre`, la MISMA función con la que el backend
 * cierra un job sin residuo. Antes eran dos implementaciones (una en JS para
 * n8n, otra en TS) vigiladas por un test para que no divergieran; ahora es una.
 */
export function ensamblarResultado(
  etapa: Etapa,
  totales: { internos: number; bancarios: number },
  saldos: { saldo_extracto_final?: number | null; saldo_libros_final?: number | null },
): ResultadoConciliacion {
  const { matches, pendientesInternos: pendInt, pendientesBancarios: pendBanc } = etapa;
  const cuenta = (m: string) => matches.filter((x) => x.metodo === m).length;

  const no_conciliados: PartidaNoConciliada[] = [
    ...pendInt.map((it) => ({
      id: it.id_interno,
      lado: "interno" as const,
      categoria: "requiere_investigacion" as const,
      sugerencia:
        it.monto >= 0 ? "Posible depósito en tránsito" : "Posible cheque no cobrado",
    })),
    ...pendBanc.map((bc) => ({
      id: bc.id_movimiento,
      lado: "bancario" as const,
      categoria: "ajuste_requerido" as const,
      sugerencia: "Cargo/abono no registrado en libros",
    })),
  ];

  // ⚠️ Las diferencias DENTRO de un par emparejado también son partidas
  // conciliatorias: un comprobante de 100 casado con un depósito de 80 deja 20
  // sin explicar, y ninguna de las dos partidas está "pendiente". Con la capa
  // exacta siempre es cero; la difusa, la IA y la agrupación no.
  const difEmparejadas = matches.reduce((a, m) => a + Number(m.diferencia_monto ?? 0), 0);

  return {
    resumen: {
      total_internos: totales.internos,
      total_bancarios: totales.bancarios,
      conciliados_exactos: cuenta("exacta"),
      conciliados_difusos: cuenta("difusa"),
      sugeridos_ia: cuenta("ia"),
      sin_conciliar_internos: pendInt.length,
      sin_conciliar_bancarios: pendBanc.length,
    },
    matches,
    no_conciliados,
    cuadre: calcularCuadre(saldos, pendInt, pendBanc, difEmparejadas),
  };
}
