-- ============================================================================
-- 0031_analizar_aplicaciones.sql — `aplicaciones_cobro` también necesita
-- estadísticas frescas
--
-- Aprobar una conciliación de medio millón de pares llena `aplicaciones_cobro`
-- de 0 a 447.795 filas en lotes. El anti-join que decide "lo ya aplicado no se
-- vuelve a mirar" consulta esa misma tabla mientras crece: con las estadísticas
-- de cuando estaba vacía, el planificador elige un plan pensado para cero filas
-- y se pasa del `statement_timeout` de 8 s.
--
-- Ocurrió: la aprobación escribió 10.000 cobros y el tercer lote se canceló.
-- Minutos después, el MISMO lote tardaba 3,2 s — autovacuum ya había analizado.
-- Es la misma carrera que en `matches_conciliacion`, y por eso esa tabla entra
-- ahora en la lista.
-- ============================================================================

create or replace function public.analizar_tablas_conciliacion()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  analyze public.comprobantes;
  analyze public.movimientos_extracto;
  analyze public.matches_conciliacion;
  -- Crece durante la propia aprobación, que es cuando más importa.
  analyze public.aplicaciones_cobro;
end;
$$;

analyze public.aplicaciones_cobro;
