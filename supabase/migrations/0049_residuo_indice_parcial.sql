-- ============================================================================
-- 0049_residuo_indice_parcial.sql — Un índice PARCIAL solo se usa si le repites
--                                   su condición
--
-- Cinco intentos sobre el mismo timeout, y el fallo llevaba ahí desde el primero
-- sin que ninguna de mis optimizaciones lo tocara. No estaba en QUÉ consultaba:
-- estaba en una condición que no escribí.
--
-- Los dos índices de referencias son parciales (0029 / 0042):
--
--     create index idx_mov_extracto_ref_norm
--       on movimientos_extracto (lote_id, ref_norm)
--       where ref_norm <> '';                          ← la condición
--
-- Y mis sondas preguntaban:
--
--     exists (select 1 from movimientos_extracto m
--              where m.lote_id = X and m.ref_norm = p.ref)
--
-- Postgres **no puede demostrar** que `p.ref <> ''` —viene de otra fila— así que
-- no puede garantizar que la fila buscada esté dentro del índice, y lo descarta.
-- Sin índice, cada una de las 4.382 sondas se resuelve recorriendo la tabla, o
-- el planificador construye un semi-join contra las 450.999 filas. Cualquiera de
-- las dos cosas se come los 8 s ella sola, y ninguna de mis cuatro migraciones
-- anteriores la rozó siquiera: por eso «sigue igual» cuatro veces.
--
-- El arreglo es una línea por sonda: repetir la condición del índice. No cambia
-- el resultado —el `case` ya descarta antes las referencias vacías— pero le
-- permite al planificador usar lo que ya existe.
--
-- ⚠️ REGLA, y esta merece quedarse: **toda consulta contra una columna con
-- índice parcial tiene que repetir el `where` del índice.** `pares_exactos` lo
-- lleva desde siempre (`and c.ref_norm <> ''`) y por eso empareja medio millón
-- de filas en 32 s; el código nuevo lo omitió y pagó cuatro rondas.
-- ============================================================================

create or replace function public.residuo_explicado(p_job_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job     public.jobs_conciliacion%rowtype;
  v_moneda  text;
  v_int_ids uuid[];
  v_mov_ids uuid[];
  v_out     jsonb;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    return null;
  end if;

  -- ⚠️ FRONTERA DE SEGURIDAD: el job tiene que ser de una empresa del usuario.
  perform 1
     from public.usuarios_empresa ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = v_job.empresa_id;
  if not found then
    return null;
  end if;

  if v_job.lote_extracto_id is null or v_job.payload_entrada is null then
    return null;
  end if;

  select cb.moneda into v_moneda
    from public.cuentas_bancarias cb
   where cb.id = v_job.cuenta_id;
  v_moneda := coalesce(v_moneda, 'PEN');

  -- Los ids del residuo, a un array: `= any($array)` estima por su longitud y
  -- el planificador elige el índice (0048).
  select array_agg((e ->> 'comprobante_id')::uuid)
    into v_int_ids
    from jsonb_array_elements(v_job.payload_entrada -> 'registros_internos') e
   where e ->> 'comprobante_id' is not null;

  select array_agg((e ->> 'movimiento_id')::uuid)
    into v_mov_ids
    from jsonb_array_elements(v_job.payload_entrada -> 'movimientos_bancarios') e
   where e ->> 'movimiento_id' is not null;

  if v_int_ids is null and v_mov_ids is null then
    return null;
  end if;

  with casados_extra as materialized (
    select m.comprobante_ids, m.movimiento_ids
      from public.matches_conciliacion m
     where m.job_id = p_job_id
       and m.metodo in ('difusa', 'ia', 'manual')
  ),
  extra_c as (select unnest(comprobante_ids) as id from casados_extra),
  extra_m as (select unnest(movimiento_ids) as id from casados_extra),
  int_pend as materialized (
    select c.ref_norm as ref,
           case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end as monto
      from public.comprobantes c
     where c.id = any(coalesce(v_int_ids, '{}'::uuid[]))
       and not exists (select 1 from extra_c k where k.id = c.id)
  ),
  mov_pend as materialized (
    select m.ref_norm as ref, m.monto
      from public.movimientos_extracto m
     where m.id = any(coalesce(v_mov_ids, '{}'::uuid[]))
       and not exists (select 1 from extra_m k where k.id = m.id)
  ),
  int_clas as (
    select
      case
        when p.ref = '' then 'sin_codigo'
        when exists (
          select 1 from public.movimientos_extracto m
           where m.lote_id = v_job.lote_extracto_id
             and m.ref_norm = p.ref
             -- ⚠️ La condición del índice PARCIAL, repetida. Sin ella el
             -- índice no se puede usar y cada sonda recorre la tabla.
             and m.ref_norm <> ''
        ) then 'codigo_en_el_otro_lado'
        else 'sin_rastro'
      end as motivo,
      p.monto
    from int_pend p
  ),
  mov_clas as (
    select
      case
        when p.ref = '' then 'sin_codigo'
        when exists (
          select 1 from public.comprobantes c
           where c.empresa_id = v_job.empresa_id
             and c.ref_norm = p.ref
             -- ⚠️ Ídem: `idx_comprobantes_ref_norm` es parcial.
             and c.ref_norm <> ''
             and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
        ) then 'codigo_en_el_otro_lado'
        else 'sin_rastro'
      end as motivo,
      p.monto
    from mov_pend p
  )
  select jsonb_build_object(
    'moneda', v_moneda,
    'internos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'motivo', motivo, 'partidas', n, 'importe', importe) order by n desc)
        from (select motivo, count(*) as n, sum(monto) as importe
                from int_clas group by motivo) a
    ), '[]'::jsonb),
    'movimientos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'motivo', motivo, 'partidas', n, 'importe', importe) order by n desc)
        from (select motivo, count(*) as n, sum(monto) as importe
                from mov_clas group by motivo) a
    ), '[]'::jsonb),
    'series', '[]'::jsonb
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.residuo_explicado(text) from public, anon;
grant execute on function public.residuo_explicado(text) to authenticated, service_role;
