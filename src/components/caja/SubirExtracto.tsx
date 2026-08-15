"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Boton } from "@/components/ui";

/**
 * Subir el extracto del mes en curso PARA VER EL SALDO, sin conciliarlo.
 *
 * ⚠️ Va con `origen=caja`, y esa etiqueta es lo que hace posible todo el
 * módulo: `lote_id` es un uuid suelto y los lotes de wizards abandonados se
 * acumulan sin que nadie los borre, así que «el último lote sin job» dejaría
 * que un intento a medias mandara sobre la caja.
 *
 * ⚠️ No hay paso de mapeo aquí: se usa el formato que la cuenta aprendió
 * conciliando. Elegir columnas es la decisión que más se equivoca —y el error
 * no se ve, sale un 0 %—, así que se hace una vez mirando la previsualización
 * del wizard. Si la cuenta no tiene formato guardado, el servidor lo dice y
 * manda allí en vez de adivinar.
 */
export function SubirExtracto({
  cuentaId,
  etiqueta = "Actualizar con el extracto de hoy",
}: {
  cuentaId: string;
  etiqueta?: string;
}) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [, startTransition] = useTransition();

  async function subir(archivo: File) {
    setError(null);
    setAviso(null);
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.set("archivo", archivo);
      fd.set("cuenta_id", cuentaId);
      fd.set("origen", "caja");
      // El mapeo lo resuelve el servidor desde el formato guardado de la cuenta.
      fd.set("mapeo", "{}");

      const res = await fetch("/api/extracto/importar", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        insertados?: number;
        fecha_max?: string | null;
        saldo_final?: number | null;
      };
      if (!res.ok) {
        setError(data.error ?? "No se pudo leer el extracto.");
        return;
      }
      // El saldo declarado es lo que hace que la cifra sea del banco y no un
      // cálculo nuestro: si el archivo no lo trae, conviene decirlo aquí y no
      // que el usuario lo deduzca de una etiqueta pequeña.
      setAviso(
        data.saldo_final == null
          ? `Se leyeron ${(data.insertados ?? 0).toLocaleString("es-PE")} movimientos. Este archivo no trae columna de saldo, así que el saldo de hoy se calcula sumando sobre tu última conciliación aprobada.`
          : `Se leyeron ${(data.insertados ?? 0).toLocaleString("es-PE")} movimientos.`,
      );
      startTransition(() => router.refresh());
    } catch {
      setError("No se pudo subir el archivo. Revisa tu conexión y vuelve a intentarlo.");
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={entrada}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        aria-label="Archivo del extracto bancario"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void subir(f);
        }}
      />
      <Boton
        variante="secundario"
        tamano="sm"
        disabled={subiendo}
        onClick={() => entrada.current?.click()}
      >
        {subiendo ? "Leyendo el extracto…" : etiqueta}
      </Boton>

      {error && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}{" "}
          <Link href="/wizard" className="font-medium underline">
            Ir a conciliar
          </Link>
        </p>
      )}
      {aviso && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {aviso}
        </p>
      )}
    </div>
  );
}
