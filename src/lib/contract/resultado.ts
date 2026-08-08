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

/**
 * Cuadre bancario.
 *
 * Las cuatro partidas de ajuste llevan el signo de la convención única del
 * sistema (abonos +, cargos −) y se combinan así:
 *
 *     banco ajustado = extracto
 *                    + (pendientes de LIBROS: depósitos en tránsito + cheques)
 *                    − (pendientes del BANCO: abonos + cargos no registrados)
 *
 * Los pendientes de libros se SUMAN porque el extracto todavía no los refleja;
 * los del banco se RESTAN porque el extracto ya los incluye y los libros no.
 * Cuando toda diferencia es una partida conocida, `diferencia` da 0.
 */
export const Cuadre = z.object({
  saldo_extracto_final: Monto,
  depositos_en_transito: Monto,
  cheques_no_cobrados: Monto,
  /**
   * Abonos que el banco registró y los libros no. `default(0)` y no requerido:
   * los resultados guardados antes de que existiera este renglón no lo traen, y
   * exigirlo dejaría ilegible todo el histórico. Cero es además el valor
   * honesto para ellos — no se recalculan hacia atrás.
   */
  abonos_no_registrados: Monto.default(0),
  cargos_no_registrados: Monto,
  /**
   * Suma de las diferencias de importe DENTRO de los pares emparejados.
   *
   * Un comprobante de 100 casado con un depósito de 80 deja 20 sin explicar, y
   * ninguna de las dos partidas está "pendiente", así que ese hueco se escapaba
   * del cuadre. Con la capa exacta siempre es cero —casa por importe idéntico—
   * y por eso tardó en verse: hizo falta una conciliación de 452.177 partidas
   * donde UN par de la IA con 20 soles descuadró el total.
   *
   * `default(0)`: los resultados guardados antes no lo traen. Ver
   * `abonos_no_registrados`.
   */
  diferencias_emparejadas: Monto.default(0),
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
