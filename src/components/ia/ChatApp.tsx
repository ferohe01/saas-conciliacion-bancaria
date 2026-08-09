"use client";

import { useEffect, useRef, useState } from "react";
import {
  preguntarAlAsistente,
  type RespuestaAsistente,
} from "@/app/(app)/asistente/actions";
import type { Mensaje } from "@/lib/ia/prompts";
import { MAX_PREGUNTA } from "@/lib/ia/prompts";
import { Boton, CLASES_ENTRADA, Tarjeta } from "@/components/ui";

/**
 * El chat general de la app.
 *
 * ⚠️ **Empieza con sugerencias, no con un campo vacío.** Un chat en blanco le
 * traslada al usuario el trabajo de adivinar qué sabe responder, y la primera
 * pregunta que se le ocurre a cualquiera («¿cuánto facturé el año pasado?»)
 * suele ser justo la que no puede. Las sugerencias son el contrato: esto es lo
 * que sé hacer.
 *
 * ⚠️ **Se dice qué consultó.** Una cifra sin sitio donde comprobarla es una
 * cifra que hay que creerse, y este producto no puede pedir eso.
 */

const SUGERENCIAS = [
  "¿Cuánto me deben en total?",
  "¿Quién me debe más y desde cuándo?",
  "¿Cuánto tengo vencido por cobrar?",
  "¿Cuánto le debo a mis proveedores?",
  "¿Cómo va mi última conciliación?",
  "¿Tengo conciliaciones sin aprobar?",
  "¿Por qué mi conciliación salió tan baja?",
  "¿Cómo cargo mis facturas?",
];

/** Nombres legibles de las consultas, para poder decir de dónde salió el dato. */
const NOMBRE_CONSULTA: Record<string, string> = {
  cuentas_por_cobrar: "Por cobrar",
  cuentas_por_pagar: "Por pagar",
  situacion_general: "Resumen del período",
  ultimas_conciliaciones: "Conciliaciones",
  estado_de_cuenta: "Estado de la cuenta",
};

type Turno = Mensaje & { consultas?: string[] };

export function ChatApp({ disponible }: { disponible: boolean }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnos, cargando]);

  async function enviar(pregunta: string) {
    const q = pregunta.trim();
    if (q === "" || cargando) return;
    setError(null);
    setTexto("");
    // La pregunta se pinta ya: esperar sin ver lo que preguntaste desorienta.
    const previos: Turno[] = [...turnos, { role: "user", content: q }];
    setTurnos(previos);
    setCargando(true);
    try {
      const r: RespuestaAsistente = await preguntarAlAsistente(
        turnos.map(({ role, content }) => ({ role, content })),
        q,
      );
      if (r.ok) {
        setTurnos([
          ...previos,
          { role: "assistant", content: r.texto, consultas: r.consultas },
        ]);
      } else {
        setError(r.error);
      }
    } catch {
      setError("No se pudo contactar con el asistente.");
    } finally {
      setCargando(false);
    }
  }

  if (!disponible) {
    return (
      <Tarjeta>
        <p className="text-sm text-neutral-700">
          El asistente no está configurado en este despliegue. El resto del
          sistema funciona igual.
        </p>
      </Tarjeta>
    );
  }

  return (
    <div className="space-y-4">
      <div className="min-h-[16rem] space-y-3">
        {turnos.length === 0 && !cargando && (
          <Tarjeta>
            <p className="text-sm text-neutral-700">
              Pregúntame por tus cobros, tus pagos o tus conciliaciones. Consulto
              tus datos reales y te digo en qué pantalla comprobarlo.
            </p>
            <p className="mt-2 text-sm text-neutral-600">
              No puedo hacer cambios: no apruebo, no concilio y no borro nada.
            </p>
          </Tarjeta>
        )}

        <ul className="space-y-3">
          {turnos.map((m, i) => (
            <li
              key={i}
              className={
                m.role === "user"
                  ? "ml-auto max-w-prose rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm text-white"
                  : "max-w-prose rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800"
              }
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.consultas && m.consultas.length > 0 && (
                <p className="mt-2 border-t border-neutral-100 pt-2 text-xs text-neutral-500">
                  Consultado en:{" "}
                  {m.consultas
                    .map((c) => NOMBRE_CONSULTA[c] ?? c)
                    .join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>

        {cargando && (
          <p className="text-sm text-neutral-600">Consultando tus datos…</p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        <div ref={finRef} />
      </div>

      {turnos.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGERENCIAS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void enviar(s)}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(texto);
        }}
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={MAX_PREGUNTA}
          placeholder="Escribe tu pregunta…"
          aria-label="Pregunta para el asistente"
          className={`${CLASES_ENTRADA} h-12 flex-1`}
        />
        <Boton type="submit" tamano="lg" disabled={cargando || texto.trim() === ""}>
          Preguntar
        </Boton>
      </form>
    </div>
  );
}
