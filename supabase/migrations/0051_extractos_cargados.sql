-- ============================================================================
-- 0051_extractos_cargados.sql — Qué extracto está subido, y para qué
--
-- Fase 2 del módulo de caja (ver docs/diseno-saldo-vivo.md). La fase 1 dice
-- cuánto había al cierre del último período conciliado; esto permite decir
-- cuánto hay HOY, sin fingir que está conciliado.
--
-- ── El problema que resuelve la tabla ──────────────────────────────────────
--
-- `movimientos_extracto.lote_id` es un uuid suelto: no hay fila que describa la
-- carga. Y los lotes HUÉRFANOS se acumulan —el Paso 2 del wizard crea el lote
-- antes de que el Paso 3 dispare nada, así que todo intento abandonado deja
-- uno, y no hay ni un `delete` de esa tabla en toda la aplicación—.
--
-- ⚠️⚠️ Por eso «el último lote sin job» NO sirve para saber cuál es el extracto
-- vigente: dejaría que un intento abandonado mandara sobre la caja, y sería
-- invisible — un número plausible, con fecha reciente, sacado de un archivo que
-- alguien decidió no usar.
--
-- `origen` es la pieza que lo cierra: solo un extracto subido **desde /caja a
-- propósito** cuenta como saldo vivo. El del wizard sirve para conciliar y su
-- vida acaba ahí. Son dos intenciones distintas y confundirlas es el fallo de
-- arriba.
--
-- Mismo remedio que la 0043 aplicó a las cargas de comprobantes: hacer
-- explícito lo que hasta ahora se infería.
-- ============================================================================

create table if not exists public.extractos_cargados (
  lote_id         uuid primary key,
  empresa_id      uuid not null references public.empresas (id) on delete cascade,
  cuenta_id       uuid not null references public.cuentas_bancarias (id) on delete cascade,
  -- Rango REAL de las filas cargadas, no el período que el usuario pidió.
  fecha_min       date,
  fecha_max       date,
  filas           integer not null default 0,
  -- El saldo de la última fila del archivo, cuando el extracto trae esa
  -- columna. Es el que DECLARA EL BANCO: no es un cálculo nuestro, así que no
  -- puede tener un error nuestro.
  saldo_declarado numeric(14,2),
  -- 'wizard' = subido para conciliar · 'caja' = subido para ver el saldo de hoy
  origen          text not null default 'wizard'
                    check (origen in ('wizard', 'caja')),
  subido_por      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);

-- El recorrido natural: el extracto vigente de cada cuenta.
create index if not exists idx_extractos_cargados_vigente
  on public.extractos_cargados (empresa_id, cuenta_id, origen, fecha_max desc);

-- ---------------------------------------------------------------------------
-- RLS. Lectura para los miembros; las escrituras las hace el backend con
-- `service_role` desde la ruta de ingesta, igual que `importaciones_comprobantes`
-- (0043): es una ficha del sistema, no algo que el usuario declare a mano.
--
-- El DELETE sí es del usuario: quitar un extracto subido por error tiene que
-- poder hacerse sin pasar por soporte.
-- ---------------------------------------------------------------------------
alter table public.extractos_cargados enable row level security;

drop policy if exists extractos_cargados_select on public.extractos_cargados;
create policy extractos_cargados_select on public.extractos_cargados
  for select to authenticated
  using (public.es_miembro(empresa_id));

drop policy if exists extractos_cargados_delete on public.extractos_cargados;
create policy extractos_cargados_delete on public.extractos_cargados
  for delete to authenticated
  using (public.es_miembro(empresa_id));

comment on table public.extractos_cargados is
  'Ficha de cada carga de extracto. `origen` distingue lo subido para conciliar '
  'de lo subido para ver el saldo de hoy: solo esto último cuenta como saldo vivo.';


-- ============================================================================
-- extracto_vigente() — los HECHOS del extracto sin conciliar de cada cuenta
--
-- ⚠️ SQL busca, TypeScript decide. Esta función no elige el saldo vivo ni juzga
-- si ha caducado: devuelve lo consultable y `src/lib/saldoVivo.ts` —puro y con
-- tests— decide. Mismo criterio que `candidatos_partida` (0038): una regla de
-- negocio que vive en SQL no se puede probar sin una base delante.
-- ============================================================================

create or replace function public.extracto_vigente()
returns table (
  cuenta_id        uuid,
  lote_id          uuid,
  fecha_min        date,
  fecha_max        date,
  filas            integer,
  saldo_declarado  numeric,
  subido_en        timestamptz,
  -- Hasta dónde llega la última conciliación aprobada de esa cuenta.
  corte_aprobado   date,
  -- Movimientos del lote POSTERIORES a ese corte, para poder derivar el saldo
  -- cuando el archivo no trae columna de saldo.
  suma_posterior   numeric,
  movs_posteriores bigint
)
language sql
stable
-- ⚠️ SECURITY DEFINER con la empresa resuelta desde auth.uid(), nunca por
-- parámetro. Ver la nota de `resumen_saldos` (0021).
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id
      from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  -- El extracto vigente de cada cuenta: el más reciente de los subidos DESDE
  -- CAJA. Los del wizard no participan (ver la cabecera de la migración).
  vig as (
    select distinct on (e.cuenta_id) e.*
      from public.extractos_cargados e
     where e.empresa_id in (select empresa_id from mias)
       and e.origen = 'caja'
     order by e.cuenta_id, e.fecha_max desc nulls last, e.created_at desc
  ),
  corte as (
    select j.cuenta_id, max(j.periodo_hasta) as hasta
      from public.jobs_conciliacion j
     where j.empresa_id in (select empresa_id from mias)
       and j.estado_contable = 'aprobada'
     group by j.cuenta_id
  )
  select
    v.cuenta_id, v.lote_id, v.fecha_min, v.fecha_max, v.filas,
    v.saldo_declarado, v.created_at,
    c.hasta,
    coalesce(p.suma, 0),
    coalesce(p.n, 0)
  from vig v
  left join corte c on c.cuenta_id = v.cuenta_id
  -- ⚠️ LA GUARDA DE SOLAPE, y no es opcional: solo entran los movimientos
  -- POSTERIORES al último corte aprobado. Un extracto que empieza el 01/08
  -- sobre un aprobado que llega al 31/07 va bien; uno que empieza el 25/07
  -- —lo normal al descargar «los últimos 30 días»— contaría cinco días dos
  -- veces y daría un saldo alto y perfectamente plausible.
  left join lateral (
    select sum(m.monto) as suma, count(*) as n
      from public.movimientos_extracto m
     where m.lote_id = v.lote_id
       and (c.hasta is null or m.fecha > c.hasta)
  ) p on true;
$$;

comment on function public.extracto_vigente() is
  'Hechos del extracto subido desde /caja y aún sin conciliar, por cuenta. No '
  'decide el saldo vivo ni si caducó: eso es src/lib/saldoVivo.ts.';

revoke all on function public.extracto_vigente() from public, anon;
grant execute on function public.extracto_vigente() to authenticated, service_role;
