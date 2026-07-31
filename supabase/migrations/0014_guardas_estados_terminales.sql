-- ============================================================================
-- 0014_guardas_estados_terminales.sql — Cerrar dos huecos de la 0013
--
-- La 0013 dejó dos transiciones que la capa TypeScript impide pero la base
-- aceptaba. Como la base es la autoridad —cualquier escritura con
-- `service_role` la esquiva, venga de la app, de n8n o de un psql—, la regla
-- tiene que estar aquí.
--
-- 1) REAPROBAR una conciliación ya aprobada.
--    Parecía inocuo por ser idempotente, pero pisa `fecha_aprobacion` y
--    `usuario_aprobador`, que son datos de auditoría: convierte una aprobación
--    heredada de la migración (aprobador NULL) en una aprobación humana que
--    nunca ocurrió. Se detectó justamente así, probando en producción.
--
-- 2) REABRIR una conciliación ANULADA.
--    `cambiar_estado_contable` solo rechazaba `reemplazada`, así que una
--    anulada podía volver a `borrador` y de ahí aprobarse. `cicloContable.ts`
--    la trata como terminal desde el principio; ahora la base también.
--
-- Ambas funciones se redefinen enteras (`create or replace`) en vez de
-- parchearse: una función a medias entre dos migraciones es peor de leer que
-- una definición completa que se sustituye.
-- ============================================================================

create or replace function public.aprobar_conciliacion(
  p_job_id text,
  p_usuario uuid
)
returns table (reemplazada_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
begin
  select * into v_job
    from public.jobs_conciliacion
   where id = p_job_id
   for update;

  if not found then
    raise exception 'Conciliación no encontrada' using errcode = 'no_data_found';
  end if;

  if v_job.estado <> 'completado' then
    raise exception 'Solo puede aprobarse una conciliación ya procesada'
      using errcode = 'check_violation';
  end if;

  if v_job.estado_contable in ('anulada', 'reemplazada') then
    raise exception 'Una conciliación anulada o reemplazada no puede aprobarse'
      using errcode = 'check_violation';
  end if;

  -- Hueco 1: reaprobar pisaría la fecha y el aprobador originales.
  if v_job.estado_contable = 'aprobada' then
    raise exception 'Esta conciliación ya está aprobada'
      using errcode = 'check_violation';
  end if;

  -- Degradar las aprobadas que se solapen con este rango en la misma cuenta.
  -- Sin esto, el UPDATE de más abajo chocaría con el constraint de exclusión.
  return query
  with degradadas as (
    update public.jobs_conciliacion j
       set estado_contable = 'reemplazada'
     where j.cuenta_id = v_job.cuenta_id
       and j.id <> v_job.id
       and j.estado_contable = 'aprobada'
       and daterange(j.periodo_desde, j.periodo_hasta, '[]')
        && daterange(v_job.periodo_desde, v_job.periodo_hasta, '[]')
    returning j.id
  ),
  limpieza as (
    -- Una conciliación que deja de regir deja de mover saldo.
    delete from public.aplicaciones_cobro a
     using degradadas d
     where a.job_id = d.id
    returning a.job_id
  )
  select d.id from degradadas d;

  update public.jobs_conciliacion
     set estado_contable   = 'aprobada',
         fecha_aprobacion  = now(),
         usuario_aprobador = p_usuario
   where id = p_job_id;
end;
$$;

comment on function public.aprobar_conciliacion(text, uuid) is
  'Aprueba una conciliación y degrada a `reemplazada` las aprobadas que se '
  'solapen, borrando sus aplicaciones de cobro. Atómico. Rechaza reaprobar una '
  'ya aprobada: pisaría los datos de auditoría de la aprobación original.';

create or replace function public.cambiar_estado_contable(
  p_job_id text,
  p_estado text,
  p_usuario uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual text;
begin
  if p_estado not in ('borrador', 'en_proceso', 'observada', 'anulada') then
    raise exception 'Estado no permitido por esta vía: %', p_estado
      using errcode = 'check_violation';
  end if;

  select estado_contable into v_actual
    from public.jobs_conciliacion
   where id = p_job_id
   for update;

  if not found then
    raise exception 'Conciliación no encontrada' using errcode = 'no_data_found';
  end if;

  -- Hueco 2: `anulada` es terminal igual que `reemplazada`. Rehacer un período
  -- descartado se hace conciliándolo de nuevo, que deja rastro; revivir el
  -- documento anulado lo borraría.
  if v_actual in ('anulada', 'reemplazada') then
    raise exception 'Una conciliación anulada o reemplazada ya no admite cambios'
      using errcode = 'check_violation';
  end if;

  if v_actual = p_estado then
    raise exception 'La conciliación ya está en ese estado'
      using errcode = 'check_violation';
  end if;

  update public.jobs_conciliacion
     set estado_contable = p_estado,
         -- Deja de regir: la aprobación previa ya no vale.
         fecha_aprobacion = null,
         usuario_aprobador = null
   where id = p_job_id;

  -- Al salir de `aprobada` el documento deja de mover saldo.
  delete from public.aplicaciones_cobro where job_id = p_job_id;
end;
$$;

comment on function public.cambiar_estado_contable(text, text, uuid) is
  'Observa, anula o reabre una conciliación. `anulada` y `reemplazada` son '
  'terminales. Borra sus aplicaciones de cobro: solo la aprobada mueve saldo.';

revoke all on function public.aprobar_conciliacion(text, uuid) from public, anon, authenticated;
revoke all on function public.cambiar_estado_contable(text, text, uuid) from public, anon, authenticated;
grant execute on function public.aprobar_conciliacion(text, uuid) to service_role;
grant execute on function public.cambiar_estado_contable(text, text, uuid) to service_role;
