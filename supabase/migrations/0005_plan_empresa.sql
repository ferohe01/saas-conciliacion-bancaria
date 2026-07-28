-- ============================================================================
-- 0005_plan_empresa.sql — Período de prueba de 30 días por empresa
--
-- La promesa comercial ("tu primer período es gratis") vivía solo como texto en
-- la portada y en el registro. Esto la hace real: cada empresa nace en plan
-- 'prueba' con fecha de fin, y al vencer NO puede iniciar conciliaciones nuevas
-- (sí puede entrar y ver todo lo anterior).
-- ============================================================================

alter table public.empresas
  add column if not exists plan          text not null default 'prueba',
  add column if not exists prueba_hasta  timestamptz;

-- Empresas ya existentes: 30 días desde su alta.
update public.empresas
   set prueba_hasta = created_at + interval '30 days'
 where prueba_hasta is null;

alter table public.empresas drop constraint if exists empresas_plan_check;
alter table public.empresas
  add constraint empresas_plan_check check (plan in ('prueba', 'activo'));

-- ---------------------------------------------------------------------------
-- CIERRE IMPRESCINDIBLE: la política `empresas_update` autoriza a un miembro a
-- actualizar SU empresa, y RLS opera por fila, no por columna. Sin esto, el
-- usuario podría hacer `update empresas set plan='activo'` con la key `anon` y
-- concederse acceso ilimitado — el límite sería decorativo.
--
-- Se revoca el UPDATE amplio y se concede solo sobre las columnas que el
-- usuario sí administra (la pantalla de configuración escribe
-- config_conciliacion con el cliente anon; ver configuracion/actions.ts).
-- `plan` y `prueba_hasta` quedan fuera: solo se cambian con service_role.
-- ---------------------------------------------------------------------------
revoke update on public.empresas from authenticated;
grant  update (nombre, ruc, config_conciliacion) on public.empresas to authenticated;

-- Para extender una prueba o convertir a cliente de pago (desde el SQL editor,
-- que corre como superusuario):
--   update public.empresas set plan = 'activo' where id = '...';
--   update public.empresas set prueba_hasta = now() + interval '30 days' where id = '...';
