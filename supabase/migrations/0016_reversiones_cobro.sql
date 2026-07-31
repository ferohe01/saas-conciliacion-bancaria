-- ============================================================================
-- 0016_reversiones_cobro.sql — Anular un cobro suelto sin tumbar la conciliación
--
-- Cuando el banco revierte un depósito (cheque devuelto, transferencia
-- revertida, contracargo), hasta ahora el único camino era anular la
-- conciliación entera. Desproporcionado: en la corrida de julio eso tiraría
-- también los otros 35 cobros, que eran correctos.
--
-- POR QUÉ UNA TABLA APARTE Y NO UN CAMPO EN `aplicaciones_cobro`:
--
--   `sincronizarCobranzas` BORRA y REHACE todas las aplicaciones del job cada
--   vez que cambia una decisión. Una marca dentro de esa tabla se perdería en
--   la siguiente resincronización y el cobro revertido volvería solo. La
--   reversión vive en su propia tabla, con la misma clave que la aplicación
--   (`comprobante_id + job_id + id_movimiento`, la de `aplicaciones_unica`),
--   así que sobrevive a ese churn.
--
-- POR QUÉ NO SE BORRA LA APLICACIÓN:
--
--   Se conservan las dos caras: la conciliación dice que ese depósito pagó esta
--   factura, y la reversión dice que el banco lo deshizo después. Borrar la
--   primera reescribiría la historia y dejaría un agujero inexplicable en la
--   conciliación aprobada. El saldo pasa a ser:
--
--       saldo = importe − (aplicado − revertido)
--
-- POR QUÉ NO SE RECHAZA EL MATCH:
--
--   Un movimiento bancario puede cubrir VARIAS facturas (agrupación 1:N; en
--   producción hay dos depósitos que cubren tres facturas cada uno). Rechazar
--   el match revertiría las tres cuando el banco solo deshizo una.
-- ============================================================================

create table if not exists public.reversiones_cobro (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id) on delete cascade,
  comprobante_id uuid not null references public.comprobantes (id) on delete cascade,
  job_id         text not null references public.jobs_conciliacion (id) on delete cascade,
  id_movimiento  text not null,
  -- Cuánto se revierte. Normalmente todo lo aplicado, pero se guarda el importe
  -- para poder soportar una reversión parcial sin cambiar el modelo.
  monto_revertido numeric(14, 2) not null check (monto_revertido > 0),
  motivo         text,
  usuario_id     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  -- Misma clave que `aplicaciones_unica`: una aplicación se revierte una vez.
  constraint reversiones_unica unique (comprobante_id, job_id, id_movimiento)
);

comment on table public.reversiones_cobro is
  'Cobros deshechos por el banco despues de conciliar. No borra la aplicacion: '
  'conserva las dos caras para poder explicar por que el saldo volvio.';

create index if not exists reversiones_comprobante_idx
  on public.reversiones_cobro (comprobante_id);

-- ---------------------------------------------------------------------------
-- RLS: mismo criterio que `aplicaciones_cobro`. El usuario lee lo de su
-- empresa; escribir es cosa del backend con `service_role`, que es quien
-- comprueba que la reversión tenga sentido.
-- ---------------------------------------------------------------------------
alter table public.reversiones_cobro enable row level security;

drop policy if exists reversiones_select on public.reversiones_cobro;
create policy reversiones_select on public.reversiones_cobro
  for select to authenticated
  using (public.es_miembro(empresa_id));

-- ---------------------------------------------------------------------------
-- El saldo descuenta lo aplicado MENOS lo revertido.
--
-- Se recalcula desde cero cada vez, igual que antes: la fuente de verdad son
-- las dos tablas, no un acumulador. Sigue sin `greatest(..., 0)` (ver 0015):
-- si algo aplica de más, la constraint lo aborta en vez de disimularlo.
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
     set saldo = abs(c.monto)
               - coalesce((
                   select sum(a.monto_aplicado)
                     from public.aplicaciones_cobro a
                    where a.comprobante_id = v_comprobante
                 ), 0)
               + coalesce((
                   select sum(r.monto_revertido)
                     from public.reversiones_cobro r
                    where r.comprobante_id = v_comprobante
                 ), 0)
   where c.id = v_comprobante;
  return null;
end;
$$;

-- Revertir (o deshacer la reversión) también tiene que mover el saldo.
drop trigger if exists trg_saldo_reversion on public.reversiones_cobro;
create trigger trg_saldo_reversion
after insert or update or delete on public.reversiones_cobro
for each row execute function public.recalcular_saldo_comprobante();

-- ---------------------------------------------------------------------------
-- Una reversión no puede devolver más de lo que se aplicó por esa misma vía.
-- Se comprueba con un trigger porque mira otra tabla, cosa que un CHECK no
-- puede hacer.
-- ---------------------------------------------------------------------------
create or replace function public.validar_reversion_cobro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aplicado numeric(14, 2);
begin
  select monto_aplicado into v_aplicado
    from public.aplicaciones_cobro
   where comprobante_id = new.comprobante_id
     and job_id = new.job_id
     and id_movimiento = new.id_movimiento;

  if v_aplicado is null then
    raise exception 'No existe un cobro aplicado que revertir para ese comprobante y movimiento'
      using errcode = 'no_data_found';
  end if;

  if new.monto_revertido > v_aplicado then
    raise exception 'No se puede revertir % si solo se aplicaron %',
      new.monto_revertido, v_aplicado
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_reversion on public.reversiones_cobro;
create trigger trg_validar_reversion
before insert or update on public.reversiones_cobro
for each row execute function public.validar_reversion_cobro();
