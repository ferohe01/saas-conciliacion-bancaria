-- ============================================================================
-- 0030_analizar_tras_carga.sql — Estadísticas frescas después de cargar medio
-- millón de filas
--
-- El planificador de Postgres decide con estadísticas. Cuando una tabla cambia
-- de tamaño de golpe —una importación de 450.999 movimientos, o una migración
-- que la reescribe— esas estadísticas se quedan viejas y elige planes malos
-- para la MISMA consulta que antes iba bien.
--
-- Pasó, y el síntoma no apuntaba a esto: `residuo_internos` tardaba 1,68 s
-- medido, y después de que la `0029` reescribiera `comprobantes` para añadir
-- `ref_norm` empezó a pasarse del `statement_timeout` de 8 s. Nada en el código
-- había cambiado. Un `vacuum analyze` lo devolvió a 1,5 s.
--
-- Autovacuum acaba haciéndolo solo, pero tarda — y la ventana en la que no lo
-- ha hecho es exactamente cuando alguien concilia lo que acaba de importar.
--
-- ⚠️ Va como función SECURITY DEFINER porque `ANALYZE` exige ser dueño de la
-- tabla, y `service_role` no lo es (lo es `supabase_admin`). Sin esto el
-- backend no puede pedirlo.
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
end;
$$;

comment on function public.analizar_tablas_conciliacion() is
  'Refresca las estadísticas de las tablas que recorre la conciliación. Se '
  'llama tras una importación grande: sin ello el planificador usa los tamaños '
  'de antes y elige planes que se pasan del statement_timeout.';

revoke all on function public.analizar_tablas_conciliacion() from public, anon, authenticated;
grant execute on function public.analizar_tablas_conciliacion() to service_role;

-- Y de paso, ahora: la 0029 reescribió `comprobantes` y la dejó sin analizar.
analyze public.comprobantes;
analyze public.movimientos_extracto;
