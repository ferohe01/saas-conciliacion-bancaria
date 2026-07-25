// ── Capa 3: SUGERENCIAS (heurística tipo IA) ───────────────────────────────
// Placeholder de la capa de IA: sugiere pares restantes con mismo signo y
// fecha cercana, con un score de confianza. Las sugerencias por debajo del
// umbral quedan 'pendiente' (revisión humana en la app); por encima, 'auto'.
//
// 👉 Para IA real: reemplaza este nodo por un AI Agent / LLM que reciba
//    pendientes_internos y pendientes_bancarios y devuelva pares con
//    { ids_internos, ids_movimientos, confianza, justificacion }. El resto del
//    flujo (ensamblar + UPDATE) queda igual.

const prev = $json;
const { job_id, metadata, config, total_internos, total_bancarios } = prev;
const matches = [...prev.matches];
const internos = prev.pendientes_internos ?? [];
const bancarios = prev.pendientes_bancarios ?? [];

const tolDias = Number(config?.tolerancia_dias ?? 0);
const umbral = Number(config?.umbral_confianza_auto ?? 0.95);
const MAX_SUGERENCIAS = 5;

const dias = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

const bancUsado = new Set();
const intUsado = new Set();
let sugeridas = 0;

internos.forEach((it, i) => {
  if (sugeridas >= MAX_SUGERENCIAS) return;
  for (let j = 0; j < bancarios.length; j++) {
    if (bancUsado.has(j)) continue;
    const bc = bancarios[j];
    if (Math.sign(it.monto) !== Math.sign(bc.monto)) continue;
    if (dias(it.fecha, bc.fecha) <= tolDias + 4) {
      const confianza = 0.85;
      matches.push({
        ids_internos: [it.id_interno],
        ids_movimientos: [bc.id_movimiento],
        metodo: 'ia',
        confianza,
        diferencia_monto: Number((it.monto - bc.monto).toFixed(2)),
        categoria_diferencia: 'requiere_revision',
        justificacion: `Posible correspondencia por fecha y monto similares (${it.contraparte ?? 'contraparte'} ↔ ${bc.glosa ?? 'glosa'}).`,
        estado_revision: confianza >= umbral ? 'auto' : 'pendiente',
      });
      intUsado.add(i);
      bancUsado.add(j);
      sugeridas++;
      break;
    }
  }
});

return [{
  json: {
    job_id,
    metadata,
    config,
    total_internos,
    total_bancarios,
    matches,
    pendientes_internos: internos.filter((_, i) => !intUsado.has(i)),
    pendientes_bancarios: bancarios.filter((_, j) => !bancUsado.has(j)),
  },
}];
