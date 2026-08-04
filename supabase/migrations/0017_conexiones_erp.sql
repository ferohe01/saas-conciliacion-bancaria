-- ============================================================================
-- 0017_conexiones_erp.sql — "Conectar sistema": la ficha de la conexión
--
-- El wizard ofrece conectar el sistema de facturación de la empresa como origen
-- de los registros internos. El motor de esa sincronización TODAVÍA NO EXISTE:
-- esta tabla guarda únicamente lo que el cliente declara sobre su sistema, para
-- poder prepararla y avisarle cuando esté lista.
--
-- ⚠️ AQUÍ NO SE GUARDAN CREDENCIALES. Ni API key, ni contraseña, ni token.
--
--   Sin motor que las use, un secreto guardado no aporta nada y sí crea un
--   pasivo: quedaría en claro en Postgres, en los backups (`pg_dumpall` diario,
--   ver ops/) y en los snapshots del VPS, con acceso de lectura para cualquier
--   miembro de la empresa vía RLS. Se piden solo datos no secretos —qué sistema
--   usa, dónde vive, con quién coordinar—. La credencial se pedirá al activar,
--   por un canal aparte y con cifrado, cuando haya algo que la consuma.
--
-- POR QUÉ UNA FILA POR EMPRESA (empresa_id es la PK):
--
--   Una PyME factura en un sistema, no en tres. Con la empresa como clave, la
--   pantalla es un formulario que se guarda —no una lista con altas y bajas— y
--   el "guardar" es un upsert trivial. Si algún día hacen falta varias, la
--   migración es añadir un id propio; al revés (deduplicar filas repetidas ya
--   creadas por los usuarios) no habría sido gratis.
-- ============================================================================

create table if not exists public.conexiones_erp (
  empresa_id      uuid primary key references public.empresas (id) on delete cascade,

  -- Id del catálogo de `src/lib/conexiones.ts` ('nubefact', 'defontana', …) o
  -- 'otro'. Deliberadamente SIN check de valores: el catálogo comercial cambia
  -- más rápido que el esquema, y una constraint desactualizada rechazaría el
  -- alta de un cliente real. La forma se valida con zod en el servidor.
  sistema         text not null,
  -- Nombre escrito a mano cuando `sistema = 'otro'`.
  nombre_sistema  text,

  url_base        text,
  -- Usuario, RUC o código de cliente en ese sistema. NO es un secreto.
  identificador   text,
  frecuencia      text not null default 'diaria',
  -- Con quién coordinar la integración (suele ser el proveedor del ERP, no el
  -- usuario que rellena el formulario).
  contacto        text,
  notas           text,

  -- 'registrada'      → el cliente dejó sus datos; nada corre todavía.
  -- 'en_preparacion'  → lo estamos montando.
  -- 'activa'          → sincroniza (no alcanzable hasta que exista el motor).
  -- 'pausada'         → activa alguna vez, hoy detenida.
  estado          text not null default 'registrada',

  solicitado_por  uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint conexiones_erp_estado_chk
    check (estado in ('registrada', 'en_preparacion', 'activa', 'pausada')),
  constraint conexiones_erp_frecuencia_chk
    check (frecuencia in ('manual', 'diaria', 'semanal')),
  -- 'otro' sin nombre deja una ficha inservible: no sabríamos qué preparar.
  constraint conexiones_erp_nombre_chk
    check (sistema <> 'otro' or coalesce(btrim(nombre_sistema), '') <> '')
);

comment on table public.conexiones_erp is
  'Ficha del sistema de facturacion del cliente para la futura sincronizacion. '
  'NO guarda credenciales: la sincronizacion aun no existe.';

-- ---------------------------------------------------------------------------
-- RLS: la empresa administra su propia ficha.
-- ---------------------------------------------------------------------------
alter table public.conexiones_erp enable row level security;

drop policy if exists conexiones_erp_select on public.conexiones_erp;
create policy conexiones_erp_select on public.conexiones_erp
  for select to authenticated
  using (public.es_miembro(empresa_id));

drop policy if exists conexiones_erp_insert on public.conexiones_erp;
create policy conexiones_erp_insert on public.conexiones_erp
  for insert to authenticated
  with check (public.es_miembro(empresa_id));

drop policy if exists conexiones_erp_update on public.conexiones_erp;
create policy conexiones_erp_update on public.conexiones_erp
  for update to authenticated
  using (public.es_miembro(empresa_id))
  with check (public.es_miembro(empresa_id));

drop policy if exists conexiones_erp_delete on public.conexiones_erp;
create policy conexiones_erp_delete on public.conexiones_erp
  for delete to authenticated
  using (public.es_miembro(empresa_id));

-- ---------------------------------------------------------------------------
-- MISMO CIERRE QUE 0005 Y 0009: `estado` no lo escribe el usuario.
--
-- RLS autoriza por fila, no por columna: sin esto, un `update conexiones_erp
-- set estado='activa'` con la key `anon` haría que la interfaz anunciara una
-- sincronización que no existe. Se revoca el UPDATE amplio y se reconcede solo
-- sobre lo que el cliente sí declara. El INSERT también se acota por columnas,
-- para que el alta no entre ya con `estado='activa'`.
--
-- `empresa_id` se concede en el INSERT (hay que poder fijarlo; la política
-- `with check` obliga a que sea la propia) y NO en el UPDATE (mover la ficha a
-- otra empresa no es una operación que exista).
-- ---------------------------------------------------------------------------
revoke insert, update on public.conexiones_erp from authenticated;
grant insert (empresa_id, sistema, nombre_sistema, url_base, identificador,
              frecuencia, contacto, notas, solicitado_por)
  on public.conexiones_erp to authenticated;
grant update (sistema, nombre_sistema, url_base, identificador,
              frecuencia, contacto, notas, updated_at)
  on public.conexiones_erp to authenticated;

-- Avanzar una conexión (desde el SQL editor, cuando exista el motor):
--   update public.conexiones_erp set estado = 'en_preparacion'
--    where empresa_id = (select id from public.empresas where ruc = '20123456789');
