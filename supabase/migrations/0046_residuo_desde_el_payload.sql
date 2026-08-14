-- ============================================================================
-- 0046_residuo_desde_el_payload.sql — Dejar de recalcular lo que ya está escrito
--
-- La 0045 seguía pasándose de los 8 s. Aceleré las búsquedas, pero el gasto
-- gordo estaba antes y no lo vi: **para saber QUÉ partidas quedaron sueltas,
-- desplegaba los 448.070 pares y hacía un anti-join contra medio millón de
-- comprobantes y otro medio millón de movimientos.** Cuatro recorridos de tabla
-- para obtener 7.313 filas.
--
-- Y esas 7.313 filas **ya están escritas**: son exactamente el residuo que el
-- backend mandó a n8n, guardado en `payload_entrada`, y cada una lleva su uuid
-- real (`comprobante_id` / `movimiento_id`). Leerlas de ahí son 7.313 búsquedas
-- por clave primaria.
--
--     antes:  2 unnest de 448.070 + 4 recorridos de tabla
--     ahora:  1 lectura de jsonb + 7.313 búsquedas por PK
--
-- ⚠️ Con una corrección. El payload es el residuo **antes** de que n8n corriera
-- sus capas difusa / agrupación / IA, así que las partidas que el motor casó
-- después seguirían figurando como sueltas. Se descuentan con los pares cuyo
-- método NO es `exacta`, que son unas pocas decenas — y para que buscarlas no
-- cueste nada, se indexa `(job_id, metodo)`.
--
-- ⚠️ Y el recuento por serie se separa a su propia función. Ese sí tiene que
-- recorrerlo todo —de eso trata: cuántos códigos tiene cada lado— así que se le
-- da su propio presupuesto de 8 s. Si se pasa, la pantalla enseña igual la
-- clasificación, que es el contenido importante: una parte que no llega no
-- puede llevarse por delante la que sí.
-- ============================================================================

-- Busca los pares que NO son de la capa exacta sin recorrer los 448.070.
create index if not exists idx_matches_job_metodo
  on public.matches_conciliacion (job_id, metodo);


-- ---------------------------------------------------------------------------
-- 1) La clasificación: de lo suelto, ¿su código está en el otro lado?
-- ---------------------------------------------------------------------------
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

  -- Modo payload: allí el payload son TODAS las partidas, no el residuo, así
  -- que esta vía no aplica. No es un fallo.
  if v_job.lote_extracto_id is null or v_job.payload_entrada is null then
    return null;
  end if;

  select cb.moneda into v_moneda
    from public.cuentas_bancarias cb
   where cb.id = v_job.cuenta_id;
  v_moneda := coalesce(v_moneda, 'PEN');

  with casados_extra_c as (
    -- Lo que n8n casó DESPUÉS del residuo. Suelen ser decenas.
    select unnest(m.comprobante_ids) as id
      from public.matches_conciliacion m
     where m.job_id = p_job_id and m.metodo <> 'exacta'
  ),
  casados_extra_m as (
    select unnest(m.movimiento_ids) as id
      from public.matches_conciliacion m
     where m.job_id = p_job_id and m.metodo <> 'exacta'
  ),
  int_pend as materialized (
    select c.ref_norm as ref,
           case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end as monto
      from jsonb_to_recordset(v_job.payload_entrada -> 'registros_internos')
             as r(comprobante_id uuid)
      join public.comprobantes c on c.id = r.comprobante_id
     where not exists (select 1 from casados_extra_c k where k.id = c.id)
  ),
  mov_pend as materialized (
    select m.ref_norm as ref, m.monto
      from jsonb_to_recordset(v_job.payload_entrada -> 'movimientos_bancarios')
             as r(movimiento_id uuid)
      join public.movimientos_extracto m on m.id = r.movimiento_id
     where not exists (select 1 from casados_extra_m k where k.id = m.id)
  ),
  -- «¿Está su código en el otro lado?», una búsqueda por índice cada vez.
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
    -- Las series van aparte: ver `residuo_series`.
    'series', '[]'::jsonb
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.residuo_explicado(text) is
  'De lo que quedó sin conciliar: cuántas partidas tienen su código en el otro '
  'lado y cuántas no. Lee el residuo del payload del job (ya escrito) en vez de '
  'recalcularlo. Cuenta; no concluye — la redacción está en '
  'src/lib/residuoExplicado.ts.';

revoke all on function public.residuo_explicado(text) from public, anon;
grant execute on function public.residuo_explicado(text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2) Las series, en su propia llamada y con su propio presupuesto
--
-- Cuántos códigos distintos tiene cada lado, por serie. Es lo que destapa que
-- de `S001` el banco trae 559 y los libros 276: no es un problema de
-- emparejamiento, es que faltan documentos.
--
-- Agrupa por los cuatro primeros caracteres del código CANÓNICO, y solo tiene
-- sentido gracias a la 0042: sin quitar el prefijo de entidad,
-- `WIN-S001-11618954` y `S001-18052620` caerían en grupos distintos.
--
-- ⚠️ Esto sí recorre las dos tablas enteras, y no hay forma de evitarlo: la
-- pregunta es precisamente cuántos códigos hay en total. Por eso vive en su
-- propia función — si se pasa de tiempo, se pierde este detalle y no la
-- clasificación.
-- ---------------------------------------------------------------------------
create or replace function public.residuo_series(p_job_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
  v_out jsonb;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    return '[]'::jsonb;
  end if;

  perform 1
     from public.usuarios_empresa ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = v_job.empresa_id;
  if not found then
    return '[]'::jsonb;
  end if;

  if v_job.lote_extracto_id is null then
    return '[]'::jsonb;
  end if;

  with tot_banco as (
    select left(m.ref_norm, 4) as serie, count(distinct m.ref_norm) as n
      from public.movimientos_extracto m
     where m.lote_id = v_job.lote_extracto_id
       and m.ref_norm <> ''
     group by 1
  ),
  tot_libros as (
    select left(c.ref_norm, 4) as serie, count(distinct c.ref_norm) as n
      from public.comprobantes c
     where c.empresa_id = v_job.empresa_id
       and c.ref_norm <> ''
       and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
     group by 1
  ),
  juntas as (
    select coalesce(b.serie, l.serie) as serie,
           coalesce(b.n, 0) as banco,
           coalesce(l.n, 0) as libros
      from tot_banco b
      full join tot_libros l on l.serie = b.serie
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'serie', serie,
           'banco', banco,
           'libros', libros,
           'banco_sin_conciliar', 0,
           'libros_sin_conciliar', 0) order by (banco + libros) desc), '[]'::jsonb)
    into v_out
    from (select * from juntas order by (banco + libros) desc limit 4) s;

  return v_out;
end;
$$;

comment on function public.residuo_series(text) is
  'Cuántos códigos distintos tiene cada lado por serie (los 4 primeros '
  'caracteres del código canónico). Detecta que a un lado le faltan documentos.';

revoke all on function public.residuo_series(text) from public, anon;
grant execute on function public.residuo_series(text) to authenticated, service_role;
