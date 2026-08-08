-- ============================================================================
-- 0029_referencia_normalizada.sql — La referencia, ya normalizada en la fila
--
-- La capa exacta casa por `upper(regexp_replace(referencia, '[^A-Za-z0-9]',''))`
-- y lo calculaba EN CADA CONCILIACIÓN, para las 903.176 partidas. Ese trabajo
-- de cadenas es el grueso de los 32 s que tardaba, y no se puede indexar: el
-- planificador tiene que leer y transformar cada fila antes de poder juntar
-- nada.
--
-- Trocear no lo arregla. Se intentó repartir por bloques de hash de la
-- referencia —correcto, porque un par siempre comparte referencia y así ninguno
-- queda partido— pero cada bloque **vuelve a recorrer y normalizar las 900.000
-- filas** y solo se reduce el join: 8 bloques de ~8 s cada uno, la mayoría
-- cancelados por el `statement_timeout`. Trocear reparte el join, no el escaneo.
--
-- Aquí la normalización se hace UNA vez, al insertar, y queda en una columna
-- indexable. El coste se mueve de "cada conciliación" a "cada fila, una vez".
--
-- ⚠️ La expresión tiene que ser EXACTAMENTE la de `n8n/01_exacta.js`
-- (`normRef`), que es quien concilia el residuo. Si divergieran, un par casaría
-- en SQL y no en el motor, o al revés, y la diferencia sería invisible.
-- ============================================================================

alter table public.comprobantes
  add column if not exists ref_norm text
  generated always as (
    upper(regexp_replace(
      coalesce(referencia_externa, serie_numero, ''), '[^A-Za-z0-9]', '', 'g'
    ))
  ) stored;

alter table public.movimientos_extracto
  add column if not exists ref_norm text
  generated always as (
    upper(regexp_replace(coalesce(referencia_banco, ''), '[^A-Za-z0-9]', '', 'g'))
  ) stored;

-- Índices parciales: las filas sin referencia no participan del emparejamiento
-- por código, y en una empresa que factura sin número son la mayoría.
create index if not exists idx_comprobantes_ref_norm
  on public.comprobantes (empresa_id, ref_norm)
  where ref_norm <> '';

create index if not exists idx_mov_extracto_ref_norm
  on public.movimientos_extracto (lote_id, ref_norm)
  where ref_norm <> '';

comment on column public.comprobantes.ref_norm is
  'Referencia normalizada para emparejar (mayúsculas, sin separadores). Misma '
  'expresión que `normRef` en n8n/01_exacta.js.';
comment on column public.movimientos_extracto.ref_norm is
  'Referencia del banco normalizada. Ver comprobantes.ref_norm.';

-- ---------------------------------------------------------------------------
-- La capa exacta, ahora sobre columnas ya normalizadas.
--
-- Se conservan los bloques: siguen siendo la red por si un cliente aún mayor
-- vuelve a rozar el techo, y con `p_bloques = 1` (el valor por defecto) es una
-- sola pasada.
-- ---------------------------------------------------------------------------
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

  with ci as (
    select
      c.id,
      -- Céntimos CON SIGNO, igual que `01_exacta.js`: en valor absoluto un
      -- cobro casaría con un pago del mismo importe.
      round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100)::bigint as cent,
      c.ref_norm as ref,
      row_number() over (
        partition by round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100), c.ref_norm
        order by c.id
      ) as n
    from public.comprobantes c
    where c.empresa_id = v_job.empresa_id
      and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
      and c.estado not in ('cobrado', 'anulado')
      and c.ref_norm <> ''
      and (p_bloques = 1 or mod(abs(hashtext(c.ref_norm)), p_bloques) = p_bloque)
  ),
  mi as (
    select
      m.id,
      round(m.monto * 100)::bigint as cent,
      m.ref_norm as ref,
      row_number() over (
        partition by round(m.monto * 100), m.ref_norm order by m.id
      ) as n
    from public.movimientos_extracto m
    where m.lote_id = v_job.lote_extracto_id
      and m.ref_norm <> ''
      and (p_bloques = 1 or mod(abs(hashtext(m.ref_norm)), p_bloques) = p_bloque)
  ),
  pares as (
    insert into public.matches_conciliacion (
      job_id, empresa_id, comprobante_ids, movimiento_ids,
      metodo, estado_revision, diferencia_monto
    )
    select
      p_job_id, v_job.empresa_id, array[ci.id], array[mi.id],
      'exacta', 'auto', 0
    from ci join mi on ci.cent = mi.cent and ci.ref = mi.ref and ci.n = mi.n
    returning 1
  )
  select count(*) into v_pares from pares;

  return v_pares;
end;
$$;

revoke all on function public.conciliar_exacta(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.conciliar_exacta(text, integer, integer)
  to service_role;
