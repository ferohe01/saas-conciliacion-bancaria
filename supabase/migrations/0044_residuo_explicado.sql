-- ============================================================================
-- 0044_residuo_explicado.sql — Qué queda sin conciliar, y por qué
--
-- ── Por qué existe ─────────────────────────────────────────────────────────
--
-- La cascada de la 0043 llega hasta «4.384 sin conciliar» y ahí se detiene. Y
-- ese número es justo el que abre la pregunta siguiente, que es la que el
-- cliente hace en voz alta: *¿y esos qué son?*
--
-- Contestarla a mano exigía abrir el Excel del mayor, el del banco, y cruzar
-- 450.999 movimientos contra 452.454 comprobantes. El resultado de ese cruce
-- —hecho una vez, fuera del producto— fue:
--
--     4.382 recibos cuyo código no aparece en NINGÚN movimiento del extracto
--     2.645 movimientos cuyo código no aparece en ningún comprobante
--       284 movimientos de la serie S001, de la que el banco trae 559 y los
--           libros solo 276
--
-- Todo eso está en la base. Lo único que faltaba era preguntarlo.
--
-- ⚠️ La función CUENTA; no concluye. Devuelve «su código no aparece en el otro
-- lado», no «se cobró por otro canal» — eso es una lectura del negocio, y
-- ponerla aquí sería que el sistema afirme algo que no ha comprobado. La
-- redacción vive en `src/lib/residuoExplicado.ts`, que es puro y tiene tests.
--
-- ⚠️ Solo modo TABLA. En modo payload las partidas viven en el JSONB del job y
-- son unos miles: eso lo explica la aplicación sin bajar a SQL. Devolver `null`
-- es la señal de "aquí no aplica", no un error.
--
-- ⚠️ SE PIDE AL PULSAR, no al cargar la pantalla. Recorre las dos tablas
-- enteras: a este volumen son segundos, y el panel se abre a diario. Mismo
-- criterio que el «¿Por qué?» de cada partida y que el asistente.
-- ============================================================================

create or replace function public.residuo_explicado(p_job_id text)
returns jsonb
language plpgsql
stable
-- ⚠️ SECURITY DEFINER: RLS no aplica dentro, así que la comprobación de
-- pertenencia de abajo ES el control de acceso. La empresa NO llega por
-- parámetro: sale del job, y el job tiene que ser de una empresa del usuario.
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

  -- ⚠️ FRONTERA DE SEGURIDAD. Sin esta línea, un job_id ajeno devolvería el
  -- diagnóstico del residuo de otro cliente.
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
  -- `residuo_internos` / `residuo_movimientos`: si difiriera, la explicación
  -- hablaría de partidas distintas de las que la pantalla cuenta.
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
  -- Los códigos que existen en cada lado, para poder decir si el del otro está
  -- o no. Se agrupan una vez en vez de preguntar fila a fila.
  refs_banco as materialized (
    select distinct m.ref_norm as ref
      from public.movimientos_extracto m
     where m.lote_id = v_job.lote_extracto_id
       and m.ref_norm <> ''
  ),
  refs_libros as materialized (
    select distinct c.ref_norm as ref
      from public.comprobantes c
     where c.empresa_id = v_job.empresa_id
       and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
       and c.ref_norm <> ''
  ),
  int_clas as (
    select
      case
        when p.ref = '' then 'sin_codigo'
        when exists (select 1 from refs_banco r where r.ref = p.ref)
          then 'codigo_en_el_otro_lado'
        else 'sin_rastro'
      end as motivo,
      p.monto
    from int_pend p
  ),
  mov_clas as (
    select
      case
        when p.ref = '' then 'sin_codigo'
        when exists (select 1 from refs_libros r where r.ref = p.ref)
          then 'codigo_en_el_otro_lado'
        else 'sin_rastro'
      end as motivo,
      p.monto
    from mov_pend p
  ),
  -- ── Series ────────────────────────────────────────────────────────────────
  --
  -- Agrupar por los CUATRO primeros caracteres del código canónico. No es una
  -- verdad del dominio, es una ayuda de lectura — pero funciona porque la forma
  -- canónica ya quitó el prefijo de entidad (0042): `WIN-S001-11618954` y
  -- `S001-18052620` caen los dos en `S001`, que es exactamente lo que hay que
  -- comparar. Sin esa normalización, uno sería `WIN-` y el otro `S001` y la
  -- comparación no diría nada.
  --
  -- Es lo que destapa el caso: de la serie S001 el banco trae 559 movimientos y
  -- los libros solo 276. No es un problema de emparejamiento, es que faltan
  -- documentos.
  series_pend as (
    select left(ref, 4) as serie,
           count(*) filter (where lado = 'banco')   as banco_pend,
           count(*) filter (where lado = 'libros')  as libros_pend
      from (
        select 'libros' as lado, ref from int_pend where ref <> ''
        union all
        select 'banco', ref from mov_pend where ref <> ''
      ) t
     group by 1
  ),
  series_total as (
    select left(ref, 4) as serie,
           count(*) filter (where lado = 'banco')  as banco,
           count(*) filter (where lado = 'libros') as libros
      from (
        select 'banco' as lado, ref from refs_banco
        union all
        select 'libros', ref from refs_libros
      ) t
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
               'banco', coalesce(t.banco, 0),
               'libros', coalesce(t.libros, 0),
               'banco_sin_conciliar', s.banco_pend,
               'libros_sin_conciliar', s.libros_pend)
             order by (s.banco_pend + s.libros_pend) desc)
        from (select * from series_pend
               order by (banco_pend + libros_pend) desc
               limit 4) s
        left join series_total t on t.serie = s.serie
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
