-- ============================================================================
-- 0047_residuo_metodo_indexable.sql — `<> 'exacta'` no usa el índice
--
-- La 0046 dejó un solo recorrido caro y no me di cuenta: para descontar lo que
-- n8n casó DESPUÉS del residuo, preguntaba por los pares con
-- `metodo <> 'exacta'`. Una desigualdad no es un rango, así que el índice
-- `(job_id, metodo)` que añadí en esa misma migración **no servía para nada**:
-- había que recorrer las 448.070 entradas del job y mirar el método de cada
-- una. Dos veces, una por lado.
--
-- Los métodos son una lista cerrada (`exacta | difusa | ia | manual`, ver
-- `src/lib/contract/enums.ts`), así que la pregunta se puede hacer al derecho:
-- `metodo in ('difusa','ia','manual')`. Eso sí son tres búsquedas por índice, y
-- en una conciliación normal devuelven decenas de filas o ninguna.
--
--     antes:  448.070 entradas recorridas × 2
--     ahora:  3 búsquedas por índice × 2
--
-- ⚠️ Si algún día se añade un método nuevo al enum, hay que añadirlo AQUÍ. Es el
-- precio de invertir la condición, y por eso la lista va escrita con el enum al
-- lado: un método nuevo que no esté en esta lista contaría como residuo una
-- partida que sí se concilió. `tests/contract.test.ts` fija los cuatro valores;
-- el día que cambien, ese test lo dirá.
-- ============================================================================

create or replace function public.residuo_explicado(p_job_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job    public.jobs_conciliacion%rowtype;
  v_moneda text;
  v_out    jsonb;
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

  with casados_extra as materialized (
    -- Lo que n8n casó DESPUÉS del residuo. Lista CERRADA de métodos para que sea
    -- un rango indexable; con `<> 'exacta'` había que mirar los 448.070 pares.
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
      from jsonb_to_recordset(v_job.payload_entrada -> 'registros_internos')
             as r(comprobante_id uuid)
      join public.comprobantes c on c.id = r.comprobante_id
     where not exists (select 1 from extra_c k where k.id = c.id)
  ),
  mov_pend as materialized (
    select m.ref_norm as ref, m.monto
      from jsonb_to_recordset(v_job.payload_entrada -> 'movimientos_bancarios')
             as r(movimiento_id uuid)
      join public.movimientos_extracto m on m.id = r.movimiento_id
     where not exists (select 1 from extra_m k where k.id = m.id)
  ),
  int_clas as (
    select
      case
        when p.ref = '' then 'sin_codigo'
        when exists (
          select 1 from public.movimientos_extracto m
           where m.lote_id = v_job.lote_extracto_id and m.ref_norm = p.ref
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
