-- ============================================================================
-- 0009_modulos.sql — Fase D: módulos que se activan previo pago
--
-- El producto base (conciliación) sigue rigiéndose por `empresas.plan` y
-- `prueba_hasta`: tiene semántica de PRUEBA —30 días desde el alta— que un
-- módulo de pago no tiene. Mezclarlos complicaría los dos.
--
-- Esta tabla es para los añadidos: se compran, se renuevan y caducan por su
-- cuenta, cada uno con su propia fecha.
-- ============================================================================

create table if not exists public.suscripciones_modulo (
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  modulo        text not null,
  -- null = sin vencimiento (cortesía, uso interno, acuerdo especial).
  activo_hasta  timestamptz,
  nota          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (empresa_id, modulo),
  constraint suscripciones_modulo_chk check (modulo in ('cobranzas'))
);

create index if not exists idx_suscripciones_modulo_empresa
  on public.suscripciones_modulo (empresa_id);

-- ---------------------------------------------------------------------------
-- RLS: la empresa VE sus módulos; no puede concedérselos.
--
-- Mismo criterio que `plan` en 0005: si el usuario pudiera escribir aquí, se
-- activaría los módulos solo. Las altas y renovaciones van con service_role,
-- tras confirmar el pago.
-- ---------------------------------------------------------------------------
alter table public.suscripciones_modulo enable row level security;

drop policy if exists suscripciones_modulo_select on public.suscripciones_modulo;
create policy suscripciones_modulo_select on public.suscripciones_modulo
  for select to authenticated
  using (public.es_miembro(empresa_id));

revoke insert, update, delete on public.suscripciones_modulo from authenticated;

-- ---------------------------------------------------------------------------
-- Activar o renovar un módulo (desde el SQL editor, tras recibir el pago):
--
--   insert into public.suscripciones_modulo (empresa_id, modulo, activo_hasta, nota)
--   select id, 'cobranzas', now() + interval '1 month', 'transferencia 29/07'
--     from public.empresas where ruc = '20123456789'
--   on conflict (empresa_id, modulo) do update
--      set activo_hasta = excluded.activo_hasta,
--          nota         = excluded.nota,
--          updated_at   = now();
--
-- Revocar:
--   delete from public.suscripciones_modulo
--    where modulo = 'cobranzas'
--      and empresa_id = (select id from public.empresas where ruc = '20123456789');
-- ---------------------------------------------------------------------------
