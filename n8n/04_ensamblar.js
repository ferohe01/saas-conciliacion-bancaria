// ── Ensamblar RESULTADO (§7.3) + cuadre de saldos ──────────────────────────
// Junta todos los matches, arma resumen y no_conciliados desde los pendientes,
// y calcula el cuadre bancario a partir de los saldos. Devuelve el cuerpo listo
// para el UPDATE a Supabase (un solo campo JSONB `resultado`).

const prev = $json;
const { job_id, metadata, total_internos, total_bancarios } = prev;
const matches = prev.matches ?? [];
const pendInt = prev.pendientes_internos ?? [];
const pendBanc = prev.pendientes_bancarios ?? [];

const cuenta = (m) => matches.filter((x) => x.metodo === m).length;

const no_conciliados = [
  ...pendInt.map((it) => ({
    id: it.id_interno,
    lado: 'interno',
    categoria: 'requiere_investigacion',
    sugerencia: it.monto >= 0 ? 'Posible depósito en tránsito' : 'Posible cheque no cobrado',
  })),
  ...pendBanc.map((bc) => ({
    id: bc.id_movimiento,
    lado: 'bancario',
    categoria: 'ajuste_requerido',
    sugerencia: 'Cargo/abono no registrado en libros',
  })),
];

// Cuadre bancario.
const saldos = metadata?.saldos ?? {};
const r2 = (n) => Number(Number(n).toFixed(2));
const saldoExtractoFinal = Number(saldos.saldo_extracto_final ?? 0);
const depositosEnTransito = pendInt.reduce((a, it) => a + (it.monto > 0 ? it.monto : 0), 0);
const chequesNoCobrados = pendInt.reduce((a, it) => a + (it.monto < 0 ? it.monto : 0), 0);
const cargosNoRegistrados = pendBanc.reduce((a, bc) => a + (bc.monto < 0 ? bc.monto : 0), 0);
const saldoBancoAjustado =
  saldoExtractoFinal + depositosEnTransito + chequesNoCobrados + cargosNoRegistrados;
const saldoLibros = Number(saldos.saldo_libros_final ?? 0);

const resultado = {
  resumen: {
    total_internos,
    total_bancarios,
    conciliados_exactos: cuenta('exacta'),
    conciliados_difusos: cuenta('difusa'),
    sugeridos_ia: cuenta('ia'),
    sin_conciliar_internos: pendInt.length,
    sin_conciliar_bancarios: pendBanc.length,
  },
  matches,
  no_conciliados,
  cuadre: {
    saldo_extracto_final: r2(saldoExtractoFinal),
    depositos_en_transito: r2(depositosEnTransito),
    cheques_no_cobrados: r2(chequesNoCobrados),
    cargos_no_registrados: r2(cargosNoRegistrados),
    saldo_banco_ajustado: r2(saldoBancoAjustado),
    saldo_libros_final: r2(saldoLibros),
    diferencia: r2(saldoBancoAjustado - saldoLibros),
  },
};

return [{
  json: {
    job_id,
    resultado_update: {
      estado: 'completado',
      fase_actual: 'ia',
      resultado,
      completed_at: new Date().toISOString(),
    },
  },
}];
