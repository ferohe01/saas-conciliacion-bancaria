"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  guardarConexion,
  eliminarConexion,
  type ConexionResultado,
} from "@/app/(app)/conexiones/actions";
import {
  SISTEMAS_ERP,
  FRECUENCIAS,
  estadoConexion,
  nombreSistema,
  type ConexionErp,
} from "@/lib/conexiones";
import { Boton, Campo, Tarjeta, CLASES_ENTRADA } from "@/components/ui";

const ESTADO_INICIAL: ConexionResultado = { ok: false };

/** Lo que hace falta para que podamos preparar la conexión, en su idioma. */
type Requisito = { label: string; cumplido: boolean; porque: string };

export function ConexionForm({ conexion }: { conexion: ConexionErp | null }) {
  const router = useRouter();
  const [estado, formAction, pendiente] = useActionState(
    guardarConexion,
    ESTADO_INICIAL,
  );
  const [borrando, startBorrar] = useTransition();

  // El formulario se controla lo mínimo: solo lo que cambia la pantalla.
  const [sistema, setSistema] = useState(conexion?.sistema ?? "");
  const [nombreOtro, setNombreOtro] = useState(conexion?.nombre_sistema ?? "");
  const [url, setUrl] = useState(conexion?.url_base ?? "");
  const [contacto, setContacto] = useState(conexion?.contacto ?? "");
  const [prueba, setPrueba] = useState(false);

  const esOtro = sistema === "otro";
  const errorDe = (campo: string) =>
    estado.campo === campo ? estado.error : null;

  const requisitos: Requisito[] = [
    {
      label: "Sabemos en qué sistema emites",
      cumplido: sistema !== "" && (!esOtro || nombreOtro.trim() !== ""),
      porque: "Es lo que decide por dónde empezamos.",
    },
    {
      label: "Tenemos con quién coordinar",
      cumplido: contacto.trim() !== "",
      porque:
        "La integración se acuerda con quien administra ese sistema, que casi nunca eres tú.",
    },
    {
      label: "Sabemos dónde vive su API",
      cumplido: url.trim() !== "",
      porque: "Opcional: si no la conoces, la buscamos nosotros.",
    },
  ];

  function quitar() {
    startBorrar(async () => {
      await eliminarConexion();
      setSistema("");
      setNombreOtro("");
      setUrl("");
      setContacto("");
      setPrueba(false);
      router.refresh();
    });
  }

  const e = conexion ? estadoConexion(conexion.estado) : null;

  return (
    <div className="space-y-5">
      {/* La promesa honesta va ARRIBA y sin adornos. Una pantalla titulada
          "Conectar tu sistema" hace suponer que al guardar algo empieza a
          traerse; no empieza nada, y enterarse tres semanas después —cuando
          faltan los comprobantes— sería el mismo error silencioso que nos hizo
          retirar "Subir archivo" del wizard. */}
      <Tarjeta tono="atencion">
        <h2 className="font-semibold text-amber-900">
          Todavía no está disponible
        </h2>
        <p className="mt-1 max-w-prose text-sm text-amber-900">
          Estamos construyendo estas conexiones. Aquí puedes dejarnos los datos
          de tu sistema para que preparemos la tuya y te avisemos cuando puedas
          usarla. <strong>Nada se sincroniza todavía</strong>: mientras tanto,
          concilia con tus comprobantes como hasta ahora.
        </p>
      </Tarjeta>

      {e && (
        <Tarjeta tono={e.tono === "exito" ? "cuadre" : "neutro"}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-semibold text-neutral-900">
              {nombreSistema(conexion!)}
            </h2>
            {/* El estado no se codifica solo con color: lleva su palabra. */}
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700">
              {e.label}
            </span>
          </div>
          <p className="mt-1.5 max-w-prose text-sm text-neutral-600">
            {e.descripcion}
          </p>
        </Tarjeta>
      )}

      <form action={formAction} className="space-y-5">
        <Tarjeta>
          <h2 className="font-semibold text-neutral-900">Tu sistema</h2>
          <p className="mt-0.5 max-w-prose text-sm text-neutral-600">
            Dónde emites tus facturas y boletas hoy.
          </p>

          <div className="mt-5 space-y-5">
            <Campo
              label="Sistema de facturación"
              name="sistema"
              error={errorDe("sistema")}
              ayuda="Si usas varios, elige el que emite la mayoría de tus comprobantes."
            >
              {(p) => (
                <select
                  {...p}
                  required
                  value={sistema}
                  onChange={(ev) => setSistema(ev.target.value)}
                >
                  <option value="">Elige tu sistema…</option>
                  {SISTEMAS_ERP.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                      {s.nota ? ` · ${s.nota}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </Campo>

            {esOtro && (
              <Campo
                label="¿Cuál?"
                name="nombre_sistema"
                error={errorDe("nombre_sistema")}
                ayuda="El nombre tal como lo conoces. Nos sirve para buscarlo."
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    maxLength={120}
                    value={nombreOtro}
                    onChange={(ev) => setNombreOtro(ev.target.value)}
                    placeholder="Mi Facturador SAC"
                  />
                )}
              </Campo>
            )}

            <Campo
              label="Dirección de su API"
              name="url_base"
              nota="opcional"
              error={errorDe("url_base")}
              ayuda="Si no la sabes, déjalo vacío: lo averiguamos con tu proveedor. Debe empezar por https://"
            >
              {(p) => (
                <input
                  {...p}
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(ev) => setUrl(ev.target.value)}
                  placeholder="https://api.tusistema.com"
                />
              )}
            </Campo>

            <Campo
              label="Tu usuario o código de cliente"
              name="identificador"
              nota="opcional"
              error={errorDe("identificador")}
              ayuda="Cómo te identifica ese sistema (RUC, usuario, código). No escribas aquí ninguna contraseña."
            >
              {(p) => (
                <input
                  {...p}
                  type="text"
                  maxLength={300}
                  defaultValue={conexion?.identificador ?? ""}
                  autoComplete="off"
                />
              )}
            </Campo>
          </div>
        </Tarjeta>

        {/* Por qué el formulario NO pide la clave: ver 0017_conexiones_erp.sql.
            Decirlo en pantalla evita además que alguien la escriba en "notas". */}
        <Tarjeta>
          <h2 className="font-semibold text-neutral-900">
            No te pedimos tu contraseña
          </h2>
          <p className="mt-1 max-w-prose text-sm text-neutral-600">
            En este formulario no escribas claves, tokens ni API keys: no las
            guardamos. Cuando la conexión esté lista te pediremos la credencial
            por un canal seguro, y solo entonces.
          </p>
        </Tarjeta>

        <Tarjeta>
          <h2 className="font-semibold text-neutral-900">Cómo la usarías</h2>
          <p className="mt-0.5 max-w-prose text-sm text-neutral-600">
            Nos ayuda a dimensionarla. Podrás cambiarlo cuando esté activa.
          </p>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-neutral-700">
              Cada cuánto traeríamos tus comprobantes
            </legend>
            <div className="mt-2 space-y-2">
              {FRECUENCIAS.map((f) => (
                <label
                  key={f.id}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 p-3 transition-colors hover:bg-neutral-50 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-500"
                >
                  <input
                    type="radio"
                    name="frecuencia"
                    value={f.id}
                    defaultChecked={(conexion?.frecuencia ?? "diaria") === f.id}
                    className="mt-1 h-4 w-4 accent-blue-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-neutral-800">
                      {f.label}
                    </span>
                    <span className="block text-sm text-neutral-600">
                      {f.descripcion}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-5 space-y-5">
            <Campo
              label="Con quién coordinamos"
              name="contacto"
              error={errorDe("contacto")}
              ayuda="Correo o teléfono de quien administra ese sistema (tu proveedor, tu contador o tú)."
            >
              {(p) => (
                <input
                  {...p}
                  type="text"
                  maxLength={300}
                  value={contacto}
                  onChange={(ev) => setContacto(ev.target.value)}
                  placeholder="soporte@tuproveedor.com"
                />
              )}
            </Campo>

            <Campo
              label="Algo más que debamos saber"
              name="notas"
              nota="opcional"
              error={errorDe("notas")}
            >
              {(p) => (
                <textarea
                  {...p}
                  rows={3}
                  maxLength={1000}
                  defaultValue={conexion?.notas ?? ""}
                  placeholder="Emitimos unas 300 facturas al mes; el sistema lo lleva un proveedor externo."
                  className={`${CLASES_ENTRADA} h-auto py-2`}
                />
              )}
            </Campo>
          </div>
        </Tarjeta>

        {/* "Probar conexión" sin motor solo puede hacer una cosa honesta:
            revisar lo que sí depende del usuario y decir con todas las letras
            que la prueba de verdad no existe todavía. Un tilde verde falso
            aquí valdría una llamada de soporte por cada cliente. */}
        <Tarjeta>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-neutral-900">Probar conexión</h2>
              <p className="mt-0.5 max-w-prose text-sm text-neutral-600">
                Revisa si nos falta algo para poder prepararla.
              </p>
            </div>
            <Boton
              type="button"
              variante="secundario"
              tamano="sm"
              onClick={() => setPrueba(true)}
            >
              Probar
            </Boton>
          </div>

          {prueba && (
            <div aria-live="polite" className="mt-4 space-y-3">
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                No podemos conectarnos a tu sistema todavía: la sincronización
                no está construida. Esto es lo que sí pudimos revisar.
              </p>
              <ul className="space-y-2">
                {requisitos.map((r) => (
                  <li key={r.label} className="flex items-start gap-2 text-sm">
                    <span
                      aria-hidden
                      className={`mt-0.5 shrink-0 ${r.cumplido ? "text-emerald-700" : "text-neutral-400"}`}
                    >
                      {r.cumplido ? "✓" : "○"}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-neutral-800">
                        {r.cumplido ? r.label : `Falta: ${r.label.toLowerCase()}`}
                      </span>
                      <span className="block text-neutral-600">{r.porque}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Tarjeta>

        <div aria-live="polite">
          {estado.error && !estado.campo && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {estado.error}
            </p>
          )}
          {estado.ok && (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Guardado. Te escribiremos para preparar tu conexión. Hasta
              entonces nada se sincroniza y tus conciliaciones siguen igual.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {conexion ? (
            <Boton
              type="button"
              variante="secundario"
              onClick={quitar}
              disabled={borrando}
            >
              {borrando ? "Quitando…" : "Quitar conexión"}
            </Boton>
          ) : (
            <span />
          )}
          <Boton type="submit" tamano="lg" disabled={pendiente}>
            {pendiente
              ? "Guardando…"
              : conexion
                ? "Guardar cambios"
                : "Quiero conectar mi sistema"}
          </Boton>
        </div>
      </form>
    </div>
  );
}
