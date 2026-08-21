-- ============================================================================
-- 0055_analizar_cobros.sql — Refrescar SOLO lo que cambia durante el reparto
--
-- ── Qué falló ───────────────────────────────────────────────────────────────
--
-- El reparto de cobros de una aprobación de 448.070 pares devolvió **0
-- aplicados**, y el botón «Reintentar» devolvía 0 otra vez. En el log:
--
--     [cobranzas] fallo aplicando cobros de rec-2026-06-11e625:
--       { code: '57014', message: 'canceling statement due to statement timeout' }
--
-- El código ya preveía el timeout: al recibirlo refresca estadísticas y
-- reintenta. Pero refrescaba con `analizar_tablas_conciliacion()`, que hace
-- CUATRO análisis —`comprobantes` (452.309), `movimientos_extracto` (450.999),
-- `matches_conciliacion` (448.070) y `aplicaciones_cobro`— **por la misma vía
-- que tiene 8 s de presupuesto**. A este volumen la propia recuperación se pasa
-- del tope, así que el reintento corría en las mismas condiciones que el intento
-- que acababa de fallar.
--
-- ⚠️ Y el error de ese `analyze` no se miraba (`await analizar()` a secas), así
-- que el mecanismo de recuperación podía estar fallando en cada vuelta sin
-- dejar rastro. Es el mismo patrón que la 0021 documenta tres veces: **recorrer
-- mucho y descartar el error en silencio**.
--
-- ── Qué hace esta migración ────────────────────────────────────────────────
--
-- Dentro del bucle de cobros solo cambian DOS tablas: `aplicaciones_cobro`, que
-- crece de cero a medio millón durante la propia función, y `matches_conciliacion`,
-- que la acaba de llenar la capa exacta. `comprobantes` y `movimientos_extracto`
-- no se tocan ahí — analizarlas es trabajo que no sirve a nadie y que se come el
-- presupuesto que necesita el que sí sirve.
--
-- `analizar_tablas_conciliacion()` se queda como está: en `construirResiduo`
-- las cuatro son pertinentes, porque ahí sí acaban de cambiar las cuatro.
-- ============================================================================

create or replace function public.analizar_cobros()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Crece durante la propia aprobación, que es cuando más despista al
  -- planificador: el salto de 0 a algo es el que peor estima.
  analyze public.aplicaciones_cobro;
  -- La acaba de llenar `conciliar_exacta`, y el anti-join del reparto la
  -- recorre. Si se quedó analizada mientras estaba vacía —por ejemplo tras un
  -- `ops/borrar-conciliaciones.sql`— el plan se elige para cero filas.
  analyze public.matches_conciliacion;
end;
$$;

comment on function public.analizar_cobros() is
  'Refresca las estadísticas de las dos tablas que cambian durante el reparto '
  'de cobros. Más estrecha que analizar_tablas_conciliacion() a propósito: '
  'corre con el statement_timeout de 8 s de PostgREST.';

revoke all on function public.analizar_cobros() from public, anon, authenticated;
grant execute on function public.analizar_cobros() to service_role;
