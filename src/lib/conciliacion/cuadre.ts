import type { Cuadre } from "@/lib/contract/resultado";

/**
 * El cuadre bancario, calculado en la aplicación.
 *
 * Es el MISMO cálculo que hace `n8n/04_ensamblar.js`, y existe aquí porque en
 * el modo tabla (parte B) puede no llegar a ejecutarse n8n: si la capa exacta
 * en SQL casa todo, o si uno de los dos lados se queda sin residuo, no hay nada
 * que el motor pueda aportar y el backend cierra el job por su cuenta.
 *
 * ⚠️ Los pares CONCILIADOS no entran en el cuadre, sean 400.000 o cero: por
 * definición están en los dos lados y se cancelan. Solo cuentan las partidas
 * que quedaron sueltas, y por eso esta función solo necesita el residuo — que
 * es justo lo que la hace viable a este volumen.
 *
 * La fórmula, con la convención de signos única (abonos +, cargos −):
 *
 *     banco ajustado = saldo extracto
 *                    + pendientes de LIBROS  (el extracto aún no los refleja)
 *                    − pendientes del BANCO  (el extracto ya los incluye)
 *
 * Ver la nota larga de CLAUDE.md § "El cuadre bancario": los del banco se
 * RESTAN, y omitir los abonos o sumarlos con el signo cambiado impedía que el
 * cuadre cerrara aunque todo estuviera explicado.
 */

const r2 = (n: number) => Number(n.toFixed(2));

export function calcularCuadre(
  saldos: {
    saldo_extracto_final?: number | null;
    saldo_libros_final?: number | null;
  },
  pendientesInternos: { monto: number }[],
  pendientesBancarios: { monto: number }[],
): Cuadre {
  const saldoExtracto = Number(saldos.saldo_extracto_final ?? 0);
  const saldoLibros = Number(saldos.saldo_libros_final ?? 0);

  const suma = (xs: { monto: number }[], signo: 1 | -1) =>
    xs.reduce((a, x) => a + (signo > 0 ? Math.max(x.monto, 0) : Math.min(x.monto, 0)), 0);

  const depositosEnTransito = suma(pendientesInternos, 1);
  const chequesNoCobrados = suma(pendientesInternos, -1);
  const abonosNoRegistrados = suma(pendientesBancarios, 1);
  const cargosNoRegistrados = suma(pendientesBancarios, -1);

  const saldoBancoAjustado =
    saldoExtracto +
    depositosEnTransito +
    chequesNoCobrados -
    abonosNoRegistrados -
    cargosNoRegistrados;

  return {
    saldo_extracto_final: r2(saldoExtracto),
    depositos_en_transito: r2(depositosEnTransito),
    cheques_no_cobrados: r2(chequesNoCobrados),
    abonos_no_registrados: r2(abonosNoRegistrados),
    cargos_no_registrados: r2(cargosNoRegistrados),
    saldo_banco_ajustado: r2(saldoBancoAjustado),
    saldo_libros_final: r2(saldoLibros),
    diferencia: r2(saldoBancoAjustado - saldoLibros),
  };
}
