import type { PayloadConciliacion } from "@/lib/contract/payload";
import type { ResultadoConciliacion } from "@/lib/contract/resultado";
import { capaExacta } from "./exacta";
import { capaDifusa } from "./difusa";
import { capaAgrupacion } from "./agrupacion";
import { prepararIa } from "./candidatosIa";
import { adjudicarIa } from "./adjudicarIa";
import { ensamblarResultado } from "./ensamblar";
import type { ConfigMotor } from "./tipos";

/**
 * El motor de conciliación, entero y dentro de la aplicación.
 *
 *     Exacta → Difusa → Agrupación → Candidatos IA → LLM → Adjudicar → Ensamblar
 *
 * Es el mismo orden y la misma lógica que el flujo «Conciliación Bancaria con
 * IA» de n8n, que deja de existir: cada capa era un nodo Code y ahora es una
 * función pura en `src/lib/motor/`, con tipos y con tests.
 *
 * Es puro salvo por lo que se le inyecta: la llamada al modelo (para poder
 * probarlo sin red y con la IA caída) y el aviso de cambio de fase (para que
 * la pantalla de progreso vea avanzar las capas).
 */

export type FaseMotor = "exacta" | "difusa" | "agrupacion" | "ia";

/**
 * Pregunta al modelo y devuelve su texto, o `null` si no contestó. No lanza:
 * un fallo de la IA no puede tumbar la conciliación.
 */
export type ConsultarIa = (system: string, user: string) => Promise<string | null>;

export type TrazaMotor = {
  /** Registros que se le preguntaron al modelo. */
  consultadasIa: number;
  /** Registros con candidato que NO se le preguntaron (tope de consultas). */
  omitidasIa: number;
  /** Si se llamó al modelo y contestó. `null` = no hubo nada que preguntar o no hay IA. */
  iaRespondio: boolean | null;
};

export async function ejecutarMotor(
  payload: PayloadConciliacion,
  opciones: {
    consultarIa?: ConsultarIa | null;
    alEntrarEnFase?: (fase: FaseMotor) => Promise<void> | void;
  } = {},
): Promise<{ resultado: ResultadoConciliacion; traza: TrazaMotor }> {
  const config = payload.config as ConfigMotor;
  const fase = async (f: FaseMotor) => {
    await opciones.alEntrarEnFase?.(f);
    // Cede el turno entre capas: cada una es síncrona y, a volumen, ocupa el
    // proceso unos cientos de milisegundos. Así el servidor sigue atendiendo a
    // los demás usuarios mientras alguien concilia.
    await new Promise((r) => setImmediate(r));
  };

  await fase("exacta");
  let etapa = capaExacta(payload.registros_internos, payload.movimientos_bancarios);

  await fase("difusa");
  etapa = capaDifusa(etapa, config);

  await fase("agrupacion");
  etapa = capaAgrupacion(etapa, config);

  await fase("ia");
  const prep = prepararIa(
    etapa,
    config,
    payload.ejemplos_aprendizaje ?? [],
    payload.criterios_declarados ?? [],
  );
  let iaRespondio: boolean | null = null;
  // Sin shortlists no hay nada que adjudicar: no se paga una consulta vacía.
  if (prep.shortlists.length > 0 && opciones.consultarIa) {
    const respuesta = await opciones.consultarIa(prep.system, prep.user);
    iaRespondio = respuesta !== null;
    etapa = adjudicarIa(etapa, prep.shortlists, respuesta, config);
  }

  const resultado = ensamblarResultado(
    etapa,
    {
      internos: payload.registros_internos.length,
      bancarios: payload.movimientos_bancarios.length,
    },
    payload.metadata.saldos,
  );

  return {
    resultado,
    traza: {
      consultadasIa: prep.shortlists.length,
      omitidasIa: prep.shortlistsOmitidas,
      iaRespondio,
    },
  };
}
