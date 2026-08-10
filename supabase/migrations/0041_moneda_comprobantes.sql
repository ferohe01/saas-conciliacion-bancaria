-- ============================================================================
-- 0041_moneda_comprobantes.sql — Los comprobantes tienen moneda
--
-- Hasta ahora un comprobante no decía en qué moneda estaba: se asumía la de la
-- cuenta contra la que se conciliara. Con un solo cliente en soles eso no se
-- nota, y con el primero que factura en dólares produce **dos errores que no
-- protestan**:
--
--   1. UN EMPAREJAMIENTO FALSO. Una factura de 200 USD y un depósito de
--      S/ 200,00 tienen el mismo número: la capa exacta casa por monto +
--      referencia y no mira nada más. El par sale `auto`, se da por conciliado
--      y descuenta el saldo. Es exactamente la clase de fallo que este producto
--      lleva pagando desde los 541 pares con referencia sin relación.
--   2. UN TOTAL SIN SENTIDO. «Te deben 19.221» sumando soles con dólares no
--      responde a ninguna pregunta, y nadie puede saber mirándolo que está mal.
--
-- ⚠️ ESTO NO CONVIERTE. No hay tipo de cambio, ni por fecha ni de ninguna
-- clase: eso es otra funcionalidad (fuente de la tasa, fecha aplicable,
-- tratamiento contable de la diferencia) y hacerla a medias sería peor que no
-- hacerla. Lo que esta migración garantiza es que **las monedas no se mezclen**.
-- ============================================================================

alter table public.comprobantes
  add column if not exists moneda text not null default 'PEN';

alter table public.comprobantes drop constraint if exists comprobantes_moneda_chk;
alter table public.comprobantes
  add constraint comprobantes_moneda_chk check (moneda ~ '^[A-Z]{3}$');

comment on column public.comprobantes.moneda is
  'Moneda del importe (ISO 4217: PEN, USD…). Un comprobante solo se concilia '
  'contra una cuenta de SU misma moneda; no hay conversión. Ver 0041.';

-- ---------------------------------------------------------------------------
-- Relleno de lo ya cargado.
--
-- No hay forma de saber la moneda de un comprobante viejo —por eso existe esta
-- migración—, pero sí hay una pista buena: si TODAS las cuentas bancarias de la
-- empresa están en la misma moneda, sus comprobantes casi seguro también.
--
-- Cuando la empresa tiene cuentas en varias monedas la pista no sirve y se
-- queda el valor por defecto. Es lo honesto: inventar una asignación fila a
-- fila sería peor que dejar un dato que el usuario puede corregir.
-- ---------------------------------------------------------------------------
with unica as (
  select empresa_id, min(moneda) as moneda
    from public.cuentas_bancarias
   group by empresa_id
  having count(distinct moneda) = 1
)
update public.comprobantes c
   set moneda = u.moneda
  from unica u
 where u.empresa_id = c.empresa_id
   and c.moneda <> u.moneda;

-- El emparejamiento filtra por moneda, así que el índice la incluye. Sin esto,
-- la capa exacta vuelve a recorrer filas que va a descartar.
create index if not exists idx_comprobantes_moneda
  on public.comprobantes (empresa_id, moneda);

-- ⚠️ Añadir una columna y reescribir la tabla deja las estadísticas viejas, y
-- el planificador elige planes pensados para lo que ya no hay. Es la lección de
-- la 0029/0030: `residuo_internos` pasó de 1,68 s a superar el timeout sin que
-- cambiara una línea de código.
analyze public.comprobantes;

-- ---------------------------------------------------------------------------
-- ⚠️ EL GRANT, como toda columna nueva desde la 0005 (que revocó el UPDATE
-- amplio y lo reconcede columna a columna). `comprobantes` arrastra el mismo
-- patrón desde la 0020: sin esto, importar falla por permisos.
-- ---------------------------------------------------------------------------
grant insert (moneda), update (moneda) on public.comprobantes to authenticated;


-- ---------------------------------------------------------------------------
-- 1) La capa exacta NO cruza monedas
--
-- Es la guarda que impide el emparejamiento falso. El movimiento bancario no
-- lleva moneda propia: la suya es la de su cuenta, así que se compara contra
-- ella.
-- ---------------------------------------------------------------------------
create or replace function public.pares_exactos(
  p_empresa_id uuid,
  p_lote_id    uuid,
  p_desde      date,
  p_hasta      date,
  p_moneda     text,
  p_bloque     integer default 0,
  p_bloques    integer default 1
)
returns table (comprobante_id uuid, movimiento_id uuid)
language sql
stable
as $$
  with ci as (
    select
      c.id,
      round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100)::bigint as cent,
      c.ref_norm as ref,
      row_number() over (
        partition by round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100), c.ref_norm
        order by c.id
      ) as n
    from public.comprobantes c
    where c.empresa_id = p_empresa_id
      and c.fecha between p_desde and p_hasta
      and c.estado not in ('cobrado', 'anulado')
      and c.ref_norm <> ''
      -- ⚠️ La guarda contra el par falso: 200 USD y S/ 200,00 comparten
      -- número, y sin esta línea la capa exacta los casa y lo marca `auto`.
      and c.moneda = p_moneda
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
    where m.lote_id = p_lote_id
      and m.ref_norm <> ''
      and (p_bloques = 1 or mod(abs(hashtext(m.ref_norm)), p_bloques) = p_bloque)
  )
  select ci.id, mi.id
    from ci
    join mi on ci.cent = mi.cent and ci.ref = mi.ref and ci.n = mi.n
$$;

revoke all on function public.pares_exactos(uuid, uuid, date, date, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.pares_exactos(uuid, uuid, date, date, text, integer, integer)
  to service_role;

-- La firma cambió: la vieja se retira para que nadie la llame sin moneda y
-- vuelva a cruzarlas sin enterarse.
drop function if exists public.pares_exactos(uuid, uuid, date, date, integer, integer);


-- ---------------------------------------------------------------------------
-- 2) `conciliar_exacta` resuelve la moneda de la cuenta del job
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
  v_moneda text;
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

  select cb.moneda into v_moneda
    from public.cuentas_bancarias cb
   where cb.id = v_job.cuenta_id;
  v_moneda := coalesce(v_moneda, 'PEN');

  with pares as (
    insert into public.matches_conciliacion (
      job_id, empresa_id, comprobante_ids, movimiento_ids,
      metodo, estado_revision, diferencia_monto
    )
    select
      p_job_id, v_job.empresa_id, array[p.comprobante_id], array[p.movimiento_id],
      'exacta', 'auto', 0
    from public.pares_exactos(
      v_job.empresa_id, v_job.lote_extracto_id,
      v_job.periodo_desde, v_job.periodo_hasta, v_moneda,
      p_bloque, p_bloques
    ) p
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


-- ---------------------------------------------------------------------------
-- 3) El residuo que va a n8n, también de una sola moneda
--
-- Sin esto, la capa exacta filtraría bien y las heurísticas de n8n volverían a
-- cruzar monedas por monto y fecha — el mismo par falso, una capa más abajo.
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
  v_moneda text;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;

  select cb.moneda into v_moneda
    from public.cuentas_bancarias cb
   where cb.id = v_job.cuenta_id;
  v_moneda := coalesce(v_moneda, 'PEN');

  return query
  with casados as materialized (
    select unnest(m.comprobante_ids) as id
      from public.matches_conciliacion m
     where m.job_id = p_job_id
  )
  select
    c.id,
    c.fecha,
    case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end,
    c.tipo,
    coalesce(nullif(c.referencia_externa, ''), c.serie_numero, ''),
    coalesce(c.razon_social_contraparte, ''),
    coalesce(c.descripcion, '')
  from public.comprobantes c
  where c.empresa_id = v_job.empresa_id
    and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
    and c.estado not in ('cobrado', 'anulado')
    and c.moneda = v_moneda
    and not exists (select 1 from casados k where k.id = c.id)
  order by c.fecha, c.id;
end;
$$;

revoke all on function public.residuo_internos(text) from public, anon, authenticated;
grant execute on function public.residuo_internos(text) to service_role;


-- ---------------------------------------------------------------------------
-- 4) El resumen del Paso 1 cuenta lo de ESTA moneda, y dice qué deja fuera
--
-- Callar los de otra moneda haría que el usuario viera menos comprobantes de
-- los que cargó y pensara que se perdieron — el mismo motivo por el que ya se
-- informa de los que están cobrados.
-- ---------------------------------------------------------------------------
create or replace function public.resumen_comprobantes_periodo(
  p_desde  date,
  p_hasta  date,
  p_moneda text default null
)
returns table (
  registros      bigint,
  suma           numeric,
  total_cargados bigint,
  ya_cobrados    bigint,
  otras_monedas  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id
      from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  )
  select
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and (p_moneda is null or c.moneda = p_moneda)
    ),
    coalesce(sum(
      case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end
    ) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and (p_moneda is null or c.moneda = p_moneda)
    ), 0),
    count(*),
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado = 'cobrado'
    ),
    -- Los del período que quedan fuera SOLO por la moneda.
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and p_moneda is not null
        and c.moneda <> p_moneda
    )
  from public.comprobantes c
  where c.empresa_id in (select empresa_id from mias);
$$;

revoke all on function public.resumen_comprobantes_periodo(date, date, text)
  from public, anon;
grant execute on function public.resumen_comprobantes_periodo(date, date, text)
  to authenticated, service_role;

drop function if exists public.resumen_comprobantes_periodo(date, date);


-- ---------------------------------------------------------------------------
-- 5) La antigüedad de deuda, separada por moneda
--
-- ⚠️ Se devuelve la moneda en cada fila y NO se filtra: la pantalla agrupa y
-- muestra un bloque por moneda. Sumar soles con dólares da un número que no
-- responde a ninguna pregunta, y filtrar por una sola escondería el resto sin
-- que nadie se entere.
--
-- ⚠️⚠️ EL `drop` NO ES OPCIONAL. `create or replace function` **no puede cambiar
-- el tipo de retorno**, y aquí la fila gana una columna (`moneda`):
--
--     ERROR 42P13: cannot change return type of existing function
--     DETAIL: Row type defined by OUT parameters is different.
--
-- Las demás funciones de esta migración no lo necesitan: o conservan su forma
-- de salida (`conciliar_exacta`, `residuo_internos`, `diagnostico_previo`) o
-- cambian de FIRMA —ganan un parámetro— y entonces Postgres crea una función
-- nueva y la vieja se retira aparte (`pares_exactos`,
-- `resumen_comprobantes_periodo`). Esta es la única que cambia el retorno sin
-- cambiar los argumentos.
-- ---------------------------------------------------------------------------
drop function if exists public.resumen_saldos(text, text, boolean, text, date);

create or replace function public.resumen_saldos(
  p_tipo         text,
  p_tramo        text default 'todos',
  p_solo_vencido boolean default false,
  p_busca        text default '',
  p_hoy          date default current_date
)
returns table (
  contraparte text,
  ruc         text,
  tramo       text,
  moneda      text,
  total       numeric,
  documentos  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id
      from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  base as (
    select
      coalesce(nullif(btrim(c.razon_social_contraparte), ''), 'Sin identificar') as contraparte,
      nullif(btrim(c.ruc_contraparte), '') as ruc,
      c.moneda,
      c.saldo,
      case
        when coalesce(c.fecha_vencimiento, c.fecha) >= p_hoy then 'por_vencer'
        when p_hoy - coalesce(c.fecha_vencimiento, c.fecha) <= 30 then 'd1_30'
        when p_hoy - coalesce(c.fecha_vencimiento, c.fecha) <= 60 then 'd31_60'
        when p_hoy - coalesce(c.fecha_vencimiento, c.fecha) <= 90 then 'd61_90'
        else 'd90_mas'
      end as tramo
    from public.comprobantes c
    where c.empresa_id in (select empresa_id from mias)
      and c.saldo > 0
      and c.estado not in ('cobrado', 'anulado')
      and (
        case when p_tipo = 'pago' then c.tipo = 'pago'
             else c.tipo is distinct from 'pago' end
      )
      and (
        p_busca = ''
        or c.razon_social_contraparte ilike '%' || p_busca || '%'
        or c.ruc_contraparte ilike '%' || p_busca || '%'
      )
  )
  select
    b.contraparte,
    max(b.ruc),
    b.tramo,
    b.moneda,
    sum(b.saldo),
    count(*)
  from base b
  where (p_tramo = 'todos' or b.tramo = p_tramo)
    and (not p_solo_vencido or b.tramo <> 'por_vencer')
  group by b.contraparte, b.tramo, b.moneda;
$$;

revoke all on function public.resumen_saldos(text, text, boolean, text, date)
  from public, anon;
grant execute on function public.resumen_saldos(text, text, boolean, text, date)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6) El diagnóstico previo llama a `pares_exactos`, que cambió de firma
--
-- ⚠️ Sin esto la revisión del Paso 3 dejaría de funcionar en cuanto se aplique
-- la migración: la función vieja se elimina más arriba a propósito —para que
-- nadie la invoque sin moneda y vuelva a cruzarlas— y esta se quedaría llamando
-- a algo que ya no existe.
--
-- De paso, la estimación pasa a contar solo los comprobantes de la moneda de la
-- cuenta, que es lo que de verdad va a casar.
-- ---------------------------------------------------------------------------
create or replace function public.diagnostico_previo(
  p_lote_id           uuid,
  p_desde             date,
  p_hasta             date,
  p_limite_estimacion integer default 60000
)
returns table (
  internos                 bigint,
  internos_con_ref         bigint,
  internos_ref_repetida    bigint,
  movimientos              bigint,
  movimientos_con_ref      bigint,
  movimientos_ref_repetida bigint,
  movimientos_abono        bigint,
  movimientos_cargo        bigint,
  movimientos_fuera        bigint,
  movimientos_dia_bajo     bigint,
  refs_compartidas         bigint,
  pares_estimados          bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_moneda text;
  v_int bigint;
  v_mov bigint;
  v_pares bigint := null;
begin
  select ue.empresa_id into v_empresa
    from public.usuarios_empresa ue
   where ue.usuario_id = auth.uid()
   limit 1;
  if v_empresa is null then
    return;
  end if;

  -- La moneda sale de la CUENTA del lote: los movimientos no la llevan propia.
  select cb.moneda into v_moneda
    from public.movimientos_extracto m
    join public.cuentas_bancarias cb on cb.id = m.cuenta_id
   where m.lote_id = p_lote_id
     and m.empresa_id = v_empresa
   limit 1;
  if v_moneda is null then
    return; -- lote de otra empresa, o inexistente
  end if;

  select count(*) into v_int
    from public.comprobantes c
   where c.empresa_id = v_empresa
     and c.fecha between p_desde and p_hasta
     and c.estado not in ('cobrado', 'anulado')
     and c.moneda = v_moneda;

  select count(*) into v_mov
    from public.movimientos_extracto m
   where m.lote_id = p_lote_id
     and m.empresa_id = v_empresa;

  if v_int <= p_limite_estimacion and v_mov <= p_limite_estimacion then
    select count(*) into v_pares
      from public.pares_exactos(v_empresa, p_lote_id, p_desde, p_hasta, v_moneda);
  end if;

  return query
  with ci as materialized (
    select c.ref_norm as ref
      from public.comprobantes c
     where c.empresa_id = v_empresa
       and c.fecha between p_desde and p_hasta
       and c.estado not in ('cobrado', 'anulado')
       and c.moneda = v_moneda
  ),
  mi as materialized (
    select m.ref_norm as ref, m.monto, m.fecha
      from public.movimientos_extracto m
     where m.lote_id = p_lote_id
       and m.empresa_id = v_empresa
  ),
  ci_refs as materialized (
    select ref, count(*) as k from ci where ref <> '' group by ref
  ),
  mi_refs as materialized (
    select ref, count(*) as k from mi where ref <> '' group by ref
  )
  select
    v_int,
    (select count(*) from ci where ref <> ''),
    (select coalesce(sum(k), 0) from ci_refs where k > 1),
    v_mov,
    (select count(*) from mi where ref <> ''),
    (select coalesce(sum(k), 0) from mi_refs where k > 1),
    (select count(*) from mi where monto > 0),
    (select count(*) from mi where monto < 0),
    (select count(*) from mi where fecha < p_desde or fecha > p_hasta),
    (select count(*) from mi where extract(day from fecha) <= 12),
    (select count(*) from ci_refs a join mi_refs b on b.ref = a.ref),
    v_pares;
end;
$$;

revoke all on function public.diagnostico_previo(uuid, date, date, integer)
  from public, anon;
grant execute on function public.diagnostico_previo(uuid, date, date, integer)
  to authenticated, service_role;
