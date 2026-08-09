/**
 * Formato del texto que devuelve el modelo.
 *
 * Los modelos escriben en Markdown por costumbre, así que una respuesta llegaba
 * a pantalla como `**Comprobantes**` con los asteriscos a la vista. Se podría
 * pedir en el prompt que no los use, pero eso es una esperanza y no un control
 * —el mismo motivo por el que las cifras se verifican en vez de solo pedirlas—:
 * tarde o temprano vuelve a hacerlo.
 *
 * ⚠️ **Se devuelven segmentos, no HTML.** Nada de `dangerouslySetInnerHTML`: el
 * texto viene de un modelo, y convertirlo en marcado sería darle una vía para
 * inyectar lo que quiera en la página. Aquí lo peor que puede pasar es que un
 * asterisco no se ponga en negrita.
 *
 * Solo dos marcas, las que de verdad aparecen:
 *   **negrita**   → resaltar una pantalla o una cifra
 *   `código`      → nombres de columna o de archivo
 *
 * Deliberadamente NO se interpreta el asterisco simple: "3 * 4" es aritmética,
 * y una lista con `- ` ya se lee bien tal cual gracias a `whitespace-pre-wrap`.
 */

export type Segmento = {
  tipo: "texto" | "fuerte" | "codigo";
  texto: string;
};

/** `**negrita**` o `` `código` ``, sin permitir que crucen líneas en blanco. */
const MARCAS = /\*\*([^*]+?)\*\*|`([^`]+?)`/g;

export function segmentar(entrada: string): Segmento[] {
  const out: Segmento[] = [];
  let ultimo = 0;

  for (const m of entrada.matchAll(MARCAS)) {
    const i = m.index ?? 0;
    if (i > ultimo) {
      out.push({ tipo: "texto", texto: entrada.slice(ultimo, i) });
    }
    if (m[1] !== undefined) {
      out.push({ tipo: "fuerte", texto: m[1] });
    } else if (m[2] !== undefined) {
      out.push({ tipo: "codigo", texto: m[2] });
    }
    ultimo = i + m[0].length;
  }

  if (ultimo < entrada.length) {
    out.push({ tipo: "texto", texto: entrada.slice(ultimo) });
  }

  // Un texto vacío devuelve lista vacía; quien lo pinta no tiene que
  // distinguir ese caso de "no hay respuesta".
  return out;
}
