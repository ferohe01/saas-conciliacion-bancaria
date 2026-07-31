-- ============================================================================
-- 0013_aprobar_conciliacion.sql — Aprobar y anular como operaciones atómicas
--
-- Aprobar una conciliación no es un solo UPDATE: si otra versión del mismo
-- rango ya está aprobada, hay que degradarla a `reemplazada` ANTES, porque el
-- constraint de exclusión de la 0012 no admite dos aprobadas solapadas.
--
-- Hacerlo desde la aplicación con dos escrituras sueltas deja una ventana en la
-- que ninguna rige, y si la segunda falla el período se queda sin conciliación
-- vigente. Aquí va como una sola transacción.
--
-- Las aplicaciones de cobro se borran junto con la degradación: solo la
-- conciliación aprobada mueve el saldo de los comprobantes (ver
-- `src/lib/cicloContable.ts`). El trigger de la 0008 recalcula el saldo solo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- aprobar_conciliacion(job, usuario)
--
-- Devuelve los ids que quedaron `reemplazada`, para poder informarlo en la UI.
-- ---------------------------------------------------------------------------
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
  'solapen, borrando sus aplicaciones de cobro. Atómico: nunca deja el período '
  'sin conciliación vigente.';

-- ---------------------------------------------------------------------------
-- cambiar_estado_contable(job, estado, usuario)
--
-- Para las transiciones que no son aprobar (observar, anular, reabrir). Se
-- separan porque ninguna necesita tocar a las hermanas, pero todas deben
-- limpiar las aplicaciones si el documento deja de regir.
-- ---------------------------------------------------------------------------
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

  if v_actual = 'reemplazada' then
    raise exception 'Una conciliación reemplazada ya no admite cambios'
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
  'Observa, anula o reabre una conciliación. Borra sus aplicaciones de cobro: '
  'solo la aprobada mueve el saldo de los comprobantes.';

-- ---------------------------------------------------------------------------
-- Permisos: estas funciones las invoca el backend con service_role. No se
-- conceden a `authenticated` — igual que el resto de escrituras sobre jobs,
-- que RLS no permite a los usuarios (ver 0002).
-- ---------------------------------------------------------------------------
revoke all on function public.aprobar_conciliacion(text, uuid) from public, anon, authenticated;
revoke all on function public.cambiar_estado_contable(text, text, uuid) from public, anon, authenticated;
grant execute on function public.aprobar_conciliacion(text, uuid) to service_role;
grant execute on function public.cambiar_estado_contable(text, text, uuid) to service_role;
