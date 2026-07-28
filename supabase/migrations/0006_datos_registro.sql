-- ============================================================================
-- 0006_datos_registro.sql — Datos de empresa y de administrador en el registro
--
-- El alta pedía solo nombre de empresa, RUC opcional, correo y contraseña. Ahora
-- recoge la ficha completa de la empresa y los datos del administrador.
-- ============================================================================

-- Datos de la empresa.
alter table public.empresas
  add column if not exists region     text,
  add column if not exists provincia  text,
  add column if not exists direccion  text,
  add column if not exists telefono   text;

-- Datos del administrador de la cuenta. Viven en la membresía porque el MVP no
-- tiene tabla de usuarios propia; el correo ya vive en auth.users y ES el login.
alter table public.usuarios_empresa
  add column if not exists nombre_completo text,
  add column if not exists telefono        text;

-- ---------------------------------------------------------------------------
-- Los campos nuevos de `empresas` son datos que el usuario administra, así que
-- entran en el GRANT por columna que fijó 0005. `plan` y `prueba_hasta` siguen
-- fuera: solo se tocan con service_role.
-- ---------------------------------------------------------------------------
revoke update on public.empresas from authenticated;
grant  update (nombre, ruc, config_conciliacion, region, provincia, direccion, telefono)
  on public.empresas to authenticated;

-- El administrador puede corregir su propio nombre y teléfono. La política
-- usuarios_empresa solo deja tocar filas propias (usuario_id = auth.uid()),
-- pero no existía UPDATE; se concede acotado a esas dos columnas.
drop policy if exists usuarios_empresa_update on public.usuarios_empresa;
create policy usuarios_empresa_update on public.usuarios_empresa
  for update to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

revoke update on public.usuarios_empresa from authenticated;
grant  update (nombre_completo, telefono) on public.usuarios_empresa to authenticated;
