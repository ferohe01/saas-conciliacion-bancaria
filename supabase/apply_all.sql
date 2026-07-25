-- ============================================================
-- apply_all.sql — Esquema + RLS + Realtime + config empresa
-- ============================================================

-- ============================================================================
-- 0001_schema.sql — Esquema base del SaaS de conciliación bancaria (MVP)
-- Convenciones: snake_case, uuid por defecto gen_random_uuid(), timestamptz.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- empresas
-- ---------------------------------------------------------------------------
create table if not exists public.empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  ruc         text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- usuarios_empresa — membresía usuario ↔ empresa (multi-tenant)
-- ---------------------------------------------------------------------------
create table if not exists public.usuarios_empresa (
  usuario_id  uuid not null references auth.users (id) on delete cascade,
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  rol         text not null default 'admin',
  created_at  timestamptz not null default now(),
  primary key (usuario_id, empresa_id)
);

create index if not exists idx_usuarios_empresa_empresa
  on public.usuarios_empresa (empresa_id);

-- ---------------------------------------------------------------------------
-- cuentas_bancarias
-- ---------------------------------------------------------------------------
create table if not exists public.cuentas_bancarias (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas (id) on delete cascade,
  banco              text not null,            -- BCP, BBVA, Interbank, Scotiabank, ...
  numero_enmascarado text,                     -- ej. "****4521"
  moneda             text not null default 'PEN',
  mapeo_columnas     jsonb,                    -- memoria de formatos { extracto: {...}, internos: {...} }
  created_at         timestamptz not null default now()
);

create index if not exists idx_cuentas_empresa
  on public.cuentas_bancarias (empresa_id);

-- ---------------------------------------------------------------------------
-- jobs_conciliacion — un job por corrida de conciliación
-- ---------------------------------------------------------------------------
create table if not exists public.jobs_conciliacion (
  id              text primary key,            -- job_id del backend, ej. "rec-2026-07-a8f3"
  empresa_id      uuid not null references public.empresas (id) on delete cascade,
  cuenta_id       uuid not null references public.cuentas_bancarias (id),
  usuario_id      uuid not null references auth.users (id),
  periodo_desde   date not null,
  periodo_hasta   date not null,
  estado          text not null default 'pendiente',  -- pendiente | procesando | completado | error
  fase_actual     text,                        -- ej. "exacta", "difusa", "ia"
  payload_entrada jsonb,                        -- snapshot de lo enviado a n8n
  resultado       jsonb,                        -- resultado de n8n + decisiones humanas
  error_detalle   text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  constraint jobs_estado_chk
    check (estado in ('pendiente', 'procesando', 'completado', 'error')),
  constraint jobs_periodo_chk
    check (periodo_desde <= periodo_hasta)
);

create index if not exists idx_jobs_empresa_created
  on public.jobs_conciliacion (empresa_id, created_at desc);

-- ---------------------------------------------------------------------------
-- comprobantes — registros internos (cobranzas/pagos)
-- ---------------------------------------------------------------------------
create table if not exists public.comprobantes (
  id                       uuid primary key default gen_random_uuid(),
  empresa_id               uuid not null references public.empresas (id) on delete cascade,
  fecha                    date,
  monto                    numeric(14, 2),
  tipo                     text,               -- 'cobranza' | 'pago'
  serie_numero             text,               -- ej. "F001-234"
  ruc_contraparte          text,
  razon_social_contraparte text,
  descripcion              text,
  origen                   text not null default 'plantilla',  -- 'plantilla' | 'xml' | 'ocr'
  confianza                numeric(3, 2),      -- para extracciones futuras con IA
  created_at               timestamptz not null default now(),
  constraint comprobantes_tipo_chk
    check (tipo is null or tipo in ('cobranza', 'pago')),
  constraint comprobantes_origen_chk
    check (origen in ('plantilla', 'xml', 'ocr'))
);

create index if not exists idx_comprobantes_empresa_fecha
  on public.comprobantes (empresa_id, fecha);

-- ============================================================================
-- 0002_rls.sql — Row Level Security (obligatorio desde el día uno)
--
-- Regla base: un usuario autenticado solo accede a filas cuya empresa_id esté
-- entre sus membresías de usuarios_empresa. La key `anon` JAMÁS permite acceso
-- cruzado entre empresas. `service_role` (backend/n8n) salta RLS y solo se usa
-- desde el servidor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: ¿el usuario actual es miembro de la empresa?
-- SECURITY DEFINER para saltar RLS al consultar usuarios_empresa y evitar
-- recursión con las políticas de esa misma tabla.
-- ---------------------------------------------------------------------------
create or replace function public.es_miembro(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios_empresa ue
    where ue.empresa_id = p_empresa_id
      and ue.usuario_id = auth.uid()
  );
$$;

revoke all on function public.es_miembro(uuid) from public;
grant execute on function public.es_miembro(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Habilitar RLS en TODAS las tablas
-- ---------------------------------------------------------------------------
alter table public.empresas           enable row level security;
alter table public.usuarios_empresa   enable row level security;
alter table public.cuentas_bancarias  enable row level security;
alter table public.jobs_conciliacion  enable row level security;
alter table public.comprobantes       enable row level security;

-- ---------------------------------------------------------------------------
-- empresas
--   SELECT/UPDATE: solo miembros.
--   INSERT: cualquier autenticado puede crear una empresa (flujo de registro);
--           acto seguido debe insertar su propia membresía.
-- ---------------------------------------------------------------------------
create policy empresas_select on public.empresas
  for select to authenticated
  using (public.es_miembro(id));

create policy empresas_insert on public.empresas
  for insert to authenticated
  with check (true);

create policy empresas_update on public.empresas
  for update to authenticated
  using (public.es_miembro(id))
  with check (public.es_miembro(id));

-- ---------------------------------------------------------------------------
-- usuarios_empresa
--   El usuario solo ve/gestiona SUS propias membresías (sin función helper,
--   para evitar recursión con es_miembro()).
-- ---------------------------------------------------------------------------
create policy usuarios_empresa_select on public.usuarios_empresa
  for select to authenticated
  using (usuario_id = auth.uid());

create policy usuarios_empresa_insert on public.usuarios_empresa
  for insert to authenticated
  with check (usuario_id = auth.uid());

create policy usuarios_empresa_delete on public.usuarios_empresa
  for delete to authenticated
  using (usuario_id = auth.uid());

-- ---------------------------------------------------------------------------
-- cuentas_bancarias — CRUD restringido a miembros de la empresa
-- ---------------------------------------------------------------------------
create policy cuentas_select on public.cuentas_bancarias
  for select to authenticated
  using (public.es_miembro(empresa_id));

create policy cuentas_insert on public.cuentas_bancarias
  for insert to authenticated
  with check (public.es_miembro(empresa_id));

create policy cuentas_update on public.cuentas_bancarias
  for update to authenticated
  using (public.es_miembro(empresa_id))
  with check (public.es_miembro(empresa_id));

create policy cuentas_delete on public.cuentas_bancarias
  for delete to authenticated
  using (public.es_miembro(empresa_id));

-- ---------------------------------------------------------------------------
-- jobs_conciliacion
--   Lectura para miembros (progreso/historial). La creación y actualización de
--   jobs las hace el backend con service_role (salta RLS), por lo que aquí solo
--   se concede SELECT a los usuarios.
-- ---------------------------------------------------------------------------
create policy jobs_select on public.jobs_conciliacion
  for select to authenticated
  using (public.es_miembro(empresa_id));

-- ---------------------------------------------------------------------------
-- comprobantes — CRUD restringido a miembros de la empresa
-- ---------------------------------------------------------------------------
create policy comprobantes_select on public.comprobantes
  for select to authenticated
  using (public.es_miembro(empresa_id));

create policy comprobantes_insert on public.comprobantes
  for insert to authenticated
  with check (public.es_miembro(empresa_id));

create policy comprobantes_update on public.comprobantes
  for update to authenticated
  using (public.es_miembro(empresa_id))
  with check (public.es_miembro(empresa_id));

create policy comprobantes_delete on public.comprobantes
  for delete to authenticated
  using (public.es_miembro(empresa_id));

-- ============================================================================
-- 0003_realtime.sql — Habilita Supabase Realtime en jobs_conciliacion
--
-- La pantalla de progreso se suscribe a la fila del job para ver el avance por
-- fases en vivo. RLS sigue aplicando a Realtime: cada usuario solo recibe los
-- cambios de los jobs de su empresa.
-- ============================================================================

alter publication supabase_realtime add table public.jobs_conciliacion;

-- REPLICA IDENTITY FULL para que los payloads de UPDATE incluyan todas las
-- columnas (necesario para leer `resultado`/`fase_actual` en el cliente).
alter table public.jobs_conciliacion replica identity full;

-- ============================================================================
-- 0004_config_empresa.sql — Configuración de tolerancias por empresa
--
-- Guarda la config de conciliación (tolerancias, umbral, banda IA) editable
-- desde la pantalla de configuración. Si es null, se usan los defaults del
-- contrato. RLS: la política empresas_update ya permite a los miembros editar.
-- ============================================================================

alter table public.empresas
  add column if not exists config_conciliacion jsonb;
