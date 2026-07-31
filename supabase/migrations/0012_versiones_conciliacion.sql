-- ============================================================================
-- 0012_versiones_conciliacion.sql — Ciclo de vida contable y versiones
--
-- Hasta aquí una conciliación era solo un job técnico: se lanzaba, corría en
-- n8n y quedaba `completado`. Nada distinguía "esta es la buena" de "esta la
-- re-corrí porque los datos venían mal". Con dos corridas del mismo período
-- conviviendo como iguales, los reportes sumaban dos veces el mismo mes y el
-- saldo de los comprobantes podía descontarse dos veces (`aplicaciones_cobro`
-- lleva `job_id` en su clave única, así que dos jobs aplican por separado).
--
-- Esta migración separa DOS EJES que antes estaban confundidos en uno:
--
--   `estado`          — ciclo técnico del procesamiento en n8n
--                       (pendiente | procesando | completado | error)
--   `estado_contable` — ciclo de vida del documento contable
--                       (borrador | en_proceso | observada | aprobada |
--                        anulada | reemplazada)
--
-- Son ortogonales a propósito: un job puede estar técnicamente `completado` y
-- contablemente `borrador`, o estar `aprobada` mientras se reprocesa una
-- corrección. Meterlos en una sola columna haría inexpresables esos estados.
--
-- REGLA CENTRAL, impuesta por la base y no por la aplicación: no puede existir
-- más de una conciliación APROBADA que cubra el mismo rango de fechas de la
-- misma cuenta. Varias conciliaciones por cortes distintos (1-10, 11-20,
-- 21-31) son legítimas y el constraint las permite porque no se solapan.
-- Varias corridas del mismo rango también, pero solo una puede estar aprobada;
-- las demás quedan como `reemplazada` o `anulada`, conservando la trazabilidad.
-- ============================================================================

-- `exclude using gist` con una columna uuid comparada por `=` necesita esto.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.jobs_conciliacion
  add column if not exists estado_contable       text not null default 'borrador',
  add column if not exists version                integer not null default 1,
  add column if not exists conciliacion_origen_id text,
  add column if not exists fecha_aprobacion       timestamptz,
  add column if not exists usuario_aprobador      uuid,
  add column if not exists numero_estado_cuenta   text,
  add column if not exists saldo_inicial_banco    numeric(14, 2),
  add column if not exists saldo_final_banco      numeric(14, 2);

comment on column public.jobs_conciliacion.estado_contable is
  'Ciclo de vida contable. Ortogonal a `estado`, que es el del procesamiento.';
comment on column public.jobs_conciliacion.version is
  'Nº de corrida sobre el mismo cuenta+rango. La primera es 1.';
comment on column public.jobs_conciliacion.conciliacion_origen_id is
  'Job del que esta corrida es reproceso. NULL si es la primera.';
comment on column public.jobs_conciliacion.numero_estado_cuenta is
  'Identificador del estado de cuenta del banco, para no importarlo dos veces.';
comment on column public.jobs_conciliacion.saldo_inicial_banco is
  'Saldo inicial del extracto. Se promueve a columna para poder validar que '
  'encadene con el saldo final del corte anterior, cosa que dentro del JSONB '
  'del resultado no se puede consultar.';

-- Claves foráneas aparte: `add column ... references` no admite IF NOT EXISTS,
-- así que se añaden de forma re-ejecutable.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_origen_fk'
  ) then
    alter table public.jobs_conciliacion
      add constraint jobs_origen_fk
      foreign key (conciliacion_origen_id)
      references public.jobs_conciliacion (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'jobs_aprobador_fk'
  ) then
    alter table public.jobs_conciliacion
      add constraint jobs_aprobador_fk
      foreign key (usuario_aprobador)
      references auth.users (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Backfill de lo que ya existe
--
-- Los jobs previos no tienen estado contable. Se les asigna el que refleja
-- cómo los venía tratando el sistema: los reportes ya se quedaban con la
-- corrida más reciente de cada período, así que esa pasa a `aprobada` y las
-- anteriores a `reemplazada`.
--
-- `usuario_aprobador` queda en NULL a propósito: nadie aprobó estas
-- conciliaciones a mano. Un NULL ahí significa "aprobación implícita heredada
-- de la migración", y se distingue de una aprobación humana real.
-- ---------------------------------------------------------------------------
-- El backfill es de una sola vez. `apply_all.sql` es re-ejecutable, y una
-- segunda pasada no debe aprobar sola las conciliaciones en borrador que hayan
-- nacido después — aprobar es justo el acto humano que la Fase B viene a
-- exigir. El centinela es el propio constraint de exclusión, que se crea más
-- abajo: si ya existe, 0012 ya se aplicó y aquí no hay nada que hacer.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'jobs_una_aprobada_por_rango'
  ) then
    raise notice '0012: backfill omitido, ya se habia aplicado';
    return;
  end if;

  with ordenadas as (
    select
      id,
      row_number() over (
        partition by cuenta_id, periodo_desde, periodo_hasta
        order by created_at
      ) as v_asc,
      row_number() over (
        partition by cuenta_id, periodo_desde, periodo_hasta
        order by created_at desc
      ) as v_desc
    from public.jobs_conciliacion
  )
  update public.jobs_conciliacion j
     set version = o.v_asc,
         estado_contable = case
           when j.estado <> 'completado' then 'borrador'
           when o.v_desc = 1             then 'aprobada'
           else                               'reemplazada'
         end,
         fecha_aprobacion = case
           when j.estado = 'completado' and o.v_desc = 1
             then coalesce(j.completed_at, j.created_at)
           else null
         end
    from ordenadas o
   where o.id = j.id;
end $$;

-- ---------------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------------
alter table public.jobs_conciliacion
  drop constraint if exists jobs_estado_contable_chk;
alter table public.jobs_conciliacion
  add constraint jobs_estado_contable_chk
  check (estado_contable in (
    'borrador', 'en_proceso', 'observada', 'aprobada', 'anulada', 'reemplazada'
  ));

alter table public.jobs_conciliacion
  drop constraint if exists jobs_version_chk;
alter table public.jobs_conciliacion
  add constraint jobs_version_chk check (version >= 1);

-- Una aprobación sin fecha no es una aprobación.
alter table public.jobs_conciliacion
  drop constraint if exists jobs_aprobacion_chk;
alter table public.jobs_conciliacion
  add constraint jobs_aprobacion_chk
  check (estado_contable <> 'aprobada' or fecha_aprobacion is not null);

-- Un reproceso no puede declararse origen de sí mismo.
alter table public.jobs_conciliacion
  drop constraint if exists jobs_origen_no_circular_chk;
alter table public.jobs_conciliacion
  add constraint jobs_origen_no_circular_chk
  check (conciliacion_origen_id is null or conciliacion_origen_id <> id);

-- LA REGLA: como máximo una aprobada por cuenta y rango solapado.
--
-- Si esta línea falla al aplicar la migración, NO es un fallo del script: hay
-- conciliaciones con períodos que se solapan de verdad y alguien tiene que
-- decidir cuál vale. Para encontrarlas:
--
--   select a.id, a.periodo_desde, a.periodo_hasta,
--          b.id, b.periodo_desde, b.periodo_hasta
--     from public.jobs_conciliacion a
--     join public.jobs_conciliacion b
--       on a.cuenta_id = b.cuenta_id
--      and a.id < b.id
--      and a.estado_contable = 'aprobada'
--      and b.estado_contable = 'aprobada'
--      and daterange(a.periodo_desde, a.periodo_hasta, '[]')
--       && daterange(b.periodo_desde, b.periodo_hasta, '[]');
--
-- y dejar en 'reemplazada' las que no deban regir.
alter table public.jobs_conciliacion
  drop constraint if exists jobs_una_aprobada_por_rango;
alter table public.jobs_conciliacion
  add constraint jobs_una_aprobada_por_rango
  exclude using gist (
    cuenta_id with =,
    daterange(periodo_desde, periodo_hasta, '[]') with &&
  ) where (estado_contable = 'aprobada');

-- ---------------------------------------------------------------------------
-- Índices de consulta
-- ---------------------------------------------------------------------------
create index if not exists jobs_estado_contable_idx
  on public.jobs_conciliacion (empresa_id, estado_contable);

create index if not exists jobs_cuenta_periodo_idx
  on public.jobs_conciliacion (cuenta_id, periodo_desde, periodo_hasta);
