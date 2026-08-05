import { z } from "zod";
import { Monto, Confianza } from "./primitives";
import {
  MetodoMatch,
  EstadoRevision,
  LadoPartida,
  CategoriaNoConciliado,
} from "./enums";

/**
 * Contrato de SALIDA: la estructura de `resultado` que escribe n8n y que la
 * interfaz consume (§7.3). Los matches referencian SOLO pares de IDs y
 * soportan uno-a-muchos y muchos-a-uno (por eso son arrays).
 */

export const ResumenResultado = z.object({
  total_internos: z.number().int().nonnegative(),
  total_bancarios: z.number().int().nonnegative(),
  conciliados_exactos: z.number().int().nonnegative(),
  conciliados_difusos: z.number().int().nonnegative(),
  sugeridos_ia: z.number().int().nonnegative(),
  sin_conciliar_internos: z.number().int().nonnegative(),
  sin_conciliar_bancarios: z.number().int().nonnegative(),
});
export type ResumenResultado = z.infer<typeof ResumenResultado>;

/**
 * Traza de una decisión humana sobre un match (materia prima del futuro ciclo
 * de aprendizaje: no se pierde ninguna). La escribe el backend, no n8n.
 */
export const DecisionHumana = z.object({
  usuario_id: z.string().min(1),
  accion: EstadoRevision, // aceptado | rechazado | modificado | ...
  timestamp: z.string().datetime(),
  nota: z.string().nullable().optional(),
  /**
   * Por qué se rechazó (código de `lib/motivosRechazo.ts`). Es la señal más
   * informativa del ciclo: "rechazado" dice que la IA se equivocó, el motivo
   * dice EN QUÉ.
   *
   * Opcional y sin `enum` a propósito: las decisiones guardadas antes de que
   * esto existiera no lo traen, y validar contra una lista cerrada haría que
   * un código retirado en el futuro **impidiera leer resultados antiguos**.
   */
  motivo: z.string().nullable().optional(),
});
export type DecisionHumana = z.infer<typeof DecisionHumana>;

export const Match = z.object({
  ids_internos: z.array(z.string().min(1)),
  ids_movimientos: z.array(z.string().min(1)),
  metodo: MetodoMatch,
  confianza: Confianza.nullable().optional(),
  diferencia_monto: Monto.nullable().optional(),
  categoria_diferencia: z.string().nullable().optional(),
  justificacion: z.string().nullable().optional(),
  estado_revision: EstadoRevision,
  // Historial de decisiones humanas (añadido por el backend en cada revisión).
  decisiones: z.array(DecisionHumana).optional(),
  /**
   * Marcado como "no aprendas de aquí". Se guarda junto al match y no en una
   * tabla aparte porque el `resultado` completo se reescribe entero en cada
   * decisión: la marca viaja con el dato al que se refiere y sobrevive igual.
   *
   * NO borra la decisión ni cambia la conciliación: solo lo saca del pool de
   * ejemplos. Lo que se decidió, decidido está.
   */
  excluido_aprendizaje: z.boolean().optional(),
});
export type Match = z.infer<typeof Match>;

export const PartidaNoConciliada = z.object({
  id: z.string().min(1),
  lado: LadoPartida,
  categoria: CategoriaNoConciliado,
  sugerencia: z.string().nullable().optional(),
});
export type PartidaNoConciliada = z.infer<typeof PartidaNoConciliada>;

export const Cuadre = z.object({
  saldo_extracto_final: Monto,
  depositos_en_transito: Monto,
  cheques_no_cobrados: Monto,
  cargos_no_registrados: Monto,
  saldo_banco_ajustado: Monto,
  saldo_libros_final: Monto,
  diferencia: Monto,
});
export type Cuadre = z.infer<typeof Cuadre>;

export const ResultadoConciliacion = z.object({
  resumen: ResumenResultado,
  matches: z.array(Match),
  no_conciliados: z.array(PartidaNoConciliada),
  cuadre: Cuadre,
});
export type ResultadoConciliacion = z.infer<typeof ResultadoConciliacion>;

/**
 * Resultado parcial que n8n puede ir escribiendo durante el procesamiento
 * para alimentar la pantalla de progreso (conteos por fase). Todos los campos
 * son opcionales porque el resultado se construye incrementalmente.
 */
export const ResultadoParcial = ResumenResultado.partial();
export type ResultadoParcial = z.infer<typeof ResultadoParcial>;
