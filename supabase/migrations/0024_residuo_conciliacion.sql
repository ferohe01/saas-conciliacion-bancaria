-- ============================================================================
-- 0024_residuo_conciliacion.sql — Lo que queda para n8n (parte B, etapa 3)
--
-- Tras `conciliar_exacta` (0023), la inmensa mayoría de las partidas ya están
-- casadas. Lo que el motor tiene que mirar es solo lo que sobró: con junio
-- completo de la recaudadora, 4.382 internos y 3.204 movimientos de 903.176.
--
-- El backend NO puede calcular ese residuo trayéndose las partidas y restando:
-- serían las 900.000 otra vez, que es justo lo que estamos evitando. Se lo pide
-- a la base, que ya sabe cuáles casaron.
--
-- Las dos funciones devuelven las filas EN LA FORMA DEL CONTRATO
-- (`RegistroInterno` / `MovimientoBancario` de src/lib/contract/payload.ts),
-- para que el backend solo tenga que validarlas con zod y enviarlas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- residuo_internos(job) — comprobantes del período que no casaron
-- ---------------------------------------------------------------------------
create or replace function public.residuo_internos(p_job_id text)
returns table (
  comprobante_id uuid,
  fecha          date,
  monto          numeric,
  tipo           text,
  referencia     text,
  contraparte    text,
  descripcion    text
)
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
  -- ⚠️ `materialized` y anti-union, NO `c.id = any(m.comprobante_ids)`.
  --
  -- Con `any(array)` Postgres recorre los 447.795 matches POR CADA uno de los
  -- 452.177 comprobantes: la consulta no acabo en diez minutos. Desplegando los
  -- arrays UNA vez a un conjunto de ids, el planificador hace un anti-join por
  -- hash y baja a segundos. El indice GIN no salva esto: el problema es el
  -- numero de veces que se pregunta, no como se busca.
  with casados as materialized (
    select unnest(m.comprobante_ids) as id
      from public.matches_conciliacion m
     where m.job_id = p_job_id
  )
  select
    c.id,
    c.fecha,
    -- Convención de signos ÚNICA: cobranza +, pago −.
    case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end,
    case when c.tipo = 'pago' then 'pago' else 'cobranza' end,
    -- `referencia_externa` manda cuando existe; si no, el número de documento.
    coalesce(c.referencia_externa, c.serie_numero),
    c.razon_social_contraparte,
    c.descripcion
  from public.comprobantes c
  where c.empresa_id = v_job.empresa_id
    and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
    and c.estado not in ('cobrado', 'anulado')
    -- Lo que ya casó la capa exacta no vuelve a mirarse.
    and not exists (select 1 from casados k where k.id = c.id)
  -- Orden TOTAL: el id sintético del payload sale de la posición, y tiene que
  -- ser el mismo si el backend vuelve a pedirlo.
  order by c.fecha, c.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- residuo_movimientos(job) — movimientos del extracto que no casaron
-- ---------------------------------------------------------------------------
create or replace function public.residuo_movimientos(p_job_id text)
returns table (
  movimiento_id    uuid,
  fecha            date,
  monto            numeric,
  tipo             text,
  glosa            text,
  referencia_banco text
)
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
  if v_job.lote_extracto_id is null then
    raise exception 'El job % no tiene extracto cargado en tabla', p_job_id
      using errcode = 'check_violation';
  end if;

  return query
  -- Misma razon que en `residuo_internos`: el conjunto de casados se despliega
  -- una vez y se resta por hash.
  with casados as materialized (
    select unnest(mm.movimiento_ids) as id
      from public.matches_conciliacion mm
     where mm.job_id = p_job_id
  )
  select
    m.id,
    m.fecha,
    m.monto,
    case when m.monto < 0 then 'cargo' else 'abono' end,
    m.glosa,
    m.referencia_banco
  from public.movimientos_extracto m
  where m.lote_id = v_job.lote_extracto_id
    and not exists (select 1 from casados k where k.id = m.id)
  order by m.fecha, m.orden, m.id;
end;
$$;

comment on function public.residuo_internos(text) is
  'Comprobantes del período que la capa exacta no caso. Forma del contrato.';
comment on function public.residuo_movimientos(text) is
  'Movimientos del extracto que la capa exacta no caso. Forma del contrato.';

-- Las invoca el backend con service_role, nunca el navegador.
revoke all on function public.residuo_internos(text) from public, anon, authenticated;
revoke all on function public.residuo_movimientos(text) from public, anon, authenticated;
grant execute on function public.residuo_internos(text) to service_role;
grant execute on function public.residuo_movimientos(text) to service_role;
