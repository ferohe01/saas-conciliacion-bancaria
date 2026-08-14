-- ============================================================================
-- 0048_residuo_por_array_de_ids.sql — Decirle a Postgres cuántas filas son
--
-- Cuarta vuelta sobre el mismo timeout, y esta ataca algo que las tres
-- anteriores daban por bueno: **el planificador no sabe cuántas filas devuelve
-- `jsonb_to_recordset`**. Sin `ROWS` declarado supone un número fijo, y con esa
-- suposición puede decidir que sale más barato **recorrer los 452.454
-- comprobantes enteros** (y los 450.999 movimientos) que hacer 7.313 búsquedas
-- por clave primaria. Dos recorridos completos de tabla, exactamente lo que la
-- 0046 creía haber quitado.
--
-- El arreglo no es otra reescritura de la consulta: es **darle el dato**. Los
-- uuid del residuo se extraen antes a un array de plpgsql, y `id = any($array)`
-- sí lleva una estimación honesta —la longitud del array—, así que el
-- planificador elige el índice porque sabe que son cuatro mil y no medio millón.
--
-- ⚠️ Lección para el próximo nodo caro: cuando algo se pasa de tiempo sin que
-- se vea por qué, la pregunta no es solo «qué consulta hago» sino «qué cree el
-- planificador que va a encontrar». Se mira con `explain analyze` comparando
-- filas estimadas contra filas reales, y `ops/medir-residuo.sql` lo tiene ya
-- troceado por partes.
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

  -- Los ids del residuo, a un array. Esto es lo que cambia el plan: `= any()`
  -- sobre un array conocido estima por su longitud, y el índice gana.
  select array_agg((e ->> 'comprobante_id')::uuid)
    into v_int_ids
    from jsonb_array_elements(v_job.payload_entrada -> 'registros_internos') e
   where e ->> 'comprobante_id' is not null;

  select array_agg((e ->> 'movimiento_id')::uuid)
    into v_mov_ids
    from jsonb_array_elements(v_job.payload_entrada -> 'movimientos_bancarios') e
   where e ->> 'movimiento_id' is not null;

  -- Sin ids no se puede decir nada: es un job anterior a que el residuo llevara
  -- los uuid reales. Vacío y la pantalla lo explica; inventar sería peor.
  if v_int_ids is null and v_mov_ids is null then
    return null;
  end if;

  with casados_extra as materialized (
    -- Lo que n8n casó DESPUÉS del residuo. Lista CERRADA de métodos para que sea
    -- un rango indexable (ver 0047).
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
