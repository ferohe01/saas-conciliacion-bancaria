-- ============================================================================
-- 0057_roles_usuarios.sql — Cuatro roles por empresa, y un hueco cerrado
-- ============================================================================
--
-- `usuarios_empresa.rol` existía desde la 0001 con el valor 'admin' para todos
-- y no lo leía nadie. Pasa a ser el control de acceso:
--
--   administrador — todo, incluida la gestión de usuarios y la configuración
--   aprobador     — carga, concilia, decide y aprueba/anula
--   conciliador   — carga, concilia y decide; no aprueba
--   consulta      — solo lectura
--
-- La matriz vive en `src/lib/roles.ts` (pura, con tests) y se hace cumplir en
-- el servidor, en cada acción que escribe.
--
-- ⚠️⚠️ HUECO DE SEGURIDAD CERRADO. La política `usuarios_empresa_insert`
-- exigía solo `usuario_id = auth.uid()` y no miraba la empresa: cualquier
-- usuario registrado podía insertarse a sí mismo en CUALQUIER empresa —con la
-- key pública, desde el navegador— y desde ahí `es_miembro()` le abría todos
-- sus datos. Con roles, además, se habría autoasignado `administrador`. Nadie
-- la necesita: el registro y la gestión de usuarios escriben con
-- `service_role`. Se retira, y con ella la de DELETE: un administrador que se
-- borrara a sí mismo podía dejar la empresa sin nadie que la gestione; ahora
-- salir de una empresa pasa por /usuarios, que lo impide.
--
-- Re-ejecutable.
-- ============================================================================

update public.usuarios_empresa
   set rol = 'administrador'
 where rol = 'admin' or rol is null;

-- Cualquier otro valor desconocido degrada a solo lectura, nunca al revés
-- (mismo criterio que `rolDe` en la aplicación).
update public.usuarios_empresa
   set rol = 'consulta'
 where rol not in ('administrador', 'aprobador', 'conciliador', 'consulta');

alter table public.usuarios_empresa alter column rol set default 'consulta';

alter table public.usuarios_empresa drop constraint if exists usuarios_empresa_rol_chk;
alter table public.usuarios_empresa
  add constraint usuarios_empresa_rol_chk
  check (rol in ('administrador', 'aprobador', 'conciliador', 'consulta'));

drop policy if exists usuarios_empresa_insert on public.usuarios_empresa;
drop policy if exists usuarios_empresa_delete on public.usuarios_empresa;

comment on column public.usuarios_empresa.rol is
  'administrador | aprobador | conciliador | consulta. Lo escribe solo el '
  'servidor (service_role) desde /usuarios. Ver src/lib/roles.ts.';
