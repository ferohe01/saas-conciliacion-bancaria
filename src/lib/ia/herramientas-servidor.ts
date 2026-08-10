import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getEmpresaActual } from "@/lib/auth";
import { traerResumenSaldos } from "@/lib/comprobantesSaldo";
import { getResumenEjecutivo } from "@/lib/resumenEjecutivo-servidor";
import { posicionNeta, porcentajeAutomatizado } from "@/lib/resumenEjecutivo";
import { estadoSuscripcion } from "@/lib/suscripcion";
import { TRAMOS, type ResumenAging, type TipoSaldo } from "@/lib/aging";
import { FILTRO_SALDO_VACIO } from "@/lib/filtrosSaldo";
import {
  herramientaValida,
  TOPE_CONTRAPARTES,
  TOPE_CONCILIACIONES,
} from "./herramientas";

/**
 * Ejecución de las herramientas del asistente (solo servidor).
 *
 * ⚠️⚠️ **Ninguna acepta `empresa_id`.** Todas usan el cliente de sesión, así que
 * la empresa sale de `auth.uid()` por RLS o por las funciones `security
 * definer`. Un `empresa_id` que llegara desde fuera sería un `?empresa_id=` en
 * manos de cualquiera — y aquí "fuera" incluye al propio modelo, que compone
 * los argumentos.
 *
 * ⚠️ **Ninguna escribe.** El asistente consulta; no aprueba, no concilia, no
 * borra. Una acción destructiva disparada por una frase mal entendida no tiene
 * arreglo, y la conveniencia no compensa.
 *
 * ⚠️ **La salida es texto compacto y ACOTADO**, y es también la lista de cifras
 * contra la que se verifica la respuesta (`verificacion.ts`). Por eso las listas
 * llevan tope: si creciera con los datos del cliente, volveríamos al prompt de
 * 4,7 MB.
 */

const importe = (n: number, moneda: string) =>
  `${moneda} ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function aging(r: ResumenAging, quien: string, moneda: string): string {
  // ⚠️ Formatea con LA moneda del bloque. Etiquetar dólares como soles sería
  // darle al modelo un dato falso que además pasaría la verificación de cifras:
  // el número está bien, la unidad no.
  const m = (n: number) => importe(n, moneda);
  const tramos = TRAMOS.map((t) => `${t.label}: ${m(r.porTramo[t.id])}`).join(
    " · ",
  );
  const top = r.contrapartes
    .slice(0, TOPE_CONTRAPARTES)
    .map(
      (c) =>
        `  · ${c.contraparte}: ${m(c.total)} (vencido ${m(c.vencido)}, ${c.documentos} doc.)`,
    )
    .join("\n");

  return [
    `${quien} — en ${moneda} (foto de hoy):`,
    `Total: ${m(r.total)} en ${r.documentos} documentos.`,
    `Vencido: ${m(r.vencido)}.`,
    `Por antigüedad → ${tramos}`,
    r.contrapartes.length > 0
      ? `Los ${Math.min(r.contrapartes.length, TOPE_CONTRAPARTES)} mayores de ${r.contrapartes.length}:\n${top}`
      : "No hay nada pendiente.",
  ].join("\n");
}

async function saldos(
  tipo: TipoSaldo,
  args: Record<string, unknown>,
): Promise<string> {
  const supabase = await createClient(); // sesión: la empresa sale de auth.uid()
  const r = await traerResumenSaldos(supabase, tipo, {
    ...FILTRO_SALDO_VACIO,
    busca: typeof args.busca === "string" ? args.busca : "",
    soloVencido: args.solo_vencido === true,
  });
  const quien = tipo === "cobranza" ? "Cuentas por cobrar" : "Cuentas por pagar";
  const filtro =
    typeof args.busca === "string" && args.busca.trim() !== ""
      ? ` filtrado por «${args.busca}»`
      : "";
  // ⚠️ Un bloque POR MONEDA. Sumarlas daría un total que no responde a
  // ninguna pregunta, y el asistente lo repetiría como si fuera un dato.
  if (r.length === 0) return `${quien}${filtro}: no hay nada pendiente.`;
  return r
    .map((b) => aging(b.aging, quien + filtro, b.moneda))
    .join("\n\n");
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ejecuta una herramienta y devuelve su resultado como texto.
 *
 * Nunca lanza: un fallo se devuelve como texto para que el modelo pueda
 * decirlo. Que el asistente admita "no pude consultarlo" es mejor que una
 * conversación que se corta sin explicación.
 */
export async function ejecutarHerramienta(
  nombre: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!herramientaValida(nombre)) {
    return `No existe una consulta llamada «${nombre}».`;
  }

  try {
    switch (nombre) {
      case "cuentas_por_cobrar":
        return await saldos("cobranza", args);

      case "cuentas_por_pagar":
        return await saldos("pago", args);

      case "situacion_general": {
        const desde = String(args.desde ?? "");
        const hasta = String(args.hasta ?? "");
        if (!ISO.test(desde) || !ISO.test(hasta) || desde > hasta) {
          return "El período pedido no es válido. Usa fechas YYYY-MM-DD.";
        }
        const r = await getResumenEjecutivo(desde, hasta);
        const auto = porcentajeAutomatizado(r.periodo);
        return [
          `Período ${desde} a ${hasta} (solo conciliaciones APROBADAS):`,
          `Cobrado: ${importe(r.periodo.cobrado, "PEN")} · Pagado: ${importe(r.periodo.pagado, "PEN")}`,
          `Conciliaciones: ${r.periodo.conciliaciones}. Terminadas sin aprobar: ${r.periodo.sinAprobar}.`,
          `Partidas: ${r.periodo.partidas}, de las que se emparejaron ${r.periodo.partidasConciliadas}.`,
          auto === null
            ? "No hubo partidas, así que no hay porcentaje automatizado."
            : `Automatizado: ${auto} %.`,
          `Sin explicar en los cuadres: ${importe(r.periodo.diferenciaCuadre, "PEN")}.`,
          "",
          "Foto de hoy (no del período):",
          `Por cobrar ${importe(r.hoy.porCobrar, "PEN")} (vencido ${importe(r.hoy.porCobrarVencido, "PEN")}) · ` +
            `Por pagar ${importe(r.hoy.porPagar, "PEN")} (vencido ${importe(r.hoy.porPagarVencido, "PEN")})`,
          `Posición neta: ${importe(posicionNeta(r.hoy), "PEN")}. ` +
            "No dice el calendario: cobrar a 90 días y pagar a 30 deja sin caja aunque el neto sea positivo.",
          // ⚠️ `resumen_ejecutivo` todavía suma todas las monedas (ver 0041):
          // decirlo evita que el asistente presente como soles un total que
          // puede llevar dólares dentro.
          "Estas cifras del período están expresadas en la moneda principal; si la empresa factura en varias, consúltalas en Por cobrar y Por pagar, que sí las separan.",
        ].join("\n");
      }

      case "ultimas_conciliaciones": {
        const supabase = await createClient(); // RLS: solo las de su empresa
        const { data, error } = await supabase
          .from("jobs_conciliacion")
          .select(
            "id, estado, estado_contable, periodo_desde, periodo_hasta, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(TOPE_CONCILIACIONES);
        if (error) return "No se pudieron consultar las conciliaciones.";
        const filas = (data ?? []) as {
          id: string;
          estado: string;
          estado_contable: string | null;
          periodo_desde: string;
          periodo_hasta: string;
        }[];
        if (filas.length === 0) return "Todavía no hay ninguna conciliación.";
        return [
          `Últimas ${filas.length} conciliaciones:`,
          ...filas.map(
            (j) =>
              `  · ${j.periodo_desde} a ${j.periodo_hasta} — proceso: ${j.estado}` +
              ` — contable: ${j.estado_contable ?? "borrador"}`,
          ),
          "Recuerda: solo la APROBADA mueve el saldo de los comprobantes.",
        ].join("\n");
      }

      case "estado_de_cuenta": {
        const empresa = await getEmpresaActual();
        if (!empresa) return "No se pudo leer el estado de la cuenta.";
        const e = estadoSuscripcion(empresa);
        if (e.plan === "activo") {
          return "La cuenta está activa (plan de pago), sin límite de tiempo.";
        }
        return e.expirada
          ? "La prueba gratuita ya terminó. Se puede consultar todo, pero no iniciar conciliaciones nuevas hasta activar la cuenta."
          : `Prueba gratuita: quedan ${e.diasRestantes} días. Incluye todas las funciones.`;
      }

      default:
        return `No existe una consulta llamada «${nombre}».`;
    }
  } catch (err) {
    console.error(`[asistente] fallo en la herramienta ${nombre}`, err);
    return `No se pudo consultar «${nombre}» en este momento.`;
  }
}
