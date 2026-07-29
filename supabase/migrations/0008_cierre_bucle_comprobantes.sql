-- ============================================================================
-- 0008_cierre_bucle_comprobantes.sql — Fase A: cerrar el bucle
--
-- Hasta ahora `comprobantes` era SOLO materia prima de entrada: se conciliaba
-- y nada volvía. La factura F001-234 casaba con un depósito, la persona lo
-- confirmaba, y el comprobante no se enteraba.
--
-- Esto lo convierte en un libro de cuentas por cobrar vivo, que es lo que
-- habilita aging, cobranzas y flujo de caja sin datos nuevos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Saldo y estado del comprobante
-- ---------------------------------------------------------------------------
alter table public.comprobantes
  add column if not exists saldo    numeric(14, 2),
  add column if not exists anulado  boolean not null default false;

-- Los que ya existían nacen con el saldo completo.
update public.comprobantes set saldo = abs(monto) where saldo is null and monto is not null;

-- `estado` es DERIVADO, no almacenado a mano: así no puede contradecir al
-- saldo. Un estado que se actualiza por separado siempre acaba mintiendo.
alter table public.comprobantes drop column if exists estado;
alter table public.comprobantes
  add column estado text generated always as (
    case
      when anulado                              then 'anulado'
      when monto is null or saldo is null       then 'pendiente'
      when saldo <= 0.005                       then 'cobrado'
      when saldo < abs(monto) - 0.005           then 'parcial'
      else                                           'pendiente'
    end
  ) stored;

create index if not exists idx_comprobantes_estado
  on public.comprobantes (empresa_id, estado, fecha);

-- ---------------------------------------------------------------------------
-- 2. Aplicaciones: qué movimiento bancario pagó qué comprobante
--
-- Tabla aparte y no una columna, porque la relación es N:N de verdad:
--   · un comprobante puede cobrarse en varios depósitos (pago parcial)
--   · un depósito puede cubrir varios comprobantes (la agrupación 1:N que el
--     motor ya detecta)
-- ---------------------------------------------------------------------------
create table if not exists public.aplicaciones_cobro (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id) on delete cascade,
  comprobante_id uuid not null references public.comprobantes (id) on delete cascade,
  job_id         text not null references public.jobs_conciliacion (id) on delete cascade,
  id_movimiento  text not null,
  monto_aplicado numeric(14, 2) not null,
  usuario_id     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  -- Idempotencia: reconfirmar una decisión no vuelve a descontar saldo.
  constraint aplicaciones_unica unique (comprobante_id, job_id, id_movimiento)
);

create index if not exists idx_aplicaciones_comprobante
  on public.aplicaciones_cobro (comprobante_id);
create index if not exists idx_aplicaciones_job
  on public.aplicaciones_cobro (job_id);

-- ---------------------------------------------------------------------------
-- 3. El saldo lo mantiene un trigger, no la aplicación
--
-- Da igual quién escriba la aplicación —la app, un reproceso, una corrección a
-- mano—: el saldo siempre es monto menos lo aplicado. Si el cálculo viviera en
-- el código, cualquier camino que lo saltara dejaría el saldo mintiendo.
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_saldo_comprobante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comprobante uuid := coalesce(new.comprobante_id, old.comprobante_id);
begin
  update public.comprobantes c
     set saldo = greatest(
           abs(c.monto) - coalesce((
             select sum(a.monto_aplicado)
               from public.aplicaciones_cobro a
              where a.comprobante_id = v_comprobante
           ), 0), 0)
   where c.id = v_comprobante;
  return null;
end;
$$;

drop trigger if exists trg_saldo_comprobante on public.aplicaciones_cobro;
create trigger trg_saldo_comprobante
  after insert or update or delete on public.aplicaciones_cobro
  for each row execute function public.recalcular_saldo_comprobante();

-- ---------------------------------------------------------------------------
-- 4. RLS: mismo criterio que el resto — solo la empresa del usuario
-- ---------------------------------------------------------------------------
alter table public.aplicaciones_cobro enable row level security;

drop policy if exists aplicaciones_select on public.aplicaciones_cobro;
create policy aplicaciones_select on public.aplicaciones_cobro
  for select to authenticated
  using (public.es_miembro(empresa_id));

-- INSERT/DELETE los hace el backend con service_role (salta RLS), igual que la
-- creación de jobs. El usuario solo lee.

-- Sobre comprobantes: el usuario puede anular uno, pero NO tocar el saldo a
-- mano — eso lo decide el trigger a partir de las aplicaciones.
revoke update on public.comprobantes from authenticated;
grant  update (fecha, monto, tipo, serie_numero, ruc_contraparte,
               razon_social_contraparte, descripcion, anulado)
  on public.comprobantes to authenticated;
