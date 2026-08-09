-- ============================================================================
-- 0038_candidatos_partida.sql — «¿Por qué no se concilió esta partida?»
--
-- Hoy `04_ensamblar.js` etiqueta cada pendiente por su signo ("Posible depósito
-- en tránsito" / "Posible cheque no cobrado"), o sea que dice lo mismo de las
-- 4.382 partidas del residuo. El usuario ve "sin conciliar" y no tiene por
-- dónde empezar, mientras el sistema SÍ sabe por qué: están los montos, las
-- referencias, las fechas y qué movimiento se llevó cada par.
--
-- ⚠️ Esta función NO diagnostica: **busca**. Devuelve los movimientos que
-- podrían haberle correspondido a una partida, y decidir qué significa eso es
-- cosa de `src/lib/diagnosticoPartida.ts`, que es puro y tiene tests.
--
-- El reparto no es capricho. Las partidas viven en dos sitios según el tamaño
-- del job —en tablas, o dentro del JSONB `payload_entrada`—, así que decidir en
-- SQL obligaría a escribir el diagnóstico dos veces. Aquí SQL hace lo que hace
-- bien (buscar por índice) y la decisión vive en un solo lugar.
--
-- La búsqueda es para UNA partida, bajo demanda. Lo que es prohibitivo para
-- 4.382 es trivial para una.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Índices que la búsqueda necesita
-- ---------------------------------------------------------------------------

-- Saber si un MOVIMIENTO ya está casado. La 0023 creó el gin de
-- `comprobante_ids` pero no el del otro lado, y "se lo llevó otra partida" es
-- justo la consulta que lo necesita.
create index if not exists idx_matches_movimientos
  on public.matches_conciliacion using gin (movimiento_ids);

-- Buscar movimientos por importe dentro de una carga. Sin esto, cada
-- diagnóstico recorre las 450.999 filas del lote.
create index if not exists idx_mov_extracto_lote_monto
  on public.movimientos_extracto (lote_id, monto);


-- ---------------------------------------------------------------------------
-- Candidatos para un comprobante sin conciliar
--
-- Solo el lado interno. Es el que le importa al cliente —son sus facturas— y
-- el simétrico se puede añadir después sin cambiar nada de esto.
--
-- Cuatro fuentes, todas acotadas y por índice:
--   a) misma referencia normalizada
--   b) mismo importe con signo
--   c) mismo importe en valor absoluto (para detectar el signo cambiado)
--   d) cerca en fecha, los más parecidos en importe
--
-- ⚠️ `security definer` con la empresa resuelta desde `auth.uid()`, nunca por
-- parámetro. Mismo patrón que `resumen_saldos` (0021) y `diagnostico_previo`
-- (0037).
-- ---------------------------------------------------------------------------
create or replace function public.candidatos_partida(
  p_job_id         text,
  p_comprobante_id uuid,
  p_dias           integer default 30,
  p_max            integer default 25
)
returns table (
  id          uuid,
  fecha       date,
  monto       numeric,
  glosa       text,
  referencia  text,
  ocupado_por text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_lote    uuid;
  v_fecha   date;
  v_monto   numeric;
  v_ref     text;
begin
  select ue.empresa_id into v_empresa
    from public.usuarios_empresa ue
   where ue.usuario_id = auth.uid()
   limit 1;
  if v_empresa is null then
    return;
  end if;

  -- El job tiene que ser de ESTA empresa: sin esta línea, un job_id ajeno
  -- devolvería movimientos del extracto de otro cliente.
  select j.lote_extracto_id into v_lote
    from public.jobs_conciliacion j
   where j.id = p_job_id
     and j.empresa_id = v_empresa;
  if v_lote is null then
    return; -- job de otra empresa, inexistente, o en modo payload
  end if;

  -- La partida, con el signo ya aplicado (convención única: cobros +, pagos −).
  select c.fecha,
         case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end,
         c.ref_norm
    into v_fecha, v_monto, v_ref
    from public.comprobantes c
   where c.id = p_comprobante_id
     and c.empresa_id = v_empresa;
  if not found then
    return;
  end if;

  return query
  with candidatos as (
    (select m.id from public.movimientos_extracto m
      where m.lote_id = v_lote and v_ref <> '' and m.ref_norm = v_ref
      limit 10)
    union
    (select m.id from public.movimientos_extracto m
      where m.lote_id = v_lote and m.monto = v_monto
      limit 10)
    union
    (select m.id from public.movimientos_extracto m
      where m.lote_id = v_lote and m.monto = -v_monto
      limit 5)
    union
    (select m.id from public.movimientos_extracto m
      where m.lote_id = v_lote
        and m.fecha between v_fecha - p_dias and v_fecha + p_dias
      order by abs(m.monto - v_monto)
      limit 10)
  )
  select
    m.id,
    m.fecha,
    m.monto,
    coalesce(m.glosa, ''),
    coalesce(m.referencia_banco, ''),
    -- Con qué comprobante quedó casado, si lo está. Es el dato que hace
    -- posible el diagnóstico más valioso y hoy invisible: "había un movimiento
    -- que casaba, pero se lo llevó otra factura".
    (
      select coalesce(c2.serie_numero, c2.referencia_externa, c2.id::text)
        from public.matches_conciliacion mc
        join public.comprobantes c2 on c2.id = mc.comprobante_ids[1]
       where mc.job_id = p_job_id
         and mc.movimiento_ids @> array[m.id]
       limit 1
    )
  from candidatos k
  join public.movimientos_extracto m on m.id = k.id
  limit p_max;
end;
$$;

revoke all on function public.candidatos_partida(text, uuid, integer, integer)
  from public, anon;
grant execute on function public.candidatos_partida(text, uuid, integer, integer)
  to authenticated, service_role;

comment on function public.candidatos_partida(text, uuid, integer, integer) is
  'Movimientos que podrían corresponder a un comprobante sin conciliar. BUSCA, '
  'no diagnostica: la interpretación vive en src/lib/diagnosticoPartida.ts. '
  'La empresa sale de auth.uid(); nunca por parámetro.';
