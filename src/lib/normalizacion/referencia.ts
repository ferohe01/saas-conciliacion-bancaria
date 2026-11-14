/**
 * La referencia de emparejamiento, en su forma canónica.
 *
 * ── Por qué existe este módulo ─────────────────────────────────────────────
 *
 * La misma normalización estuvo escrita CUATRO veces —`ref_norm` en SQL, dos
 * copias en los nodos de n8n y una en `diagnosticoPartida.ts`— y todas tenían
 * que decir exactamente lo mismo: si divergen, un par casa en SQL y no en el
 * motor, o al revés, y **la diferencia es invisible**. Con el motor dentro de
 * la app (`src/lib/motor`) quedan dos: esta, que importan el motor y el
 * diagnóstico, y `ref_norm` en SQL. `tests/referencia.test.ts` vigila las dos.
 *
 * ── El prefijo de entidad ──────────────────────────────────────────────────
 *
 * Encontrado con datos reales: el mismo recibo aparece como
 * `WIN-S001-11618954` en el mayor del cliente y como `S001-11618954` en el
 * extracto del banco. Es LA MISMA operación, pero como cadenas son distintas,
 * así que la capa exacta no las casaba y esos 276 recibos caían al residuo
 * —donde tampoco casaban— y de ahí a "sin conciliar", sin que nada explicara
 * por qué.
 *
 * La regla: **se descarta un primer segmento hecho SOLO de letras** (el nombre
 * de la entidad que emite: `WIN-`, `PA-`), y solo cuando lo que queda sigue
 * pareciendo un código de documento.
 *
 * ⚠️ Las tres condiciones del `if` no son adorno; cada una tapa un falso
 * positivo concreto:
 *
 *   · **letras Y dígitos en el resto** — sin esto, `F001-123` se quedaría en
 *     `123`, y `A-123` y `B-123` pasarían a ser la misma referencia. Un número
 *     pelado no identifica nada.
 *   · **≥ 6 caracteres útiles** — una clave corta colisiona con cualquier cosa.
 *   · **primer segmento sin dígitos** — `SR11-02748951` (la serie normal de
 *     este cliente, 452.317 filas) no se toca: `SR11` lleva números, así que no
 *     es un nombre de entidad. Era la condición decisiva para no mover lo que
 *     ya funcionaba.
 *
 * ⚠️⚠️ **Esto NO puede romper un emparejamiento que antes funcionaba.** Es una
 * función aplicada a los dos lados por igual: si dos referencias eran iguales
 * antes, sus formas canónicas siguen siéndolo. Lo único que puede pasar es que
 * aparezcan pares NUEVOS — los que colisionen tras quitar el prefijo—, y por
 * eso las condiciones son restrictivas y el emparejamiento sigue exigiendo
 * además el mismo importe al céntimo.
 */

/** Mayúsculas y sin separadores: la parte que nunca cambió. */
const limpiar = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Un primer segmento de solo letras seguido de separador. */
const PREFIJO_ENTIDAD = /^[A-Za-z]+[-_/ ]+/;

/** Mínimo de caracteres útiles que tiene que conservar el resto. */
const MINIMO_UTIL = 6;

export function normRef(referencia: unknown): string {
  const s = String(referencia ?? "").trim();
  if (s === "") return "";

  const resto = s.replace(PREFIJO_ENTIDAD, "");
  if (
    resto !== s &&
    /[A-Za-z]/.test(resto) &&
    /[0-9]/.test(resto) &&
    limpiar(resto).length >= MINIMO_UTIL
  ) {
    return limpiar(resto);
  }
  return limpiar(s);
}
