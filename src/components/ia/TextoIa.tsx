import { segmentar } from "@/lib/ia/formato";

/**
 * Pinta la respuesta del modelo respetando sus marcas de énfasis.
 *
 * ⚠️ Sin `dangerouslySetInnerHTML`. El texto viene de un modelo: convertirlo en
 * marcado sería darle una vía para inyectar lo que quiera en la página. Aquí
 * cada segmento se pinta como un elemento de React, así que lo peor que puede
 * pasar es que una marca rara se vea literal.
 *
 * Los saltos de línea los conserva `whitespace-pre-wrap` del contenedor.
 */
export function TextoIa({ children }: { children: string }) {
  return (
    <span className="whitespace-pre-wrap">
      {segmentar(children).map((s, i) => {
        if (s.tipo === "fuerte") {
          return (
            <strong key={i} className="font-semibold">
              {s.texto}
            </strong>
          );
        }
        if (s.tipo === "codigo") {
          return (
            <code
              key={i}
              className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.9em] text-neutral-800"
            >
              {s.texto}
            </code>
          );
        }
        return <span key={i}>{s.texto}</span>;
      })}
    </span>
  );
}
