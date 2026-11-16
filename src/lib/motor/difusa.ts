import type { MovimientoBancario } from "@/lib/contract/payload";
import { diferencia, palabras } from "./texto";
import { MS_DIA, type ConfigMotor, type Etapa } from "./tipos";

/**
 * Capa 2: conciliación DIFUSA (tolerancias + coincidencia de nombre).
 *
 * Concilia por cercanía de monto y fecha, EXIGIENDO además al menos una
 * palabra en común entre la contraparte (interno) y la glosa (banco).
 * Diferencia de monto tolerada = max(tolerancia_monto_abs, |monto|·pct).
 * Fecha tolerada = tolerancia_dias.
 *
 * ⚠️ Solo se concilia SOLO el par de importe idéntico. Con diferencia, el
 * motor SUPONE una comisión bancaria, pero 100 contra 97 también puede ser un
 * pago incompleto del cliente — y al aprobar, el comprobante quedaría parcial
 * con 3 pendientes sin que nadie lo decidiera. Ese par se PROPONE (`pendiente`)
 * y va a «Por revisar», como los pagos parciales de la IA.
 * `revisar_toda_difusa` manda también los de importe idéntico a revisión.
 *
 * ⚠️ Nada que dependa de un solo lado se calcula dentro del bucle del otro.
 * Tokenizar la misma glosa una vez por cada registro interno eran 400 millones
 * de `normalize` + regex + Set a 20.000 × 20.000 (en n8n abortaba el runner a
 * los 30 s; aquí bloquearía el servidor). Se precalcula y se indexa por monto
 * redondeado: medido, de abortar a 493 ms.
 */
export function capaDifusa(prev: Etapa, config: ConfigMotor): Etapa {
  const matches = [...prev.matches];
  const internos = prev.pendientesInternos;
  const bancarios = prev.pendientesBancarios;

  const tolAbs = Number(config.tolerancia_monto_abs ?? 0);
  const tolPct = Number(config.tolerancia_monto_pct ?? 0);
  const tolDias = Number(config.tolerancia_dias ?? 0);
  const revisarTodo = config.revisar_toda_difusa === true;

  const bancUsado = new Set<number>();
  const intUsado = new Set<number>();

  // Precálculo: cada glosa se tokeniza UNA vez.
  const bancPrep: { bc: MovimientoBancario; t: number; pal: Set<string> }[] =
    bancarios.map((bc) => ({
      bc,
      t: Date.parse(bc.fecha),
      pal: new Set(palabras(bc.glosa)),
    }));

  // Índice por monto redondeado a soles. La tolerancia acota la banda, así que
  // solo hay que mirar unos pocos cubos en vez de todos los movimientos.
  const cubos = new Map<number, number[]>();
  bancPrep.forEach((b, j) => {
    const k = Math.round(b.bc.monto);
    const lista = cubos.get(k);
    if (lista) lista.push(j);
    else cubos.set(k, [j]);
  });

  internos.forEach((it, i) => {
    const tol = Math.max(tolAbs, Math.abs(it.monto) * (tolPct / 100));
    const tIt = Date.parse(it.fecha);
    const palIt = palabras(it.contraparte);
    if (palIt.length === 0) return; // sin nombre no hay match difuso posible

    // Candidatos por banda de monto. Se ordenan por índice para conservar el
    // mismo emparejamiento que el recorrido secuencial: gana el movimiento más
    // antiguo de la lista, no el del cubo que toque antes.
    const desde = Math.round(it.monto - tol) - 1;
    const hasta = Math.round(it.monto + tol) + 1;
    const candidatos: number[] = [];
    for (let k = desde; k <= hasta; k++) {
      const lista = cubos.get(k);
      if (lista) for (const j of lista) if (!bancUsado.has(j)) candidatos.push(j);
    }
    candidatos.sort((a, b) => a - b);

    for (const j of candidatos) {
      const { bc, t, pal } = bancPrep[j]!;
      if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
      const dif = diferencia(it.monto, bc.monto);
      if (Math.abs(dif) > tol) continue;
      if (Math.abs((tIt - t) / MS_DIA) > tolDias) continue;
      const comunes = [...new Set(palIt.filter((w) => pal.has(w)))];
      if (comunes.length === 0) continue; // exige coincidencia de nombre
      const conDiferencia = Math.abs(dif) > 0;
      matches.push({
        ids_internos: [it.id_interno],
        ids_movimientos: [bc.id_movimiento],
        metodo: "difusa",
        confianza: null,
        diferencia_monto: dif,
        categoria_diferencia: conDiferencia ? "comision_bancaria" : null,
        justificacion: conDiferencia
          ? `Coincidencia por nombre (${comunes.join(", ")}); diferencia de ${dif.toFixed(2)}: puede ser una comisión bancaria o un pago incompleto, confírmalo.`
          : `Coincidencia por nombre (${comunes.join(", ")}).`,
        estado_revision: conDiferencia || revisarTodo ? "pendiente" : "auto",
      });
      intUsado.add(i);
      bancUsado.add(j);
      break;
    }
  });

  return {
    matches,
    pendientesInternos: internos.filter((_, i) => !intUsado.has(i)),
    pendientesBancarios: bancarios.filter((_, j) => !bancUsado.has(j)),
  };
}
