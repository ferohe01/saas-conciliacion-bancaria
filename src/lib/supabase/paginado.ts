/**
 * PostgREST devuelve como mucho 1.000 filas por petición, y **no avisa**: un
 * `select` sin rango sobre 20.000 comprobantes devuelve 1.000 y un 200 OK.
 *
 * Eso mordió de verdad: `getComprobantesCanonicos` mandaba 1.000 de 20.000
 * registros al motor, así que la conciliación cubría el 5% del mes sin que
 * nada lo dijera. Se detectó porque el Paso 3 mostraba "1.000" al lado de
 * "20.000" del extracto — un número mal pintado destapó una conciliación
 * incompleta.
 *
 * ⚠️ El tope es configuración del servidor (`db-max-rows`), no del cliente: no
 * se puede subir desde aquí. La única salida correcta es paginar.
 */

/** Tamaño de página de PostgREST. Si el servidor bajara el suyo, esto sigue
 *  funcionando: se detiene cuando una página vuelve incompleta. */
const PAGINA = 1000;

/** Tope de seguridad: 100.000 filas son 100 peticiones. Más que eso es un
 *  error de uso, no un caso legítimo, y conviene que falle a la vista. */
const TOPE_FILAS = 100_000;

type Respuesta<T> = { data: T[] | null; error: unknown };

/**
 * Trae TODAS las filas de una consulta, paginando.
 *
 * @param consulta recibe el rango y debe aplicarlo con `.range(desde, hasta)`.
 *
 *     const filas = await traerTodo<Fila>((desde, hasta) =>
 *       supabase.from("comprobantes").select("id, monto").range(desde, hasta),
 *     );
 */
export async function traerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>,
  tope = TOPE_FILAS,
): Promise<T[]> {
  const salida: T[] = [];

  for (let desde = 0; desde < tope; desde += PAGINA) {
    const { data, error } = await consulta(desde, desde + PAGINA - 1);
    if (error) break;
    const lote = data ?? [];
    salida.push(...lote);
    // Página incompleta = no hay más. Evita una petición de más por consulta.
    if (lote.length < PAGINA) break;
  }

  return salida;
}

/**
 * Trocea una lista de ids para usarla en `.in(...)`.
 *
 * Un `.in()` con 20.000 ids no falla por el límite de filas sino por la
 * longitud de la URL: PostgREST los recibe como query string y el proxy la
 * corta mucho antes. El síntoma es un 414 o, peor, un filtro truncado.
 *
 * ⚠️ El tamaño por defecto es 100 **porque los ids son UUID**: 36 caracteres
 * cada uno. Con 500 la query string se iba a ~19.500 caracteres, muy por encima
 * del límite habitual de nginx/kong (8.192), y "Empezar de cero" fallaba con un
 * escueto "No se pudieron borrar los comprobantes". 100 deja la URL en ~3.900.
 */
export function enLotes<T>(items: T[], tamano = 100): T[][] {
  if (items.length === 0) return [];
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano));
  }
  return lotes;
}
