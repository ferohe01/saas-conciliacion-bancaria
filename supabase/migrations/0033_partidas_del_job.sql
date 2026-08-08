-- ============================================================================
-- 0033_partidas_del_job.sql — Cuántas partidas cubrió una conciliación
--
-- ⚠️ El total de una conciliación NO puede depender del estado actual de sus
-- comprobantes, y así estaba.
--
-- `totales_conciliacion` cuenta los comprobantes del período que no están
-- cobrados ni anulados — correcto para decidir qué conciliar, y equivocado para
-- decir qué se concilió. Al aprobar, 447.795 pasan a `cobrado` y ese total se
-- desploma de 452.177 a 4.382. El resumen se degradaba solo, y como la pantalla
-- recalcula en cada carga, el número empeoraba cada vez que alguien lo miraba.
--
-- Aquí se cuenta lo que la conciliación TOCÓ, que no cambia después: las
-- partidas que entraron en algún par. Sumado a las que quedaron sin conciliar
-- da el total del período, y es estable para siempre.
-- ============================================================================

create or replace function public.partidas_conciliadas_job(p_job_id text)
returns table (internos bigint, movimientos bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    -- `array_length` y no `count(*)`: un match puede ser 1:N, así que un par no
    -- es una partida — son las que lleva dentro.
    coalesce(sum(coalesce(array_length(m.comprobante_ids, 1), 0)), 0),
    coalesce(sum(coalesce(array_length(m.movimiento_ids, 1), 0)), 0)
  from public.matches_conciliacion m
  where m.job_id = p_job_id
    -- Un par rechazado no concilió nada: sus partidas cuentan como sueltas.
    and m.estado_revision <> 'rechazado';
$$;

comment on function public.partidas_conciliadas_job(text) is
  'Partidas que entraron en algún par. Estable: no cambia cuando los '
  'comprobantes pasan a cobrado.';

revoke all on function public.partidas_conciliadas_job(text) from public, anon, authenticated;
grant execute on function public.partidas_conciliadas_job(text) to service_role;
