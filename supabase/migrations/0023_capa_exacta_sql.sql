-- ============================================================================
-- 0023_capa_exacta_sql.sql — La capa exacta corre en la base (parte B, etapa 2)
--
-- El motor de n8n recibe las partidas por el payload y las empareja en
-- JavaScript. A 2.000 partidas eso es instantáneo; a 900.000 no llega ni a
-- enviarse. Pero la capa exacta —mismo monto y misma referencia— es
-- literalmente un JOIN, y Postgres lo hace sobre medio millón de filas en
-- segundos.
--
-- Con la recaudadora de junio eso significa resolver ~450.000 pares SIN que
-- n8n vea una sola fila, y mandarle solo el residuo: miles, no cientos de
-- miles.
--
-- ⚠️ SOLO EL PASS 1 (monto + referencia). El respaldo por monto + FECHA se
-- queda en n8n a propósito: necesita la guarda de contradicción de referencias
-- —sin ella emparejó 541 pares sin relación y los marcó `auto`, o sea
-- conciliados sin que nadie los mirara— y esa lógica ya está escrita, probada y
-- documentada en `n8n/01_exacta.js`. Reescribirla aquí sería duplicar el punto
-- exacto donde el motor puede equivocarse en silencio.
--
-- n8n vuelve a correr su capa exacta sobre el residuo: el pass 1 no encontrará
-- nada nuevo (ya lo hizo esta función) y el pass 2 hará su trabajo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- matches_conciliacion — los pares, en una TABLA
--
-- `resultado` es un JSONB en una fila del job. A 2.000 partidas basta; con
-- 450.000 pares serían cientos de MB que hay que leer enteros para pintar una
-- pantalla. Aquí caben, se paginan y se actualizan de uno en uno.
--
-- Arrays en los dos lados porque un match puede ser 1:N o N:1 (la agrupación
-- que ya detecta el motor). La capa exacta siempre escribe uno y uno.
-- ---------------------------------------------------------------------------
create table if not exists public.matches_conciliacion (
  id                   uuid primary key default gen_random_uuid(),
  job_id               text not null references public.jobs_conciliacion (id) on delete cascade,
  empresa_id           uuid not null references public.empresas (id) on delete cascade,
  comprobante_ids      uuid[] not null default '{}',
  movimiento_ids       uuid[] not null default '{}',
  metodo               text not null,
  estado_revision      text not null,
  confianza            numeric(4,3),
  categoria_diferencia text,
  diferencia_monto     numeric(14,2),
  diferencia_dias      integer,
  justificacion        text,
  -- Cada decisión humana, con usuario y timestamp. Es la materia prima del
  -- aprendizaje y no se pierde ninguna (mismo criterio que en el JSONB).
  decisiones           jsonb not null default '[]'::jsonb,
  excluido_aprendizaje boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint matches_metodo_chk
    check (metodo in ('exacta', 'difusa', 'ia', 'manual')),
  constraint matches_estado_chk
    check (estado_revision in ('auto', 'pendiente', 'aceptado', 'rechazado', 'modificado'))
);

create index if not exists idx_matches_job on public.matches_conciliacion (job_id);
create index if not exists idx_matches_job_estado
  on public.matches_conciliacion (job_id, estado_revision);
-- Para saber si un comprobante ya está casado en este job sin recorrer la tabla.
create index if not exists idx_matches_comprobantes
  on public.matches_conciliacion using gin (comprobante_ids);

alter table public.matches_conciliacion enable row level security;

drop policy if exists matches_select on public.matches_conciliacion;
create policy matches_select on public.matches_conciliacion
  for select to authenticated
  using (public.es_miembro(empresa_id));

comment on table public.matches_conciliacion is
  'Pares conciliados. Sustituye a resultado.matches (JSONB) cuando el volumen '
  'no cabe en una fila. Arrays en ambos lados: soporta 1:N y N:1.';

-- ---------------------------------------------------------------------------
-- conciliar_exacta(job) — el JOIN
--
-- SECURITY DEFINER y concedida SOLO a `service_role`: la invoca el backend
-- después de crear el job, nunca el navegador. No hay `auth.uid()` de por
-- medio, así que la pertenencia sale del propio job.
-- ---------------------------------------------------------------------------
create or replace function public.conciliar_exacta(p_job_id text)
returns table (pares bigint, internos bigint, movimientos bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
  v_pares bigint;
  v_int   bigint;
  v_mov   bigint;
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

  -- Reentrante: volver a lanzarla no duplica pares.
  delete from public.matches_conciliacion
   where job_id = p_job_id and metodo = 'exacta';

  with comps as (
    select
      c.id,
      -- Misma convención de signos que el resto del sistema: cobranza +,
      -- pago −. Y los MISMOS céntimos con signo que usa `01_exacta.js`; en
      -- valor absoluto un cobro casaría con un pago del mismo importe.
      round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100)::bigint as cent,
      -- `referencia_externa` manda cuando existe; si no, el número de
      -- documento. Igual que `getComprobantesCanonicos`.
      upper(regexp_replace(coalesce(c.referencia_externa, c.serie_numero, ''), '[^A-Za-z0-9]', '', 'g')) as ref
    from public.comprobantes c
    where c.empresa_id = v_job.empresa_id
      and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
      -- Lo ya cobrado y lo anulado no vuelve a conciliarse: es la primera de
      -- las tres capas contra el doble cobro.
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
  -- ⚠️ El `row_number` reproduce el "toma el siguiente libre" del JavaScript.
  -- Con cientos de recibos del mismo importe y la misma referencia, un JOIN a
  -- secas daría el producto cartesiano: 300 × 300 = 90.000 pares en vez de 300.
  -- Numerando cada lado dentro de su grupo y casando por número, cada partida
  -- se empareja UNA vez.
  ci as (
    select id, cent, ref,
           row_number() over (partition by cent, ref order by id) as n
      from comps where ref <> ''
  ),
  mi as (
    select id, cent, ref,
           row_number() over (partition by cent, ref order by id) as n
      from movs where ref <> ''
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

  select count(*) into v_int from public.comprobantes c
   where c.empresa_id = v_job.empresa_id
     and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
     and c.estado not in ('cobrado', 'anulado');
  select count(*) into v_mov from public.movimientos_extracto m
   where m.lote_id = v_job.lote_extracto_id;

  return query select v_pares, v_int, v_mov;
end;
$$;

comment on function public.conciliar_exacta(text) is
  'Capa exacta (monto + referencia) como JOIN. Escribe en matches_conciliacion '
  'y deja el residuo para n8n. El respaldo por monto+fecha NO está aquí: vive '
  'en n8n/01_exacta.js con su guarda de contradicción de referencias.';

revoke all on function public.conciliar_exacta(text) from public, anon, authenticated;
grant execute on function public.conciliar_exacta(text) to service_role;
