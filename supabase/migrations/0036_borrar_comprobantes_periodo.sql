-- ============================================================================
-- 0036_borrar_comprobantes_periodo.sql — Quitar los comprobantes de un período
--
-- El Paso 1 del wizard muestra «Comprobantes del período · N registros» y hasta
-- ahora la única forma de deshacer esa carga era irse a /comprobantes. Si
-- alguien subió el archivo equivocado, tenía que abandonar el flujo a medias
-- para arreglarlo y volver a empezar.
--
-- ⚠️ Se borra POR PERÍODO y no "la última carga", aunque suene menos natural.
-- La tarjeta enseña un número concreto; si el botón quitara el último lote
-- podría llevarse otra cosa —o solo una parte— y dejar la tarjeta con un número
-- que el usuario no esperaba. Lo que se ve es lo que se quita.
-- ============================================================================

-- La firma de dos argumentos se sustituye por la de cuatro. `create or replace`
-- con otra firma deja viva la anterior y, con parámetros por defecto, las
-- llamadas quedan ambiguas (ya pasó con `aplicar_cobros_exactos`).
drop function if exists public.borrar_comprobantes(uuid, integer);

create or replace function public.borrar_comprobantes(
  p_lote   uuid default null,
  p_limite integer default 20000,
  p_desde  date default null,
  p_hasta  date default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  with mias as (
    select ue.empresa_id from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  candidatos as (
    select c.id
      from public.comprobantes c
     where c.empresa_id in (select empresa_id from mias)
       and (p_lote is null or c.lote_importacion = p_lote)
       and (p_desde is null or c.fecha >= p_desde)
       and (p_hasta is null or c.fecha <= p_hasta)
       -- Lo que ya entró en una conciliación no se borra: se ANULA (ver 0016).
       and not exists (
         select 1 from public.aplicaciones_cobro a where a.comprobante_id = c.id
       )
     limit p_limite
  )
  delete from public.comprobantes c
   using candidatos k
   where c.id = k.id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

drop function if exists public.comprobantes_protegidos(uuid);

create or replace function public.comprobantes_protegidos(
  p_lote  uuid default null,
  p_desde date default null,
  p_hasta date default null
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  )
  select count(*)
    from public.comprobantes c
   where c.empresa_id in (select empresa_id from mias)
     and (p_lote is null or c.lote_importacion = p_lote)
     and (p_desde is null or c.fecha >= p_desde)
     and (p_hasta is null or c.fecha <= p_hasta)
     and exists (
       select 1 from public.aplicaciones_cobro a where a.comprobante_id = c.id
     );
$$;

comment on function public.borrar_comprobantes(uuid, integer, date, date) is
  'Borra hasta p_limite comprobantes de la empresa del usuario, por lote o por '
  'rango de fechas. Salta los que tienen cobros aplicados.';

revoke all on function public.borrar_comprobantes(uuid, integer, date, date) from public, anon;
revoke all on function public.comprobantes_protegidos(uuid, date, date) from public, anon;
grant execute on function public.borrar_comprobantes(uuid, integer, date, date) to authenticated, service_role;
grant execute on function public.comprobantes_protegidos(uuid, date, date) to authenticated, service_role;
