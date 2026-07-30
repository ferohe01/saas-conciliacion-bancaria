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
-- Limpieza previa: `create policy` no admite `if not exists`, así que se
-- eliminan antes de recrearlas. Esto hace el script RE-EJECUTABLE sobre una
-- base que ya tiene el esquema aplicado (no borra datos, solo políticas).
-- ---------------------------------------------------------------------------
drop policy if exists empresas_select          on public.empresas;
drop policy if exists empresas_insert          on public.empresas;
drop policy if exists empresas_update          on public.empresas;
drop policy if exists usuarios_empresa_select  on public.usuarios_empresa;
drop policy if exists usuarios_empresa_insert  on public.usuarios_empresa;
drop policy if exists usuarios_empresa_delete  on public.usuarios_empresa;
drop policy if exists cuentas_select           on public.cuentas_bancarias;
drop policy if exists cuentas_insert           on public.cuentas_bancarias;
drop policy if exists cuentas_update           on public.cuentas_bancarias;
drop policy if exists cuentas_delete           on public.cuentas_bancarias;
drop policy if exists jobs_select              on public.jobs_conciliacion;
drop policy if exists comprobantes_select      on public.comprobantes;
drop policy if exists comprobantes_insert      on public.comprobantes;
drop policy if exists comprobantes_update      on public.comprobantes;
drop policy if exists comprobantes_delete      on public.comprobantes;

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

-- `add table` falla si la tabla ya está en la publicación → se comprueba antes.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jobs_conciliacion'
  ) then
    alter publication supabase_realtime add table public.jobs_conciliacion;
  end if;
end $$;

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

-- ============================================================================
-- 0005_plan_empresa.sql — Período de prueba de 30 días por empresa
--
-- Hace real la promesa comercial que hasta ahora solo era texto en la portada.
-- Al vencer, la empresa conserva TODO el acceso de lectura y pierde una sola
-- capacidad: iniciar una conciliación nueva.
-- ============================================================================

alter table public.empresas
  add column if not exists plan          text not null default 'prueba',
  add column if not exists prueba_hasta  timestamptz;

update public.empresas
   set prueba_hasta = created_at + interval '30 days'
 where prueba_hasta is null;

alter table public.empresas drop constraint if exists empresas_plan_check;
alter table public.empresas
  add constraint empresas_plan_check check (plan in ('prueba', 'activo'));

-- CIERRE IMPRESCINDIBLE: `empresas_update` autoriza a un miembro a actualizar
-- SU empresa, y RLS opera por fila, no por columna. Sin esto el usuario podría
-- hacer `update empresas set plan='activo'` con la key anon y concederse acceso
-- ilimitado — el límite sería decorativo.
revoke update on public.empresas from authenticated;
grant  update (nombre, ruc, config_conciliacion) on public.empresas to authenticated;

-- Extender una prueba o convertir a cliente de pago (desde el SQL editor):
--   update public.empresas set plan = 'activo' where id = '...';
--   update public.empresas set prueba_hasta = now() + interval '30 days' where id = '...';
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
-- ============================================================================
-- 0007_prueba_hasta_default.sql — prueba_hasta se rellena sola
--
-- 0005 rellenó `prueba_hasta` para las empresas existentes, pero no le dio
-- DEFAULT: toda empresa creada después nacía con la columna en null.
--
-- No se notaba porque `estadoSuscripcion` cae de vuelta a created_at + 30 días
-- (lib/suscripcion.ts). Pero la columna existe para poder extender una prueba a
-- mano, y en null cualquier consulta directa da una idea equivocada de hasta
-- cuándo llega un cliente.
-- ============================================================================

alter table public.empresas
  alter column prueba_hasta set default (now() + interval '30 days');

-- Las que ya nacieron sin fecha.
update public.empresas
   set prueba_hasta = created_at + interval '30 days'
 where prueba_hasta is null;
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
-- ============================================================================
-- 0010_fecha_vencimiento.sql — la fecha que el aging necesita
--
-- `comprobantes` solo tenía `fecha` (emisión). El aging —lo único que le
-- importa al dueño— se cuenta desde el VENCIMIENTO: una factura emitida hace
-- 60 días a 90 días de crédito no está vencida, y con solo la emisión lo
-- parecería.
--
-- Es nullable a propósito: muchos comprobantes son al contado y no tienen
-- vencimiento. Cuando falta, el aging usa `fecha` como referencia.
-- ============================================================================

alter table public.comprobantes
  add column if not exists fecha_vencimiento date;

create index if not exists idx_comprobantes_vencimiento
  on public.comprobantes (empresa_id, fecha_vencimiento)
  where fecha_vencimiento is not null;

-- El usuario administra este campo como el resto de la ficha del comprobante.
revoke update on public.comprobantes from authenticated;
grant  update (fecha, fecha_vencimiento, monto, tipo, serie_numero,
               ruc_contraparte, razon_social_contraparte, descripcion, anulado)
  on public.comprobantes to authenticated;
-- ============================================================================
-- 0011_saldo_inicial.sql — un comprobante nuevo nace con saldo = su importe
--
-- 0008 rellenó `saldo` para los comprobantes que ya existían, pero no dejó
-- forma de rellenarlo en los nuevos: el importador no lo escribe y la columna
-- no tenía DEFAULT. Resultado: todo comprobante cargado despues nacía con
-- `saldo` en NULL.
--
-- No se notaba a simple vista —la columna generada `estado` lo trata como
-- 'pendiente'— pero el aging filtra por `saldo > 0.005`, y NULL no pasa esa
-- comparación: las facturas pendientes DESAPARECÍAN de cuentas por cobrar.
--
-- Va como TRIGGER y no como DEFAULT porque un DEFAULT no puede referirse a
-- otra columna de la misma fila. Y va en la base y no en el código para que
-- cubra todos los caminos de entrada: la plantilla Excel, el XML que viene, y
-- cualquier carga manual.
-- ============================================================================

create or replace function public.saldo_inicial_comprobante()
returns trigger
language plpgsql
as $$
begin
  -- Solo al crear, y solo si no se indicó saldo explícitamente.
  if new.saldo is null then
    new.saldo := abs(coalesce(new.monto, 0));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_saldo_inicial on public.comprobantes;
create trigger trg_saldo_inicial
  before insert on public.comprobantes
  for each row execute function public.saldo_inicial_comprobante();

-- Los que ya nacieron sin saldo.
update public.comprobantes
   set saldo = abs(monto)
 where saldo is null and monto is not null;
