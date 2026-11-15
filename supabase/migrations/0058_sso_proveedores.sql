-- ============================================================================
-- 0058_sso_proveedores.sql — SSO corporativo (SAML) por empresa
-- ============================================================================
--
-- Cada fila une un proveedor SAML registrado en Supabase Auth (GoTrue,
-- `auth.sso_providers`) con la empresa que lo usa, su dominio de correo y el
-- rol con que entra quien llega por primera vez.
--
-- El registro del proveedor en GoTrue lo hace el servidor (API admin, con
-- service_role) desde /usuarios; esta tabla es el puente que GoTrue no tiene:
-- GoTrue sabe que `win.pe` usa tal proveedor, no a qué empresa de esta app
-- pertenece ni con qué rol.
--
-- ⚠️ El alta automática exige que la sesión venga de ESE proveedor
-- (`app_metadata.provider = 'sso:<provider_id>'`), no solo el dominio del
-- correo: ver `altaPorSso` en src/lib/sso.ts.
--
-- Sin políticas de escritura: la escriben solo el servidor. Los miembros de la
-- empresa pueden leer la suya (la pantalla de usuarios la muestra).
--
-- Re-ejecutable.
-- ============================================================================

create table if not exists public.sso_proveedores (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  provider_id      text not null unique,
  dominio          text not null unique,
  rol_por_defecto  text not null default 'consulta'
    check (rol_por_defecto in ('administrador', 'aprobador', 'conciliador', 'consulta')),
  creado_por       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_sso_proveedores_empresa
  on public.sso_proveedores (empresa_id);

alter table public.sso_proveedores enable row level security;

drop policy if exists sso_proveedores_select on public.sso_proveedores;
create policy sso_proveedores_select on public.sso_proveedores
  for select to authenticated
  using (public.es_miembro(empresa_id));

comment on table public.sso_proveedores is
  'Proveedor SAML de cada empresa: dominio de correo y rol con que entra quien '
  'llega por primera vez. Lo escribe solo el servidor desde /usuarios.';
