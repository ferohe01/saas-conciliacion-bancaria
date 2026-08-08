-- ============================================================================
-- 0028_conciliar_exacta_por_bloques.sql — La capa exacta, en trozos que caben
--
-- `conciliar_exacta` tarda ~32 s con junio completo (452.177 × 450.999). Medido
-- en psql eso parecía aceptable; por PostgREST no lo es, porque el rol con el
-- que se conecta lleva `statement_timeout = 8s` y la llamada se cancela entera:
--
--     No se pudo correr la capa exacta: canceling statement due to statement timeout
--
-- ⚠️ Y NO se puede ampliar desde dentro. `set local statement_timeout` en el
-- cuerpo de la función no rearma el temporizador de la sentencia que ya está en
-- marcha — probado: se cancela igual, a los 8,3 s.
--
-- ── Por qué se trocea por REFERENCIA y no por fecha ────────────────────────
--
-- Trocear por días sería lo intuitivo y arruinaría el resultado: un asiento del
-- 30/06 puede cobrarse el 28, y el corte diario parte ese par. Es exactamente
-- la diferencia entre el 88,44 % de un día y el 99,03 % del mes.
--
-- Pero un par SIEMPRE comparte referencia. Así que repartiendo las referencias
-- en bloques por su hash, ningún par queda partido: los dos lados de cada
-- emparejamiento caen en el mismo bloque, sea cual sea su fecha. El resultado es
-- idéntico al de una sola pasada.
-- ============================================================================

-- La versión de dos argumentos se sustituye por la de tres. `create or replace`
-- con otra firma deja viva la anterior y las llamadas quedan ambiguas.
drop function if exists public.conciliar_exacta(text);

create or replace function public.conciliar_exacta(
  p_job_id  text,
  p_bloque  integer default 0,
  p_bloques integer default 1
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
  v_pares bigint;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;
  if v_job.lote_extracto_id is null then
    raise exception 'El job % no tiene extracto cargado en tabla', p_job_id
      using errcode = 'check_violation';
  end if;

  with comps as (
    select
      c.id,
      -- Céntimos CON SIGNO, igual que `01_exacta.js`: en valor absoluto un
      -- cobro casaría con un pago del mismo importe.
      round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100)::bigint as cent,
      upper(regexp_replace(coalesce(c.referencia_externa, c.serie_numero, ''), '[^A-Za-z0-9]', '', 'g')) as ref
    from public.comprobantes c
    where c.empresa_id = v_job.empresa_id
      and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
      and c.estado not in ('cobrado', 'anulado')
  ),
  movs as (
    select
      m.id,
      round(m.monto * 100)::bigint as cent,
      upper(regexp_replace(coalesce(m.referencia_banco, ''), '[^A-Za-z0-9]', '', 'g')) as ref
    from public.movimientos_extracto m
    where m.lote_id = v_job.lote_extracto_id
  ),
  -- El bloque se decide por la REFERENCIA, así que los dos lados de un par
  -- caen siempre juntos. `abs(hashtext(...))` reparte de forma pareja.
  ci as (
    select id, cent, ref,
           row_number() over (partition by cent, ref order by id) as n
      from comps
     where ref <> ''
       and mod(abs(hashtext(ref)), p_bloques) = p_bloque
  ),
  mi as (
    select id, cent, ref,
           row_number() over (partition by cent, ref order by id) as n
      from movs
     where ref <> ''
       and mod(abs(hashtext(ref)), p_bloques) = p_bloque
  ),
  pares as (
    insert into public.matches_conciliacion (
      job_id, empresa_id, comprobante_ids, movimiento_ids,
      metodo, estado_revision, diferencia_monto
    )
    select
      p_job_id, v_job.empresa_id, array[ci.id], array[mi.id],
      'exacta',
      -- `auto` como en el motor: exigir un clic humano en cada match exacto
      -- vaciaría de sentido el producto. Y `auto` descuenta saldo.
      'auto',
      0
    from ci join mi on ci.cent = mi.cent and ci.ref = mi.ref and ci.n = mi.n
    returning 1
  )
  select count(*) into v_pares from pares;

  return v_pares;
end;
$$;

comment on function public.conciliar_exacta(text, integer, integer) is
  'Capa exacta (monto + referencia) como JOIN, troceada por hash de la '
  'referencia para caber en el statement_timeout. Trocear por FECHA partiría '
  'los pares cuyo asiento y cobro caen en días distintos.';

revoke all on function public.conciliar_exacta(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.conciliar_exacta(text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- totales_conciliacion(job) — cuántas partidas hay a cada lado
--
-- Antes lo devolvía `conciliar_exacta`. Al trocearla habría que contarlas en
-- cada bloque, que es trabajo repetido; aquí se piden una vez.
-- ---------------------------------------------------------------------------
create or replace function public.totales_conciliacion(p_job_id text)
returns table (internos bigint, movimientos bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;

  return query
  select
    (select count(*) from public.comprobantes c
      where c.empresa_id = v_job.empresa_id
        and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
        and c.estado not in ('cobrado', 'anulado')),
    (select count(*) from public.movimientos_extracto m
      where m.lote_id = v_job.lote_extracto_id);
end;
$$;

revoke all on function public.totales_conciliacion(text) from public, anon, authenticated;
grant execute on function public.totales_conciliacion(text) to service_role;

drop function if exists public._prueba_timeout();
