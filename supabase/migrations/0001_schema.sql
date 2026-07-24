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
