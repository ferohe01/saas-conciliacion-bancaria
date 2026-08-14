-- ============================================================================
-- 0045_residuo_explicado_rapido.sql — La misma respuesta, dentro de los 8 s
--
-- La 0044 se pasaba del `statement_timeout` con el cliente grande y el botón
-- «Analizar» devolvía «No se pudo analizar lo que quedó sin conciliar». El
-- diagnóstico era correcto; lo que fallaba era llegar a tiempo.
--
-- Dos derroches, y el segundo es el caro:
--
--   1. Para saber si el código de una partida está en el otro lado, la 0044
--      MATERIALIZABA los 450.993 códigos distintos del extracto y los 452.454
--      de los libros, y luego buscaba dentro. Son dos agregados completos para
--      resolver 7.313 preguntas. Ahora cada pregunta es una búsqueda por índice
--      (`idx_mov_extracto_ref_norm` / `idx_comprobantes_ref_norm`): 7.313
--      sondas cuestan menos que construir una sola de esas tablas hash.
--
--   2. El recuento por serie sí necesita recorrerlo todo —de eso trata: cuántos
--      códigos tiene cada lado—, pero puede hacerse **solo con el índice** si
--      no hay que ir a la tabla. Por eso se añade `fecha` al índice de
--      comprobantes: sin ella, el filtro de período obligaba a visitar las
--      452.454 filas.
--
-- ⚠️ Mismo resultado, misma forma. Lo único que cambia es cómo se llega.
--
-- ⚠️ `create or replace` conserva el tipo de retorno (`jsonb`), así que no hace
-- falta soltar la función — ver `tests/migracionesFunciones.test.ts`.
-- ============================================================================

-- Cubre el recuento por serie sin tocar la tabla: (empresa, ref, fecha) tiene
-- las tres columnas que la consulta necesita.
create index if not exists idx_comprobantes_ref_fecha
  on public.comprobantes (empresa_id, ref_norm, fecha)
  where ref_norm <> '';

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

  -- Modo payload: las partidas no están en tablas. No es un fallo.
  if v_job.lote_extracto_id is null then
    return null;
  end if;

  select cb.moneda into v_moneda
    from public.cuentas_bancarias cb
   where cb.id = v_job.cuenta_id;
  v_moneda := coalesce(v_moneda, 'PEN');

  with casados_c as materialized (
    select unnest(m.comprobante_ids) as id
      from public.matches_conciliacion m
     where m.job_id = p_job_id
  ),
  casados_m as materialized (
    select unnest(m.movimiento_ids) as id
      from public.matches_conciliacion m
     where m.job_id = p_job_id
  ),
  -- Lo que quedó sin pareja de cada lado. Mismo criterio EXACTO que
  -- `residuo_internos` / `residuo_movimientos`.
  int_pend as materialized (
    select
      c.ref_norm as ref,
      case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end as monto
    from public.comprobantes c
    where c.empresa_id = v_job.empresa_id
      and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
      and c.estado not in ('cobrado', 'anulado')
      and coalesce(c.moneda, 'PEN') = v_moneda
      and not exists (select 1 from casados_c k where k.id = c.id)
  ),
  mov_pend as materialized (
    select m.ref_norm as ref, m.monto
      from public.movimientos_extracto m
     where m.lote_id = v_job.lote_extracto_id
       and not exists (select 1 from casados_m k where k.id = m.id)
  ),
  -- ⚠️ La pregunta «¿está su código en el otro lado?» se resuelve POR ÍNDICE,
  -- una partida a la vez. Antes se construía el conjunto entero de códigos del
  -- otro lado para consultarlo 4.384 veces; son dos escaneos completos para
  -- responder a un puñado de preguntas.
  int_clas as (
    select
      case
        when p.ref = '' then 'sin_codigo'
        when exists (
          select 1 from public.movimientos_extracto m
           where m.lote_id = v_job.lote_extracto_id
             and m.ref_norm = p.ref
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
  ),
  -- ── Series ────────────────────────────────────────────────────────────────
  --
  -- Los cuatro primeros caracteres del código canónico. No es una verdad del
  -- dominio, es una ayuda de lectura — pero funciona porque la forma canónica ya
  -- quitó el prefijo de entidad (0042): `WIN-S001-11618954` y `S001-18052620`
  -- caen los dos en `S001`, que es exactamente lo que hay que comparar.
  --
  -- Es lo que destapa el caso: de la serie S001 el banco trae 559 códigos y los
  -- libros 276. No es un problema de emparejamiento, es que faltan documentos.
  series_pend as (
    select left(ref, 4) as serie,
           count(*) filter (where lado = 'banco')  as banco_pend,
           count(*) filter (where lado = 'libros') as libros_pend
      from (
        select 'libros' as lado, ref from int_pend where ref <> ''
        union all
        select 'banco', ref from mov_pend where ref <> ''
      ) t
     group by 1
     order by (count(*) filter (where lado = 'banco')
             + count(*) filter (where lado = 'libros')) desc
     limit 4
  ),
  -- Recuento total por serie. Recorre los dos lados, pero solo por índice.
  tot_banco as (
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
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               'serie', s.serie,
               'banco', coalesce(b.n, 0),
               'libros', coalesce(l.n, 0),
               'banco_sin_conciliar', s.banco_pend,
               'libros_sin_conciliar', s.libros_pend)
             order by (s.banco_pend + s.libros_pend) desc)
        from series_pend s
        left join tot_banco  b on b.serie = s.serie
        left join tot_libros l on l.serie = s.serie
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.residuo_explicado(text) is
  'De lo que quedó sin conciliar: cuántas partidas tienen su código en el otro '
  'lado y cuántas no, por lado y por serie. Cuenta; no concluye. La redacción '
  'está en src/lib/residuoExplicado.ts.';

revoke all on function public.residuo_explicado(text) from public, anon;
grant execute on function public.residuo_explicado(text) to authenticated, service_role;

-- El índice nuevo cambia el tamaño de lo que el planificador conoce.
analyze public.comprobantes;
