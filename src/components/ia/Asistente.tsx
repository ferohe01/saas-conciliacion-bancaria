"use client";

import { useState } from "react";
import { Boton, CLASES_ENTRADA } from "@/components/ui";
import { MAX_PREGUNTA, MAX_TURNOS, type Mensaje } from "@/lib/ia/prompts";
import { TextoIa } from "./TextoIa";

/**
 * El asistente, encima de un análisis que ya está en pantalla.
 *
 * ── Lo que aporta, y lo que NO ─────────────────────────────────────────────
 *
 * Va SIEMPRE debajo de un panel determinístico que ya dice todo lo importante.
 * El asistente sintetiza («de estas cinco cosas, la que importa es esta») y
 * responde repreguntas. Si falla, se pierde un extra: el contenido sigue ahí.
 *
 * Ese orden es deliberado. Un asistente que fuera la única fuente convertiría
 * cualquier fallo del modelo en una pantalla sin información — y en un producto
 * donde el error caro es "el número plausible y equivocado", la explicación
 * generada nunca puede ser lo único que se ve.
 *
 * ⚠️ **Se pide al pulsar, no al cargar.** Cada llamada cuesta dinero y la
 * mayoría de las veces el panel basta. Que sea el usuario quien decida si vale
 * la pena preguntarle.
 */

export type Preguntar = (
  historial: Mensaje[],
  pregunta?: string,
) => Promise<{ ok: true; texto: string } | { ok: false; error: string }>;

export function Asistente({
  preguntar,
  etiqueta = "¿Qué significa esto?",
  compacto = false,
}: {
  preguntar: Preguntar;
  etiqueta?: string;
  /** Versión reducida, para caber dentro de la ficha de una partida. */
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnos, setTurnos] = useState<Mensaje[]>([]);
  const [pregunta, setPregunta] = useState("");

  const agotado = turnos.filter((m) => m.role === "user").length >= MAX_TURNOS;

  async function lanzar(texto?: string) {
    setCargando(true);
    setError(null);
    // La pregunta se pinta ya: esperar sin ver lo que preguntaste desorienta.
    const previos: Mensaje[] = texto
      ? [...turnos, { role: "user", content: texto }]
      : turnos;
    if (texto) setTurnos(previos);

    try {
      const r = await preguntar(turnos, texto);
      if (r.ok) {
        setTurnos([...previos, { role: "assistant", content: r.texto }]);
      } else {
        setError(r.error);
      }
    } catch {
      setError("No se pudo contactar con el asistente.");
    } finally {
      setCargando(false);
    }
  }

  function abrir() {
    if (abierto) {
      setAbierto(false);
      return;
    }
    setAbierto(true);
    if (turnos.length === 0 && !cargando) void lanzar();
  }

  const texto = compacto ? "text-xs" : "text-sm";

  return (
    <div className={compacto ? "mt-2" : "mt-3"}>
      <button
        type="button"
        onClick={abrir}
        aria-expanded={abierto}
        className={`rounded font-medium text-blue-700 underline underline-offset-2 transition-colors hover:text-blue-800 ${texto}`}
      >
        {abierto ? "Ocultar" : etiqueta}
      </button>

      {abierto && (
        <div
          className={`mt-2 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 ${texto}`}
        >
          <ul className="space-y-2">
            {turnos.map((m, i) => (
              <li
                key={i}
                className={
                  m.role === "user"
                    ? "font-medium text-neutral-900"
                    : "text-neutral-800"
                }
              >
                {m.role === "user" ? (
                  `Tú: ${m.content}`
                ) : (
                  <TextoIa>{m.content}</TextoIa>
                )}
              </li>
            ))}
          </ul>

          {cargando && (
            <p className="mt-2 text-neutral-600">Pensando…</p>
          )}

          {error && (
            <p role="alert" className="mt-2 text-red-800">
              {error}
            </p>
          )}

          {/* Repreguntas. Acotadas al análisis que se está viendo: el asistente
              no puede consultar nada más, y por eso no promete saberlo todo. */}
          {turnos.length > 0 && !agotado && (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const q = pregunta.trim();
                if (!q || cargando) return;
                setPregunta("");
                void lanzar(q);
              }}
            >
              <input
                value={pregunta}
                onChange={(e) => setPregunta(e.target.value)}
                maxLength={MAX_PREGUNTA}
                placeholder="Pregunta algo sobre esto…"
                aria-label="Pregunta sobre este análisis"
                className={`${CLASES_ENTRADA} h-10 flex-1 !text-sm`}
              />
              <Boton
                type="submit"
                tamano="sm"
                variante="secundario"
                disabled={cargando || pregunta.trim() === ""}
              >
                Preguntar
              </Boton>
            </form>
          )}

          {agotado && (
            <p className="mt-2 text-neutral-600">
              Hasta aquí llega esta conversación. El asistente solo conoce este
              análisis; para otra cosa, ciérrala y abre la que te interese.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
