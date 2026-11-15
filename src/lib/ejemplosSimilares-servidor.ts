import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { enLotes } from "@/lib/supabase/paginado";
import type { EjemploAprendizaje } from "@/lib/contract/payload";
import type { Shortlist } from "@/lib/motor/candidatosIa";
import {
  claveEjemplo,
  seleccionarEjemplos,
  textoConsulta,
  textoEjemplo,
  type Vecino,
} from "@/lib/ejemplosSimilares";

/**
 * Elige los ejemplos de aprendizaje más parecidos a los casos de esta corrida
 * (pgvector, 0059).
 *
 * 1. Calcula el embedding de las decisiones del pool que aún no lo tienen y lo
 *    guarda: cada decisión se convierte en vector UNA sola vez.
 * 2. Calcula el de los casos que se le van a preguntar al modelo.
 * 3. Una sola llamada a `ejemplos_similares` trae los 3 vecinos de cada caso.
 *
 * ⚠️ Nunca lanza. Devuelve `null` si no hay clave, si la 0059 no está aplicada
 * o si algo falla, y el motor usa entonces los ejemplos recientes de siempre:
 * una mejora no puede tumbar la conciliación.
 */

const MODELO = () => process.env.OPENAI_MODEL_EMBEDDINGS || "text-embedding-3-small";
const LOTE_EMBEDDINGS = 256;
const VECINOS_POR_CASO = 3;

const hash = (s: string) => createHash("sha1").update(s).digest("hex");
/** Seis decimales bastan para la distancia y reducen a la mitad lo que viaja. */
const comoTexto = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(",")}]`;

async function embeddings(textos: string[]): Promise<number[][] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const salida: number[][] = [];
  for (let i = 0; i < textos.length; i += LOTE_EMBEDDINGS) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODELO(), input: textos.slice(i, i + LOTE_EMBEDDINGS) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.error("[similares] embeddings respondió", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const ordenados = [...(data.data ?? [])].sort((a, b) => a.index - b.index);
    salida.push(...ordenados.map((d) => d.embedding));
  }
  return salida.length === textos.length ? salida : null;
}

export async function elegirEjemplosSimilares(
  empresaId: string,
  pool: EjemploAprendizaje[],
  shortlists: Shortlist[],
): Promise<EjemploAprendizaje[] | null> {
  try {
    if (!process.env.OPENAI_API_KEY || pool.length === 0 || shortlists.length === 0) return null;
    const admin = createAdminClient();

    // 1. Los que todavía no tienen vector.
    const conClave = pool.map((e) => ({ e, clave: hash(claveEjemplo(e)) }));
    const existentes = new Set<string>();
    for (const lote of enLotes(conClave.map((x) => x.clave))) {
      const { data, error } = await admin
        .from("ejemplos_vectoriales")
        .select("clave")
        .eq("empresa_id", empresaId)
        .in("clave", lote);
      if (error) {
        console.error("[similares] no se pudo leer ejemplos_vectoriales (¿falta la 0059?):", error.message);
        return null;
      }
      for (const f of data ?? []) existentes.add(f.clave as string);
    }
    const faltan = conClave.filter((x) => !existentes.has(x.clave));
    if (faltan.length > 0) {
      const vectores = await embeddings(faltan.map((x) => textoEjemplo(x.e)));
      if (!vectores) return null;
      for (let i = 0; i < faltan.length; i += 100) {
        const filas = faltan.slice(i, i + 100).map((x, j) => ({
          empresa_id: empresaId,
          clave: x.clave,
          decision: x.e.decision,
          interno: x.e.interno,
          banco: x.e.banco,
          categoria: x.e.categoria ?? null,
          motivo: x.e.motivo ?? null,
          embedding: comoTexto(vectores[i + j]!),
        }));
        const { error } = await admin.from("ejemplos_vectoriales").upsert(filas);
        if (error) {
          console.error("[similares] no se pudo guardar embeddings:", error.message);
          return null;
        }
      }
    }

    // 2 y 3. Los casos de esta corrida y sus vecinos, en una llamada.
    const consultas = await embeddings(shortlists.map(textoConsulta));
    if (!consultas) return null;
    const { data, error } = await admin.rpc("ejemplos_similares", {
      p_empresa: empresaId,
      p_consultas: consultas.map(comoTexto),
      p_k: VECINOS_POR_CASO,
    });
    if (error) {
      console.error("[similares] ejemplos_similares falló:", error.message);
      return null;
    }
    const elegidos = seleccionarEjemplos((data ?? []) as Vecino[]);
    return elegidos.length > 0 ? elegidos : null;
  } catch (e) {
    console.error("[similares] fallo inesperado:", e);
    return null;
  }
}
