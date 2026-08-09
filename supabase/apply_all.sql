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

-- ============================================================================
-- 0012_versiones_conciliacion.sql — Ciclo de vida contable y versiones
-- ============================================================================

-- ============================================================================
-- 0012_versiones_conciliacion.sql — Ciclo de vida contable y versiones
--
-- Hasta aquí una conciliación era solo un job técnico: se lanzaba, corría en
-- n8n y quedaba `completado`. Nada distinguía "esta es la buena" de "esta la
-- re-corrí porque los datos venían mal". Con dos corridas del mismo período
-- conviviendo como iguales, los reportes sumaban dos veces el mismo mes y el
-- saldo de los comprobantes podía descontarse dos veces (`aplicaciones_cobro`
-- lleva `job_id` en su clave única, así que dos jobs aplican por separado).
--
-- Esta migración separa DOS EJES que antes estaban confundidos en uno:
--
--   `estado`          — ciclo técnico del procesamiento en n8n
--                       (pendiente | procesando | completado | error)
--   `estado_contable` — ciclo de vida del documento contable
--                       (borrador | en_proceso | observada | aprobada |
--                        anulada | reemplazada)
--
-- Son ortogonales a propósito: un job puede estar técnicamente `completado` y
-- contablemente `borrador`, o estar `aprobada` mientras se reprocesa una
-- corrección. Meterlos en una sola columna haría inexpresables esos estados.
--
-- REGLA CENTRAL, impuesta por la base y no por la aplicación: no puede existir
-- más de una conciliación APROBADA que cubra el mismo rango de fechas de la
-- misma cuenta. Varias conciliaciones por cortes distintos (1-10, 11-20,
-- 21-31) son legítimas y el constraint las permite porque no se solapan.
-- Varias corridas del mismo rango también, pero solo una puede estar aprobada;
-- las demás quedan como `reemplazada` o `anulada`, conservando la trazabilidad.
-- ============================================================================

-- `exclude using gist` con una columna uuid comparada por `=` necesita esto.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.jobs_conciliacion
  add column if not exists estado_contable       text not null default 'borrador',
  add column if not exists version                integer not null default 1,
  add column if not exists conciliacion_origen_id text,
  add column if not exists fecha_aprobacion       timestamptz,
  add column if not exists usuario_aprobador      uuid,
  add column if not exists numero_estado_cuenta   text,
  add column if not exists saldo_inicial_banco    numeric(14, 2),
  add column if not exists saldo_final_banco      numeric(14, 2);

comment on column public.jobs_conciliacion.estado_contable is
  'Ciclo de vida contable. Ortogonal a `estado`, que es el del procesamiento.';
comment on column public.jobs_conciliacion.version is
  'Nº de corrida sobre el mismo cuenta+rango. La primera es 1.';
comment on column public.jobs_conciliacion.conciliacion_origen_id is
  'Job del que esta corrida es reproceso. NULL si es la primera.';
comment on column public.jobs_conciliacion.numero_estado_cuenta is
  'Identificador del estado de cuenta del banco, para no importarlo dos veces.';
comment on column public.jobs_conciliacion.saldo_inicial_banco is
  'Saldo inicial del extracto. Se promueve a columna para poder validar que '
  'encadene con el saldo final del corte anterior, cosa que dentro del JSONB '
  'del resultado no se puede consultar.';

-- Claves foráneas aparte: `add column ... references` no admite IF NOT EXISTS,
-- así que se añaden de forma re-ejecutable.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_origen_fk'
  ) then
    alter table public.jobs_conciliacion
      add constraint jobs_origen_fk
      foreign key (conciliacion_origen_id)
      references public.jobs_conciliacion (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'jobs_aprobador_fk'
  ) then
    alter table public.jobs_conciliacion
      add constraint jobs_aprobador_fk
      foreign key (usuario_aprobador)
      references auth.users (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Backfill de lo que ya existe
--
-- Los jobs previos no tienen estado contable. Se les asigna el que refleja
-- cómo los venía tratando el sistema: los reportes ya se quedaban con la
-- corrida más reciente de cada período, así que esa pasa a `aprobada` y las
-- anteriores a `reemplazada`.
--
-- `usuario_aprobador` queda en NULL a propósito: nadie aprobó estas
-- conciliaciones a mano. Un NULL ahí significa "aprobación implícita heredada
-- de la migración", y se distingue de una aprobación humana real.
-- ---------------------------------------------------------------------------
-- El backfill es de una sola vez. `apply_all.sql` es re-ejecutable, y una
-- segunda pasada no debe aprobar sola las conciliaciones en borrador que hayan
-- nacido después — aprobar es justo el acto humano que la Fase B viene a
-- exigir. El centinela es el propio constraint de exclusión, que se crea más
-- abajo: si ya existe, 0012 ya se aplicó y aquí no hay nada que hacer.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'jobs_una_aprobada_por_rango'
  ) then
    raise notice '0012: backfill omitido, ya se habia aplicado';
    return;
  end if;

  with ordenadas as (
    select
      id,
      row_number() over (
        partition by cuenta_id, periodo_desde, periodo_hasta
        order by created_at
      ) as v_asc,
      row_number() over (
        partition by cuenta_id, periodo_desde, periodo_hasta
        order by created_at desc
      ) as v_desc
    from public.jobs_conciliacion
  )
  update public.jobs_conciliacion j
     set version = o.v_asc,
         estado_contable = case
           when j.estado <> 'completado' then 'borrador'
           when o.v_desc = 1             then 'aprobada'
           else                               'reemplazada'
         end,
         fecha_aprobacion = case
           when j.estado = 'completado' and o.v_desc = 1
             then coalesce(j.completed_at, j.created_at)
           else null
         end
    from ordenadas o
   where o.id = j.id;
end $$;

-- ---------------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------------
alter table public.jobs_conciliacion
  drop constraint if exists jobs_estado_contable_chk;
alter table public.jobs_conciliacion
  add constraint jobs_estado_contable_chk
  check (estado_contable in (
    'borrador', 'en_proceso', 'observada', 'aprobada', 'anulada', 'reemplazada'
  ));

alter table public.jobs_conciliacion
  drop constraint if exists jobs_version_chk;
alter table public.jobs_conciliacion
  add constraint jobs_version_chk check (version >= 1);

-- Una aprobación sin fecha no es una aprobación.
alter table public.jobs_conciliacion
  drop constraint if exists jobs_aprobacion_chk;
alter table public.jobs_conciliacion
  add constraint jobs_aprobacion_chk
  check (estado_contable <> 'aprobada' or fecha_aprobacion is not null);

-- Un reproceso no puede declararse origen de sí mismo.
alter table public.jobs_conciliacion
  drop constraint if exists jobs_origen_no_circular_chk;
alter table public.jobs_conciliacion
  add constraint jobs_origen_no_circular_chk
  check (conciliacion_origen_id is null or conciliacion_origen_id <> id);

-- LA REGLA: como máximo una aprobada por cuenta y rango solapado.
--
-- Si esta línea falla al aplicar la migración, NO es un fallo del script: hay
-- conciliaciones con períodos que se solapan de verdad y alguien tiene que
-- decidir cuál vale. Para encontrarlas:
--
--   select a.id, a.periodo_desde, a.periodo_hasta,
--          b.id, b.periodo_desde, b.periodo_hasta
--     from public.jobs_conciliacion a
--     join public.jobs_conciliacion b
--       on a.cuenta_id = b.cuenta_id
--      and a.id < b.id
--      and a.estado_contable = 'aprobada'
--      and b.estado_contable = 'aprobada'
--      and daterange(a.periodo_desde, a.periodo_hasta, '[]')
--       && daterange(b.periodo_desde, b.periodo_hasta, '[]');
--
-- y dejar en 'reemplazada' las que no deban regir.
alter table public.jobs_conciliacion
  drop constraint if exists jobs_una_aprobada_por_rango;
alter table public.jobs_conciliacion
  add constraint jobs_una_aprobada_por_rango
  exclude using gist (
    cuenta_id with =,
    daterange(periodo_desde, periodo_hasta, '[]') with &&
  ) where (estado_contable = 'aprobada');

-- ---------------------------------------------------------------------------
-- Índices de consulta
-- ---------------------------------------------------------------------------
create index if not exists jobs_estado_contable_idx
  on public.jobs_conciliacion (empresa_id, estado_contable);

create index if not exists jobs_cuenta_periodo_idx
  on public.jobs_conciliacion (cuenta_id, periodo_desde, periodo_hasta);

-- ============================================================================
-- 0013_aprobar_conciliacion.sql — Aprobar y anular como operaciones atómicas
-- ============================================================================

-- ============================================================================
-- 0013_aprobar_conciliacion.sql — Aprobar y anular como operaciones atómicas
--
-- Aprobar una conciliación no es un solo UPDATE: si otra versión del mismo
-- rango ya está aprobada, hay que degradarla a `reemplazada` ANTES, porque el
-- constraint de exclusión de la 0012 no admite dos aprobadas solapadas.
--
-- Hacerlo desde la aplicación con dos escrituras sueltas deja una ventana en la
-- que ninguna rige, y si la segunda falla el período se queda sin conciliación
-- vigente. Aquí va como una sola transacción.
--
-- Las aplicaciones de cobro se borran junto con la degradación: solo la
-- conciliación aprobada mueve el saldo de los comprobantes (ver
-- `src/lib/cicloContable.ts`). El trigger de la 0008 recalcula el saldo solo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- aprobar_conciliacion(job, usuario)
--
-- Devuelve los ids que quedaron `reemplazada`, para poder informarlo en la UI.
-- ---------------------------------------------------------------------------
create or replace function public.aprobar_conciliacion(
  p_job_id text,
  p_usuario uuid
)
returns table (reemplazada_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
begin
  select * into v_job
    from public.jobs_conciliacion
   where id = p_job_id
   for update;

  if not found then
    raise exception 'Conciliación no encontrada' using errcode = 'no_data_found';
  end if;

  if v_job.estado <> 'completado' then
    raise exception 'Solo puede aprobarse una conciliación ya procesada'
      using errcode = 'check_violation';
  end if;

  if v_job.estado_contable in ('anulada', 'reemplazada') then
    raise exception 'Una conciliación anulada o reemplazada no puede aprobarse'
      using errcode = 'check_violation';
  end if;

  -- Degradar las aprobadas que se solapen con este rango en la misma cuenta.
  -- Sin esto, el UPDATE de más abajo chocaría con el constraint de exclusión.
  return query
  with degradadas as (
    update public.jobs_conciliacion j
       set estado_contable = 'reemplazada'
     where j.cuenta_id = v_job.cuenta_id
       and j.id <> v_job.id
       and j.estado_contable = 'aprobada'
       and daterange(j.periodo_desde, j.periodo_hasta, '[]')
        && daterange(v_job.periodo_desde, v_job.periodo_hasta, '[]')
    returning j.id
  ),
  limpieza as (
    -- Una conciliación que deja de regir deja de mover saldo.
    delete from public.aplicaciones_cobro a
     using degradadas d
     where a.job_id = d.id
    returning a.job_id
  )
  select d.id from degradadas d;

  update public.jobs_conciliacion
     set estado_contable   = 'aprobada',
         fecha_aprobacion  = now(),
         usuario_aprobador = p_usuario
   where id = p_job_id;
end;
$$;

comment on function public.aprobar_conciliacion(text, uuid) is
  'Aprueba una conciliación y degrada a `reemplazada` las aprobadas que se '
  'solapen, borrando sus aplicaciones de cobro. Atómico: nunca deja el período '
  'sin conciliación vigente.';

-- ---------------------------------------------------------------------------
-- cambiar_estado_contable(job, estado, usuario)
--
-- Para las transiciones que no son aprobar (observar, anular, reabrir). Se
-- separan porque ninguna necesita tocar a las hermanas, pero todas deben
-- limpiar las aplicaciones si el documento deja de regir.
-- ---------------------------------------------------------------------------
create or replace function public.cambiar_estado_contable(
  p_job_id text,
  p_estado text,
  p_usuario uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual text;
begin
  if p_estado not in ('borrador', 'en_proceso', 'observada', 'anulada') then
    raise exception 'Estado no permitido por esta vía: %', p_estado
      using errcode = 'check_violation';
  end if;

  select estado_contable into v_actual
    from public.jobs_conciliacion
   where id = p_job_id
   for update;

  if not found then
    raise exception 'Conciliación no encontrada' using errcode = 'no_data_found';
  end if;

  if v_actual = 'reemplazada' then
    raise exception 'Una conciliación reemplazada ya no admite cambios'
      using errcode = 'check_violation';
  end if;

  update public.jobs_conciliacion
     set estado_contable = p_estado,
         -- Deja de regir: la aprobación previa ya no vale.
         fecha_aprobacion = null,
         usuario_aprobador = null
   where id = p_job_id;

  -- Al salir de `aprobada` el documento deja de mover saldo.
  delete from public.aplicaciones_cobro where job_id = p_job_id;
end;
$$;

comment on function public.cambiar_estado_contable(text, text, uuid) is
  'Observa, anula o reabre una conciliación. Borra sus aplicaciones de cobro: '
  'solo la aprobada mueve el saldo de los comprobantes.';

-- ---------------------------------------------------------------------------
-- Permisos: estas funciones las invoca el backend con service_role. No se
-- conceden a `authenticated` — igual que el resto de escrituras sobre jobs,
-- que RLS no permite a los usuarios (ver 0002).
-- ---------------------------------------------------------------------------
revoke all on function public.aprobar_conciliacion(text, uuid) from public, anon, authenticated;
revoke all on function public.cambiar_estado_contable(text, text, uuid) from public, anon, authenticated;
grant execute on function public.aprobar_conciliacion(text, uuid) to service_role;
grant execute on function public.cambiar_estado_contable(text, text, uuid) to service_role;

-- ============================================================================
-- 0014_guardas_estados_terminales.sql — Cerrar dos huecos de la 0013
-- ============================================================================

-- ============================================================================
-- 0014_guardas_estados_terminales.sql — Cerrar dos huecos de la 0013
--
-- La 0013 dejó dos transiciones que la capa TypeScript impide pero la base
-- aceptaba. Como la base es la autoridad —cualquier escritura con
-- `service_role` la esquiva, venga de la app, de n8n o de un psql—, la regla
-- tiene que estar aquí.
--
-- 1) REAPROBAR una conciliación ya aprobada.
--    Parecía inocuo por ser idempotente, pero pisa `fecha_aprobacion` y
--    `usuario_aprobador`, que son datos de auditoría: convierte una aprobación
--    heredada de la migración (aprobador NULL) en una aprobación humana que
--    nunca ocurrió. Se detectó justamente así, probando en producción.
--
-- 2) REABRIR una conciliación ANULADA.
--    `cambiar_estado_contable` solo rechazaba `reemplazada`, así que una
--    anulada podía volver a `borrador` y de ahí aprobarse. `cicloContable.ts`
--    la trata como terminal desde el principio; ahora la base también.
--
-- Ambas funciones se redefinen enteras (`create or replace`) en vez de
-- parchearse: una función a medias entre dos migraciones es peor de leer que
-- una definición completa que se sustituye.
-- ============================================================================

create or replace function public.aprobar_conciliacion(
  p_job_id text,
  p_usuario uuid
)
returns table (reemplazada_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
begin
  select * into v_job
    from public.jobs_conciliacion
   where id = p_job_id
   for update;

  if not found then
    raise exception 'Conciliación no encontrada' using errcode = 'no_data_found';
  end if;

  if v_job.estado <> 'completado' then
    raise exception 'Solo puede aprobarse una conciliación ya procesada'
      using errcode = 'check_violation';
  end if;

  if v_job.estado_contable in ('anulada', 'reemplazada') then
    raise exception 'Una conciliación anulada o reemplazada no puede aprobarse'
      using errcode = 'check_violation';
  end if;

  -- Hueco 1: reaprobar pisaría la fecha y el aprobador originales.
  if v_job.estado_contable = 'aprobada' then
    raise exception 'Esta conciliación ya está aprobada'
      using errcode = 'check_violation';
  end if;

  -- Degradar las aprobadas que se solapen con este rango en la misma cuenta.
  -- Sin esto, el UPDATE de más abajo chocaría con el constraint de exclusión.
  return query
  with degradadas as (
    update public.jobs_conciliacion j
       set estado_contable = 'reemplazada'
     where j.cuenta_id = v_job.cuenta_id
       and j.id <> v_job.id
       and j.estado_contable = 'aprobada'
       and daterange(j.periodo_desde, j.periodo_hasta, '[]')
        && daterange(v_job.periodo_desde, v_job.periodo_hasta, '[]')
    returning j.id
  ),
  limpieza as (
    -- Una conciliación que deja de regir deja de mover saldo.
    delete from public.aplicaciones_cobro a
     using degradadas d
     where a.job_id = d.id
    returning a.job_id
  )
  select d.id from degradadas d;

  update public.jobs_conciliacion
     set estado_contable   = 'aprobada',
         fecha_aprobacion  = now(),
         usuario_aprobador = p_usuario
   where id = p_job_id;
end;
$$;

comment on function public.aprobar_conciliacion(text, uuid) is
  'Aprueba una conciliación y degrada a `reemplazada` las aprobadas que se '
  'solapen, borrando sus aplicaciones de cobro. Atómico. Rechaza reaprobar una '
  'ya aprobada: pisaría los datos de auditoría de la aprobación original.';

create or replace function public.cambiar_estado_contable(
  p_job_id text,
  p_estado text,
  p_usuario uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual text;
begin
  if p_estado not in ('borrador', 'en_proceso', 'observada', 'anulada') then
    raise exception 'Estado no permitido por esta vía: %', p_estado
      using errcode = 'check_violation';
  end if;

  select estado_contable into v_actual
    from public.jobs_conciliacion
   where id = p_job_id
   for update;

  if not found then
    raise exception 'Conciliación no encontrada' using errcode = 'no_data_found';
  end if;

  -- Hueco 2: `anulada` es terminal igual que `reemplazada`. Rehacer un período
  -- descartado se hace conciliándolo de nuevo, que deja rastro; revivir el
  -- documento anulado lo borraría.
  if v_actual in ('anulada', 'reemplazada') then
    raise exception 'Una conciliación anulada o reemplazada ya no admite cambios'
      using errcode = 'check_violation';
  end if;

  if v_actual = p_estado then
    raise exception 'La conciliación ya está en ese estado'
      using errcode = 'check_violation';
  end if;

  update public.jobs_conciliacion
     set estado_contable = p_estado,
         -- Deja de regir: la aprobación previa ya no vale.
         fecha_aprobacion = null,
         usuario_aprobador = null
   where id = p_job_id;

  -- Al salir de `aprobada` el documento deja de mover saldo.
  delete from public.aplicaciones_cobro where job_id = p_job_id;
end;
$$;

comment on function public.cambiar_estado_contable(text, text, uuid) is
  'Observa, anula o reabre una conciliación. `anulada` y `reemplazada` son '
  'terminales. Borra sus aplicaciones de cobro: solo la aprobada mueve saldo.';

revoke all on function public.aprobar_conciliacion(text, uuid) from public, anon, authenticated;
revoke all on function public.cambiar_estado_contable(text, text, uuid) from public, anon, authenticated;
grant execute on function public.aprobar_conciliacion(text, uuid) to service_role;
grant execute on function public.cambiar_estado_contable(text, text, uuid) to service_role;

-- ============================================================================
-- 0015_saldo_no_negativo.sql — Que aplicar de mas falle en voz alta
-- ============================================================================

-- ============================================================================
-- 0015_saldo_no_negativo.sql — Que aplicar de más falle en voz alta
--
-- Tercera y última red del arreglo del doble descuento. Las otras dos viven en
-- la aplicación:
--
--   1. El wizard ya no ofrece como registros internos los comprobantes
--      saldados ni anulados.
--   2. `calcularAplicaciones` topa lo aplicado al saldo que le queda al
--      comprobante, descontando lo que aplicaron OTROS jobs.
--
-- Las dos se pueden esquivar: un script con `service_role`, un nodo de n8n mal
-- editado o un camino futuro que nadie previó escriben directo en
-- `aplicaciones_cobro` y el trigger recalcula sin preguntar.
--
-- EL PROBLEMA DE FONDO ERA EL PROPIO TRIGGER. La versión de la 0008 cerraba el
-- cálculo con `greatest(..., 0)`, así que aplicar 2000 sobre una factura de
-- 1000 no dejaba rastro: el saldo se quedaba en 0 y el comprobante figuraba
-- como cobrado, correcto a la vista, con el doble de aplicaciones detrás. Ese
-- clamp no protegía de nada; escondía el error justo donde se vería.
--
-- Aquí se quita el clamp y se añade la constraint que antes era imposible de
-- violar. A partir de ahora, aplicar de más aborta la escritura con un error
-- en vez de corromper la contabilidad en silencio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ¿Hay ya excesos escondidos por el clamp? Se avisa con nombres y apellidos
--    en lugar de fallar con un mensaje opaco al crear la constraint.
-- ---------------------------------------------------------------------------
do $$
declare
  v_malos int;
  v_detalle text;
begin
  select count(*), string_agg(x.serie_numero || ' (importe ' || x.importe ||
                              ', aplicado ' || x.aplicado || ')', '; ')
    into v_malos, v_detalle
    from (
      select c.serie_numero,
             abs(c.monto) as importe,
             sum(a.monto_aplicado) as aplicado
        from public.comprobantes c
        join public.aplicaciones_cobro a on a.comprobante_id = c.id
       group by c.id, c.serie_numero, c.monto
      having sum(a.monto_aplicado) > abs(c.monto) + 0.005
    ) x;

  if v_malos > 0 then
    raise exception
      'No se puede aplicar 0015: % comprobante(s) tienen mas aplicado que su '
      'importe: %. Son cobros duplicados que el clamp del trigger venia '
      'ocultando. Revisa `aplicaciones_cobro` por comprobante_id y elimina el '
      'exceso antes de volver a intentarlo.',
      v_malos, v_detalle;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. El trigger deja de disimular: el saldo dice lo que de verdad hay.
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
  -- Sin `greatest(..., 0)`: si lo aplicado supera al importe, el saldo sale
  -- negativo y la constraint de abajo aborta la operación. Es justo lo que se
  -- quiere — el error se ve en el momento y no meses después.
  update public.comprobantes c
     set saldo = abs(c.monto) - coalesce((
           select sum(a.monto_aplicado)
             from public.aplicaciones_cobro a
            where a.comprobante_id = v_comprobante
         ), 0)
   where c.id = v_comprobante;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. La red. Se permite exactamente 0 (factura cobrada del todo), nunca menos.
--    Los importes son numeric(14,2): no hay deriva de redondeo que justifique
--    un margen, así que si sale negativo es que se aplicó de más.
-- ---------------------------------------------------------------------------
alter table public.comprobantes
  drop constraint if exists comprobantes_saldo_no_negativo;

alter table public.comprobantes
  add constraint comprobantes_saldo_no_negativo
  check (saldo is null or saldo >= 0);

comment on constraint comprobantes_saldo_no_negativo on public.comprobantes is
  'Un comprobante no puede recibir mas cobros que su importe. Si esta '
  'constraint salta, se aplico dos veces el mismo documento: revisa '
  '`aplicaciones_cobro` por comprobante_id antes de tocar el saldo.';

-- ============================================================================
-- 0016_reversiones_cobro.sql — Anular un cobro suelto sin tumbar la conciliacion
-- ============================================================================

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


-- ============================================================================
-- 0018_comprobantes_sin_duplicados.sql — Que subir dos veces la plantilla no
-- duplique las facturas, y poder deshacer una carga.
--
-- `importarComprobantes` hacía `insert` a secas. Subir el mismo archivo dos
-- veces creaba dos juegos de comprobantes idénticos, y el daño no se queda en
-- una lista fea: cada copia lleva su propio `saldo`, así que la empresa
-- aparecía debiendo el doble en Por cobrar, y el wizard ofrecía dos veces la
-- misma factura como registro interno.
--
-- POR QUÉ LA CLAVE ES (empresa_id, tipo, serie_numero) Y NO EL MONTO:
--
--   Una factura se identifica por su serie y número; es lo que la hace única
--   para SUNAT y para el cliente. Deduplicar por (fecha, monto, contraparte)
--   fusionaría dos boletas legítimas del mismo cliente por el mismo importe el
--   mismo día — que en un negocio con precios fijos pasa todos los días.
--
--   `tipo` entra en la clave porque una cobranza y un pago pueden compartir
--   numeración: son documentos de emisores distintos.
--
-- POR QUÉ EL ÍNDICE ES PARCIAL:
--
--   `serie_numero` es opcional en la plantilla (hay ventas al contado sin
--   documento). Sin número no hay identidad que comparar, así que esas filas
--   quedan fuera del índice y se insertan siempre. La alternativa —inventarles
--   una clave— acabaría descartando ventas reales.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Lote de importación: qué comprobantes entraron juntos, para poder deshacer
-- esa carga sin tocar las demás. Nulo en todo lo cargado antes de esta
-- migración (no hay forma de reconstruirlo) y en lo que no venga de plantilla.
-- ---------------------------------------------------------------------------
alter table public.comprobantes
  add column if not exists lote_importacion uuid;

create index if not exists comprobantes_lote_idx
  on public.comprobantes (lote_importacion)
  where lote_importacion is not null;

comment on column public.comprobantes.lote_importacion is
  'Identifica los comprobantes subidos en una misma carga de plantilla, para poder deshacerla.';

-- ---------------------------------------------------------------------------
-- Limpieza de los duplicados que ya existen.
--
-- Se conserva el MÁS ANTIGUO de cada grupo: es el que pudo entrar en una
-- conciliación, y el que el usuario vio primero.
--
-- Solo se borran copias INTACTAS —sin cobros aplicados ni reversiones—. Una
-- copia con cobros detrás no es basura de una importación repetida: es parte de
-- una conciliación aprobada, y borrarla en una migración silenciosa sería
-- exactamente el tipo de daño que este proyecto evita.
-- ---------------------------------------------------------------------------
with ordenados as (
  select id,
         row_number() over (
           partition by empresa_id, tipo, upper(btrim(serie_numero))
           order by created_at, id
         ) as pos
    from public.comprobantes
   where serie_numero is not null
     and btrim(serie_numero) <> ''
)
delete from public.comprobantes c
 using ordenados o
 where c.id = o.id
   and o.pos > 1
   and not exists (select 1 from public.aplicaciones_cobro a where a.comprobante_id = c.id)
   and not exists (select 1 from public.reversiones_cobro r where r.comprobante_id = c.id);

-- Si tras la limpieza siguen quedando duplicados, es porque tienen cobros
-- detrás. Se aborta con un mensaje que dice qué hacer, en vez de dejar que
-- falle el índice con un error de Postgres que no orienta a nadie.
do $$
declare
  v_dups int;
begin
  select count(*) into v_dups from (
    select 1
      from public.comprobantes
     where serie_numero is not null and btrim(serie_numero) <> ''
     group by empresa_id, tipo, upper(btrim(serie_numero))
    having count(*) > 1
  ) x;

  if v_dups > 0 then
    raise exception
      'Quedan % series duplicadas con cobros aplicados. Revisa cual conservar '
      '(anula el cobro de la copia sobrante en /comprobantes) y vuelve a aplicar '
      'esta migracion.', v_dups
      using errcode = 'unique_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- La regla, en la base. La app además la comprueba antes de insertar para poder
-- decir "20 ya existían", pero el que manda es este índice: vale para cualquier
-- escritura, venga de la app, de n8n o de un psql.
-- ---------------------------------------------------------------------------
create unique index if not exists comprobantes_serie_unica
  on public.comprobantes (empresa_id, tipo, upper(btrim(serie_numero)))
  where serie_numero is not null and btrim(serie_numero) <> '';


-- ============================================================================
-- 0019_criterios_empresa.sql — Arranque en frío del aprendizaje
--
-- EL PROBLEMA: el aprendizaje se alimenta de decisiones humanas anteriores. Una
-- empresa nueva tiene CERO, justo durante los 30 días de prueba en que decide
-- si paga. El diferenciador del producto está vacío exactamente cuando se
-- evalúa el producto.
--
-- LA SALIDA: que declare su criterio en vez de esperar a que se deduzca. No es
-- lo mismo que una decisión real —es lo que dicen que hacen, no lo que hacen—,
-- y por eso viaja al prompt en una sección aparte y con otro nombre. Pero es
-- criterio DE ESA EMPRESA desde el primer día, que es justo lo que faltaba.
--
-- POR QUÉ UNA COLUMNA APARTE Y NO DENTRO DE `config_conciliacion`:
--
--   `config_conciliacion` son números que el motor consume como tolerancias
--   (`ConfigConciliacion` en el contrato zod, validado y con forma cerrada).
--   Esto son afirmaciones en lenguaje natural que acaban en un prompt. Meterlas
--   ahí obligaría a ensanchar un esquema estricto que ya viaja en cada payload,
--   y a que el motor heurístico —que no lee prompts— cargara con ellas.
-- ============================================================================

alter table public.empresas
  add column if not exists criterios_conciliacion jsonb not null default '[]'::jsonb;

comment on column public.empresas.criterios_conciliacion is
  'Codigos de criterio declarados por la empresa (ver src/lib/criteriosIniciales.ts). '
  'Semilla del aprendizaje mientras no hay decisiones humanas.';

-- ---------------------------------------------------------------------------
-- ⚠️ IMPRESCINDIBLE, Y FÁCIL DE OLVIDAR.
--
-- La `0005` revocó el UPDATE amplio sobre `empresas` y lo reconcedió columna a
-- columna (nombre, ruc, config_conciliacion) para que nadie se auto-active el
-- plan. Consecuencia: una columna nueva **nace sin permiso de escritura**, y la
-- pantalla fallaría al guardar sin decir por qué — RLS deja pasar la fila y es
-- el GRANT el que la para.
--
-- `plan` y `prueba_hasta` siguen fuera, que es el motivo de todo aquello.
-- ---------------------------------------------------------------------------
grant update (criterios_conciliacion) on public.empresas to authenticated;


-- ============================================================================
-- 0020_referencia_externa.sql — Separar el NÚMERO DE DOCUMENTO de la
-- REFERENCIA DE EMPAREJAMIENTO
--
-- EL PROBLEMA, encontrado con datos reales de una recaudadora de telecom:
--
--   `serie_numero` hacía dos trabajos incompatibles a la vez. Es el número del
--   documento —único, y por eso lleva el índice de la `0018` que impide cargar
--   dos veces la misma factura— y ADEMÁS era lo que el motor usaba para casar
--   contra el extracto (`getComprobantesCanonicos` lo mapea a `referencia`).
--
--   En una cuenta recaudadora esos dos datos NO son el mismo:
--
--     Recibos   SR11-02748951, SR11-03590663   → único por documento
--     EFECTIVO  00000001300486                 → la operación bancaria, y se
--                                                REPITE cuando un cliente paga
--                                                dos recibos de una vez
--
--   Con un solo campo había que elegir: o el índice único rechazaba 509 de
--   20.000 filas (las que comparten operación), o el motor no podía casar por
--   referencia y 20.000 registros caían en las capas cuadráticas.
--
--   Justamente esos casos repetidos son la agrupación 1:N —dos recibos, un
--   depósito— que el motor ya sabe detectar. Perderlos en la importación era
--   perder exactamente lo que hay que conciliar.
--
-- LA SEPARACIÓN:
--
--   serie_numero        → identidad del documento. Único (índice de la 0018).
--   referencia_externa  → con qué casarlo en el banco. Se repite a propósito.
-- ============================================================================

alter table public.comprobantes
  add column if not exists referencia_externa text;

comment on column public.comprobantes.referencia_externa is
  'Referencia con la que el motor casa contra el extracto (codigo de operacion, '
  'numero de deposito). SE REPITE cuando varios comprobantes se pagan juntos: no '
  'lleva indice unico, a diferencia de serie_numero.';

-- Búsqueda por referencia al conciliar y al investigar un cobro.
create index if not exists comprobantes_referencia_externa_idx
  on public.comprobantes (empresa_id, referencia_externa)
  where referencia_externa is not null;

-- ---------------------------------------------------------------------------
-- PERMISOS POR COLUMNA — el mismo cierre de la 0008/0010.
--
-- `revoke update` + `grant update (...)` significa que **toda columna nueva
-- nace sin permiso de escritura**, así que hay que reconceder la lista entera
-- cada vez. Se mantiene fuera `saldo`: lo decide el trigger a partir de las
-- aplicaciones, nunca el usuario.
-- ---------------------------------------------------------------------------
revoke update on public.comprobantes from authenticated;
grant  update (fecha, fecha_vencimiento, monto, tipo, serie_numero,
               referencia_externa, ruc_contraparte, razon_social_contraparte,
               descripcion, anulado)
  on public.comprobantes to authenticated;

-- ---------------------------------------------------------------------------
-- Y el INSERT, que estaba sin cubrir.
--
-- La `0018` añadió `lote_importacion` sin tocar permisos y ese camino no se ha
-- ejercitado desde entonces: si el INSERT estuviera acotado por columna, la
-- importación fallaría con un error de permisos difícil de leer. Los GRANT son
-- aditivos, así que esto es inocuo si ya había permiso a nivel de tabla, y lo
-- arregla si no lo había.
-- ---------------------------------------------------------------------------
grant insert (empresa_id, fecha, fecha_vencimiento, monto, tipo, serie_numero,
              referencia_externa, ruc_contraparte, razon_social_contraparte,
              descripcion, origen, lote_importacion)
  on public.comprobantes to authenticated;


-- ============================================================================
-- 0021_resumen_saldos.sql — Agregar la antigüedad de deuda EN LA BASE
--
-- Por cobrar / Por pagar traían todas las filas pendientes y las sumaban en
-- Node. Con 452.309 comprobantes eso son ~453 peticiones paginadas de 1.000
-- filas: varios minutos para pintar una tabla de cinco columnas.
--
-- Y el resultado es diminuto: lo que la pantalla enseña es un total por
-- contraparte y tramo. Traer medio millón de filas para producir unas pocas
-- decenas es el trabajo puesto en el sitio equivocado.
--
-- ⚠️ ESTA FUNCIÓN DUPLICA REGLAS QUE VIVEN EN TypeScript:
--
--   · qué cuenta como deuda viva  → `cuentaComoPendiente` (src/lib/aging.ts)
--   · los tramos de antigüedad    → `tramoDe` + `diasVencido` (idem)
--   · la normalización del buscador → `normalizar` (src/lib/filtrosComprobantes.ts)
--
-- Si se separan, la pantalla enseñará totales que no corresponden a sus filas
-- y nadie sabrá cuál creer. Hay tests que fijan el lado TypeScript; al tocar
-- cualquiera de los tres hay que tocar esto.
-- ============================================================================

-- Para reproducir el `normalize("NFD") + quitar diacríticos` de JS.
create extension if not exists unaccent;

-- ---------------------------------------------------------------------------
-- resumen_saldos(tipo, tramo, solo_vencido, busca, hoy)
--
-- Devuelve una fila por (contraparte, tramo). SECURITY INVOKER —el modo por
-- defecto— para que RLS siga aplicando: cada empresa solo agrega lo suyo.
--
-- `p_hoy` es un parámetro y no `current_date` para que los tests puedan fijar
-- el día. Los tramos dependen de la fecha, y una función que solo se puede
-- probar "hoy" no se puede probar.
-- ---------------------------------------------------------------------------
create or replace function public.resumen_saldos(
  p_tipo         text,
  p_tramo        text default 'todos',
  p_solo_vencido boolean default false,
  p_busca        text default '',
  p_hoy          date default current_date
)
returns table (
  contraparte text,
  ruc         text,
  tramo       text,
  total       numeric,
  documentos  bigint
)
language sql
stable
-- ⚠️⚠️ SECURITY DEFINER: RLS NO se aplica dentro. El control de acceso es la
-- linea `c.empresa_id in (select ... where ue.usuario_id = auth.uid())` de mas
-- abajo, y esa linea ES la frontera de seguridad — quitarla filtraria los
-- saldos de unas empresas a otras.
--
-- No es una preferencia: medido contra los 452.309 comprobantes de un cliente
-- real, la misma agregacion tarda 187 ms sin RLS y 9.500 ms con ella, por
-- encima del statement_timeout de 8 s. El predicado de RLS es
-- `es_miembro(empresa_id)`, una funcion sobre una COLUMNA, asi que Postgres la
-- ejecuta una vez por fila. Aqui la pertenencia se resuelve UNA vez.
--
-- Mismo patron que `aprobar_conciliacion` (0013). La regla al tocar esto: la
-- funcion NUNCA acepta un empresa_id por parametro; la empresa sale siempre de
-- `auth.uid()`.
security definer
set search_path = public
as $$
  -- Las empresas del usuario, resueltas UNA vez. Esta CTE y el `in` de abajo
  -- son el control de acceso de la funcion (ver la nota de SECURITY DEFINER).
  with mias as (
    select ue.empresa_id
      from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  base as (
    select
      -- Mismo criterio que el TypeScript: sin nombre, un cubo único. Si cada
      -- factura sin identificar fuera su propia fila, la tabla sería inútil.
      coalesce(nullif(btrim(c.razon_social_contraparte), ''), 'Sin identificar') as contraparte,
      c.ruc_contraparte as ruc,
      c.saldo,
      -- diasVencido: se cuenta desde el vencimiento y, si no lo hay —muchas
      -- ventas son al contado—, desde la emisión.
      p_hoy - coalesce(c.fecha_vencimiento, c.fecha) as dias
    from public.comprobantes c
    -- ⚠️ FRONTERA DE SEGURIDAD. No tocar sin leer la nota de arriba.
    where c.empresa_id in (select m.empresa_id from mias m)
      and c.estado not in ('anulado', 'cobrado')
      -- Por debajo de medio céntimo no hay deuda que gestionar.
      and c.saldo > 0.005
      and case
            when p_tipo = 'pago' then c.tipo = 'pago'
            -- Un comprobante SIN tipo se cuenta como cobranza, igual que en el
            -- resto del sistema.
            else c.tipo is null or c.tipo = 'cobranza'
          end
      -- ⚠️ El buscador se aplica AQUI y no despues, con el corte barato
      -- delante. Calculando `unaccent(lower(...))` como columna se evaluaba
      -- para las 452.309 filas aunque nadie hubiera escrito nada en la caja:
      -- 9,2 s, por encima del statement_timeout de 8. Con el corte constante a
      -- la izquierda, sin busqueda no se llama a unaccent ni una vez.
      and (
        btrim(p_busca) = ''
        or unaccent(lower(
             coalesce(c.serie_numero, '') || ' ' ||
             coalesce(c.razon_social_contraparte, '') || ' ' ||
             coalesce(c.ruc_contraparte, '')
           )) like '%' || unaccent(lower(btrim(p_busca))) || '%'
      )
  ),
  clasificado as (
    select
      b.contraparte, b.ruc, b.saldo,
      case
        -- Sin fecha no se puede saber si venció: se trata como por vencer, que
        -- es lo prudente — no se reclama una deuda que quizá no lo esté.
        when b.dias is null or b.dias <= 0 then 'por_vencer'
        when b.dias <= 30 then 'd1_30'
        when b.dias <= 60 then 'd31_60'
        when b.dias <= 90 then 'd61_90'
        else 'd90_mas'
      end as tramo
    from base b
  )
  select
    c.contraparte,
    -- Determinista a propósito. El TypeScript tomaba el RUC del primer
    -- comprobante que veía; aquí manda el orden, que no depende del paginado.
    min(c.ruc) as ruc,
    c.tramo,
    sum(c.saldo)::numeric as total,
    count(*)::bigint as documentos
  from clasificado c
  where (p_tramo = 'todos' or c.tramo = p_tramo)
    -- "Vencido" es todo lo que ya pasó su fecha: cualquier tramo menos el
    -- primero, que es justamente el de lo que aún no vence.
    and (not p_solo_vencido or c.tramo <> 'por_vencer')
  group by c.contraparte, c.tramo;
$$;

-- ⚠️ Llamada con `service_role` (que salta RLS) devuelve VACÍO, porque
-- `auth.uid()` es nulo y no hay empresa que resolver. Es lo correcto para esta
-- función —la piden las pantallas en nombre del usuario— pero conviene saberlo
-- antes de depurarla desde un script con la clave de servicio.

comment on function public.resumen_saldos(text, text, boolean, text, date) is
  'Antigüedad de deuda agregada por contraparte y tramo. Reemplaza el traer '
  'medio millón de filas para sumarlas en la aplicación. SECURITY INVOKER: RLS '
  'sigue acotando por empresa.';

-- ⚠️ El REVOKE no sobra: Postgres concede EXECUTE a `public` por defecto en
-- cada función nueva, así que sin esto `anon` podría invocar una función
-- SECURITY DEFINER. Hoy no filtraría nada (sin `auth.uid()` no hay empresa que
-- resolver y devuelve vacío), pero dejar una puerta abierta que depende de que
-- el cuerpo se porte bien es exactamente lo que no se hace con `definer`.
-- Mismo cierre que las funciones de la 0013.
revoke all on function public.resumen_saldos(text, text, boolean, text, date)
  from public, anon;
grant execute on function public.resumen_saldos(text, text, boolean, text, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Índice de apoyo. La función escanea `comprobantes` filtrando por estado y
-- saldo, que es justo lo que aquí se acota. Parcial para que ocupe lo que la
-- deuda viva y no lo que la tabla entera: en una empresa con medio millón de
-- comprobantes casi todos acaban cobrados.
-- ---------------------------------------------------------------------------
create index if not exists idx_comprobantes_saldo_vivo
  on public.comprobantes (empresa_id, tipo)
  where estado not in ('anulado', 'cobrado') and saldo > 0.005;


-- ============================================================================
-- 0022_movimientos_extracto.sql — El extracto bancario deja de vivir en el
-- navegador (parte B, etapa 1)
--
-- Hasta aquí, el extracto se parseaba en el navegador y sus filas viajaban
-- dentro del payload a n8n. Eso topa tres veces con un cliente grande:
--
--   1. el navegador tiene que abrir un Excel de 23 MB con 450.999 filas y
--      construir un JSON de ~175 MB en memoria — no llega ni a enviarse;
--   2. el payload supera el límite del webhook de n8n (64 MB);
--   3. y aunque cupiera, `resultado` sería un JSONB de cientos de MB en UNA
--      fila.
--
-- Esta migración resuelve (1) y prepara (2) y (3): los movimientos se guardan
-- en una tabla, igual que los comprobantes, y se cargan por lotes desde el
-- servidor leyendo el archivo a trozos.
--
-- ⚠️ No sustituye al payload todavía. La conciliación sigue enviando las
-- partidas a n8n; lo que cambia es DÓNDE viven mientras tanto. Las etapas 2 a 4
-- (capa exacta en SQL, n8n con el residuo, y la pantalla leyendo de tabla) van
-- aparte para poder desplegar esto sin romper lo que ya funciona.
-- ============================================================================

create table if not exists public.movimientos_extracto (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas (id) on delete cascade,
  cuenta_id    uuid not null references public.cuentas_bancarias (id) on delete cascade,
  -- Una carga de extracto. Permite reemplazar lo subido sin tocar otras cuentas
  -- ni otros períodos, igual que `lote_importacion` en comprobantes.
  lote_id      uuid not null,
  fecha        date not null,
  -- Convención de signos ÚNICA del sistema: abonos +, cargos −. Se aplica al
  -- normalizar y no se reinterpreta después.
  monto        numeric(14,2) not null,
  referencia_banco text,
  glosa        text,
  saldo        numeric(14,2),
  -- Posición en el archivo. De aquí sale el `id_movimiento` sintético
  -- ("BCO-0001") que usa el contrato: tiene que ser ESTABLE entre corridas, y
  -- un uuid no se puede leer en pantalla.
  orden        integer not null,
  created_at   timestamptz not null default now()
);

-- Recorrido natural: los movimientos de una cuenta en un rango de fechas. Es
-- lo que pedirá la capa exacta en SQL (etapa 2).
create index if not exists idx_mov_extracto_cuenta_fecha
  on public.movimientos_extracto (empresa_id, cuenta_id, fecha);

-- Para reemplazar o deshacer una carga completa.
create index if not exists idx_mov_extracto_lote
  on public.movimientos_extracto (lote_id);

-- El emparejamiento por referencia es el que resuelve el 88-100% en una cuenta
-- recaudadora. Sin índice, la capa exacta en SQL sería un producto cartesiano.
create index if not exists idx_mov_extracto_referencia
  on public.movimientos_extracto (empresa_id, referencia_banco)
  where referencia_banco is not null;

-- ---------------------------------------------------------------------------
-- RLS. Mismo criterio que el resto: la empresa ve y escribe lo suyo.
--
-- ⚠️ El INSERT lo hace el backend con `service_role` (la ingesta por lotes),
-- pero la política de lectura tiene que existir igual para que las pantallas
-- puedan mostrar lo cargado.
-- ---------------------------------------------------------------------------
alter table public.movimientos_extracto enable row level security;

drop policy if exists mov_extracto_select on public.movimientos_extracto;
create policy mov_extracto_select on public.movimientos_extracto
  for select to authenticated
  using (public.es_miembro(empresa_id));

drop policy if exists mov_extracto_delete on public.movimientos_extracto;
create policy mov_extracto_delete on public.movimientos_extracto
  for delete to authenticated
  using (public.es_miembro(empresa_id));

comment on table public.movimientos_extracto is
  'Movimientos del extracto bancario ya normalizados. Sustituyen al parseo en '
  'el navegador para archivos grandes: se cargan por lotes desde el servidor.';

-- ---------------------------------------------------------------------------
-- El job apunta al lote de extracto que usó.
--
-- Nullable a propósito: las conciliaciones anteriores a esta migración llevan
-- sus movimientos dentro de `payload_entrada` y tienen que seguir leyéndose.
-- ---------------------------------------------------------------------------
alter table public.jobs_conciliacion
  add column if not exists lote_extracto_id uuid;

comment on column public.jobs_conciliacion.lote_extracto_id is
  'Lote de `movimientos_extracto` usado. Null en los jobs antiguos, que llevan '
  'los movimientos dentro de payload_entrada.';


-- ============================================================================
-- 0023_capa_exacta_sql.sql — La capa exacta corre en la base (parte B, etapa 2)
--
-- El motor de n8n recibe las partidas por el payload y las empareja en
-- JavaScript. A 2.000 partidas eso es instantáneo; a 900.000 no llega ni a
-- enviarse. Pero la capa exacta —mismo monto y misma referencia— es
-- literalmente un JOIN, y Postgres lo hace sobre medio millón de filas en
-- segundos.
--
-- Con la recaudadora de junio eso significa resolver ~450.000 pares SIN que
-- n8n vea una sola fila, y mandarle solo el residuo: miles, no cientos de
-- miles.
--
-- ⚠️ SOLO EL PASS 1 (monto + referencia). El respaldo por monto + FECHA se
-- queda en n8n a propósito: necesita la guarda de contradicción de referencias
-- —sin ella emparejó 541 pares sin relación y los marcó `auto`, o sea
-- conciliados sin que nadie los mirara— y esa lógica ya está escrita, probada y
-- documentada en `n8n/01_exacta.js`. Reescribirla aquí sería duplicar el punto
-- exacto donde el motor puede equivocarse en silencio.
--
-- n8n vuelve a correr su capa exacta sobre el residuo: el pass 1 no encontrará
-- nada nuevo (ya lo hizo esta función) y el pass 2 hará su trabajo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- matches_conciliacion — los pares, en una TABLA
--
-- `resultado` es un JSONB en una fila del job. A 2.000 partidas basta; con
-- 450.000 pares serían cientos de MB que hay que leer enteros para pintar una
-- pantalla. Aquí caben, se paginan y se actualizan de uno en uno.
--
-- Arrays en los dos lados porque un match puede ser 1:N o N:1 (la agrupación
-- que ya detecta el motor). La capa exacta siempre escribe uno y uno.
-- ---------------------------------------------------------------------------
create table if not exists public.matches_conciliacion (
  id                   uuid primary key default gen_random_uuid(),
  job_id               text not null references public.jobs_conciliacion (id) on delete cascade,
  empresa_id           uuid not null references public.empresas (id) on delete cascade,
  comprobante_ids      uuid[] not null default '{}',
  movimiento_ids       uuid[] not null default '{}',
  metodo               text not null,
  estado_revision      text not null,
  confianza            numeric(4,3),
  categoria_diferencia text,
  diferencia_monto     numeric(14,2),
  diferencia_dias      integer,
  justificacion        text,
  -- Cada decisión humana, con usuario y timestamp. Es la materia prima del
  -- aprendizaje y no se pierde ninguna (mismo criterio que en el JSONB).
  decisiones           jsonb not null default '[]'::jsonb,
  excluido_aprendizaje boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint matches_metodo_chk
    check (metodo in ('exacta', 'difusa', 'ia', 'manual')),
  constraint matches_estado_chk
    check (estado_revision in ('auto', 'pendiente', 'aceptado', 'rechazado', 'modificado'))
);

create index if not exists idx_matches_job on public.matches_conciliacion (job_id);
create index if not exists idx_matches_job_estado
  on public.matches_conciliacion (job_id, estado_revision);
-- Para saber si un comprobante ya está casado en este job sin recorrer la tabla.
create index if not exists idx_matches_comprobantes
  on public.matches_conciliacion using gin (comprobante_ids);

alter table public.matches_conciliacion enable row level security;

drop policy if exists matches_select on public.matches_conciliacion;
create policy matches_select on public.matches_conciliacion
  for select to authenticated
  using (public.es_miembro(empresa_id));

comment on table public.matches_conciliacion is
  'Pares conciliados. Sustituye a resultado.matches (JSONB) cuando el volumen '
  'no cabe en una fila. Arrays en ambos lados: soporta 1:N y N:1.';

-- ---------------------------------------------------------------------------
-- conciliar_exacta(job) — el JOIN
--
-- SECURITY DEFINER y concedida SOLO a `service_role`: la invoca el backend
-- después de crear el job, nunca el navegador. No hay `auth.uid()` de por
-- medio, así que la pertenencia sale del propio job.
-- ---------------------------------------------------------------------------
create or replace function public.conciliar_exacta(p_job_id text)
returns table (pares bigint, internos bigint, movimientos bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
  v_pares bigint;
  v_int   bigint;
  v_mov   bigint;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;
  if v_job.lote_extracto_id is null then
    raise exception 'El job % no tiene extracto cargado en tabla', p_job_id
      using errcode = 'check_violation';
  end if;

  -- Reentrante: volver a lanzarla no duplica pares.
  delete from public.matches_conciliacion
   where job_id = p_job_id and metodo = 'exacta';

  with comps as (
    select
      c.id,
      -- Misma convención de signos que el resto del sistema: cobranza +,
      -- pago −. Y los MISMOS céntimos con signo que usa `01_exacta.js`; en
      -- valor absoluto un cobro casaría con un pago del mismo importe.
      round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100)::bigint as cent,
      -- `referencia_externa` manda cuando existe; si no, el número de
      -- documento. Igual que `getComprobantesCanonicos`.
      upper(regexp_replace(coalesce(c.referencia_externa, c.serie_numero, ''), '[^A-Za-z0-9]', '', 'g')) as ref
    from public.comprobantes c
    where c.empresa_id = v_job.empresa_id
      and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
      -- Lo ya cobrado y lo anulado no vuelve a conciliarse: es la primera de
      -- las tres capas contra el doble cobro.
      and c.estado not in ('cobrado', 'anulado')
  ),
  movs as (
    select
      m.id,
      round(m.monto * 100)::bigint as cent,
      upper(regexp_replace(coalesce(m.referencia_banco, ''), '[^A-Za-z0-9]', '', 'g')) as ref
    from public.movimientos_extracto m
    where m.lote_id = v_job.lote_extracto_id
  ),
  -- ⚠️ El `row_number` reproduce el "toma el siguiente libre" del JavaScript.
  -- Con cientos de recibos del mismo importe y la misma referencia, un JOIN a
  -- secas daría el producto cartesiano: 300 × 300 = 90.000 pares en vez de 300.
  -- Numerando cada lado dentro de su grupo y casando por número, cada partida
  -- se empareja UNA vez.
  ci as (
    select id, cent, ref,
           row_number() over (partition by cent, ref order by id) as n
      from comps where ref <> ''
  ),
  mi as (
    select id, cent, ref,
           row_number() over (partition by cent, ref order by id) as n
      from movs where ref <> ''
  ),
  pares as (
    insert into public.matches_conciliacion (
      job_id, empresa_id, comprobante_ids, movimiento_ids,
      metodo, estado_revision, diferencia_monto
    )
    select
      p_job_id, v_job.empresa_id, array[ci.id], array[mi.id],
      'exacta',
      -- `auto` como en el motor: exigir un clic humano en cada match exacto
      -- vaciaría de sentido el producto. Y `auto` descuenta saldo.
      'auto',
      0
    from ci join mi on ci.cent = mi.cent and ci.ref = mi.ref and ci.n = mi.n
    returning 1
  )
  select count(*) into v_pares from pares;

  select count(*) into v_int from public.comprobantes c
   where c.empresa_id = v_job.empresa_id
     and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
     and c.estado not in ('cobrado', 'anulado');
  select count(*) into v_mov from public.movimientos_extracto m
   where m.lote_id = v_job.lote_extracto_id;

  return query select v_pares, v_int, v_mov;
end;
$$;

comment on function public.conciliar_exacta(text) is
  'Capa exacta (monto + referencia) como JOIN. Escribe en matches_conciliacion '
  'y deja el residuo para n8n. El respaldo por monto+fecha NO está aquí: vive '
  'en n8n/01_exacta.js con su guarda de contradicción de referencias.';

revoke all on function public.conciliar_exacta(text) from public, anon, authenticated;
grant execute on function public.conciliar_exacta(text) to service_role;


-- ============================================================================
-- 0024_residuo_conciliacion.sql — Lo que queda para n8n (parte B, etapa 3)
--
-- Tras `conciliar_exacta` (0023), la inmensa mayoría de las partidas ya están
-- casadas. Lo que el motor tiene que mirar es solo lo que sobró: con junio
-- completo de la recaudadora, 4.382 internos y 3.204 movimientos de 903.176.
--
-- El backend NO puede calcular ese residuo trayéndose las partidas y restando:
-- serían las 900.000 otra vez, que es justo lo que estamos evitando. Se lo pide
-- a la base, que ya sabe cuáles casaron.
--
-- Las dos funciones devuelven las filas EN LA FORMA DEL CONTRATO
-- (`RegistroInterno` / `MovimientoBancario` de src/lib/contract/payload.ts),
-- para que el backend solo tenga que validarlas con zod y enviarlas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- residuo_internos(job) — comprobantes del período que no casaron
-- ---------------------------------------------------------------------------
create or replace function public.residuo_internos(p_job_id text)
returns table (
  comprobante_id uuid,
  fecha          date,
  monto          numeric,
  tipo           text,
  referencia     text,
  contraparte    text,
  descripcion    text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;

  return query
  -- ⚠️ `materialized` y anti-union, NO `c.id = any(m.comprobante_ids)`.
  --
  -- Con `any(array)` Postgres recorre los 447.795 matches POR CADA uno de los
  -- 452.177 comprobantes: la consulta no acabo en diez minutos. Desplegando los
  -- arrays UNA vez a un conjunto de ids, el planificador hace un anti-join por
  -- hash y baja a segundos. El indice GIN no salva esto: el problema es el
  -- numero de veces que se pregunta, no como se busca.
  with casados as materialized (
    select unnest(m.comprobante_ids) as id
      from public.matches_conciliacion m
     where m.job_id = p_job_id
  )
  select
    c.id,
    c.fecha,
    -- Convención de signos ÚNICA: cobranza +, pago −.
    case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end,
    case when c.tipo = 'pago' then 'pago' else 'cobranza' end,
    -- `referencia_externa` manda cuando existe; si no, el número de documento.
    coalesce(c.referencia_externa, c.serie_numero),
    c.razon_social_contraparte,
    c.descripcion
  from public.comprobantes c
  where c.empresa_id = v_job.empresa_id
    and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
    and c.estado not in ('cobrado', 'anulado')
    -- Lo que ya casó la capa exacta no vuelve a mirarse.
    and not exists (select 1 from casados k where k.id = c.id)
  -- Orden TOTAL: el id sintético del payload sale de la posición, y tiene que
  -- ser el mismo si el backend vuelve a pedirlo.
  order by c.fecha, c.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- residuo_movimientos(job) — movimientos del extracto que no casaron
-- ---------------------------------------------------------------------------
create or replace function public.residuo_movimientos(p_job_id text)
returns table (
  movimiento_id    uuid,
  fecha            date,
  monto            numeric,
  tipo             text,
  glosa            text,
  referencia_banco text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;
  if v_job.lote_extracto_id is null then
    raise exception 'El job % no tiene extracto cargado en tabla', p_job_id
      using errcode = 'check_violation';
  end if;

  return query
  -- Misma razon que en `residuo_internos`: el conjunto de casados se despliega
  -- una vez y se resta por hash.
  with casados as materialized (
    select unnest(mm.movimiento_ids) as id
      from public.matches_conciliacion mm
     where mm.job_id = p_job_id
  )
  select
    m.id,
    m.fecha,
    m.monto,
    case when m.monto < 0 then 'cargo' else 'abono' end,
    m.glosa,
    m.referencia_banco
  from public.movimientos_extracto m
  where m.lote_id = v_job.lote_extracto_id
    and not exists (select 1 from casados k where k.id = m.id)
  order by m.fecha, m.orden, m.id;
end;
$$;

comment on function public.residuo_internos(text) is
  'Comprobantes del período que la capa exacta no caso. Forma del contrato.';
comment on function public.residuo_movimientos(text) is
  'Movimientos del extracto que la capa exacta no caso. Forma del contrato.';

-- Las invoca el backend con service_role, nunca el navegador.
revoke all on function public.residuo_internos(text) from public, anon, authenticated;
revoke all on function public.residuo_movimientos(text) from public, anon, authenticated;
grant execute on function public.residuo_internos(text) to service_role;
grant execute on function public.residuo_movimientos(text) to service_role;


-- ============================================================================
-- 0025_aplicar_cobros_exactos.sql — El reparto de cobros de la capa exacta,
-- en SQL (parte B, cierre)
--
-- Aprobar una conciliación descuenta el saldo de cada comprobante cobrado. Eso
-- se calculaba en Node y se escribía por lotes: con 32.170 cobros ya tardaba
-- ~90 segundos, y con los 447.795 de un mes completo serían ~900 peticiones y
-- un cuarto de hora. Inviable, y por eso el modo tabla no movía saldo.
--
-- ── Por qué SOLO las exactas ───────────────────────────────────────────────
--
-- El reparto general no es trivial: hay pagos parciales, agrupaciones 1:N donde
-- un depósito se prorratea entre varias facturas, y diferencias absorbidas
-- (comisión, redondeo) que dan la factura por cobrada entera. Esa lógica vive
-- en `src/lib/cobranzas.ts`, es pura, tiene tests y **no conviene duplicarla**:
-- es la que decide cuánto dinero se le descuenta a quién.
--
-- Pero las de la capa exacta no tienen nada de eso. Son 1:1 y con el MISMO
-- importe en los dos lados por construcción (`conciliar_exacta` casa por
-- céntimos con signo), así que el factor de reparto es exactamente 1 y lo único
-- que queda es el tope por saldo disponible.
--
-- O sea: SQL donde el volumen es enorme y la aritmética trivial; Node donde la
-- aritmética es sutil y el volumen son unos miles. El residuo sigue pasando por
-- `calcularAplicaciones` como siempre.
-- ============================================================================

-- La version de un solo argumento existio brevemente durante el desarrollo.
-- `create or replace` con otra firma NO la sustituye: crea una funcion nueva y
-- deja la anterior viva, y con el parametro por defecto la llamada de un
-- argumento queda ambigua entre las dos.
drop function if exists public.aplicar_cobros_exactos(text);

-- ⚠️ POR LOTES, y no por gusto. Escribir las 447.795 de una vez tarda 2 min 24 s
-- —cada fila dispara el trigger que recalcula el saldo del comprobante (0008)—
-- y el `statement_timeout` del rol con el que se conecta PostgREST es de 8 s:
-- la llamada se cancelaria entera. Quien llama repite hasta que devuelva 0.
create or replace function public.aplicar_cobros_exactos(
  p_job_id text,
  p_limite integer default 20000
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
  v_n bigint;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;

  with pares as (
    select
      m.comprobante_ids[1] as comp,
      m.movimiento_ids[1]  as mov
    from public.matches_conciliacion m
    where m.job_id = p_job_id
      and m.metodo = 'exacta'
      -- Mismos estados que `ESTADOS_CONFIRMADOS` en src/lib/cobranzas.ts.
      -- `auto` CUENTA: es lo que emite el motor, y exigir un clic humano en
      -- cada match exacto vaciaría de sentido el producto.
      and m.estado_revision in ('auto', 'aceptado', 'modificado')
      and array_length(m.comprobante_ids, 1) = 1
      and array_length(m.movimiento_ids, 1) = 1
      -- Lo ya aplicado no se vuelve a mirar: es lo que hace que repetir la
      -- llamada avance en vez de rehacer el mismo trabajo.
      and not exists (
        select 1 from public.aplicaciones_cobro a
         where a.job_id = p_job_id
           and a.comprobante_id = m.comprobante_ids[1]
      )
    limit p_limite
  ),
  -- Lo que aplicaron OTROS jobs. El propio no cuenta: sus aplicaciones se
  -- borran y se rehacen en cada resincronización, así que incluirlas dejaría
  -- la segunda pasada sin nada que aplicar.
  otros as (
    select a.comprobante_id, sum(a.monto_aplicado) as aplicado
      from public.aplicaciones_cobro a
      join pares p on p.comp = a.comprobante_id
     where a.job_id <> p_job_id
     group by a.comprobante_id
  ),
  -- Un cobro que el banco revirtió deja de ocupar sitio: la factura vuelve a
  -- estar disponible.
  revertidos as (
    select r.comprobante_id, sum(r.monto_revertido) as revertido
      from public.reversiones_cobro r
      join pares p on p.comp = r.comprobante_id
     where r.job_id <> p_job_id
     group by r.comprobante_id
  ),
  calculo as (
    select
      p.comp,
      p.mov,
      abs(c.monto) as importe,
      -- Tope por saldo disponible. Sin él, la misma factura conciliada desde
      -- dos cuentas bancarias en el mismo período —que el sistema permite a
      -- propósito, son extractos distintos— descontaría su importe COMPLETO
      -- dos veces. La 0015 aborta si aun así se pasara.
      greatest(
        0,
        abs(c.monto)
          - coalesce(o.aplicado, 0)
          + coalesce(rv.revertido, 0)
      ) as disponible
    from pares p
    join public.comprobantes c on c.id = p.comp
    left join otros o       on o.comprobante_id = p.comp
    left join revertidos rv on rv.comprobante_id = p.comp
  )
  insert into public.aplicaciones_cobro
    (job_id, empresa_id, usuario_id, comprobante_id, id_movimiento, monto_aplicado)
  select
    p_job_id,
    v_job.empresa_id,
    v_job.usuario_id,
    k.comp,
    k.mov::text,
    least(k.importe, k.disponible)
  from calculo k
  -- Por debajo de medio céntimo no hay cobro que registrar, y una fila de 0
  -- solo ensucia el historial del comprobante.
  where least(k.importe, k.disponible) > 0.005
  -- Reentrante: si por lo que sea ya existía esa aplicación, no se duplica.
  on conflict (comprobante_id, job_id, id_movimiento) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.aplicar_cobros_exactos(text, integer) is
  'Escribe las aplicaciones de cobro de los pares EXACTOS de un job. Son 1:1 y '
  'con el mismo importe, así que el factor de reparto es 1: solo queda topar '
  'por saldo disponible. El resto lo calcula src/lib/cobranzas.ts.';

revoke all on function public.aplicar_cobros_exactos(text, integer) from public, anon, authenticated;
grant execute on function public.aplicar_cobros_exactos(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- ⚠️ Índice imprescindible para que los lotes NO se degraden.
--
-- El filtro "lo ya aplicado no se vuelve a mirar" busca por (job_id,
-- comprobante_id). El índice que existía (`idx_aplicaciones_job`) es solo por
-- `job_id`, así que cada lote recorría TODAS las aplicaciones ya escritas de
-- ese job: el primer lote de 20.000 tardó 10 s y el segundo 60 s, con el mismo
-- trabajo por delante. La única pista de que algo iba mal era que empeoraba.
--
-- La clave única (comprobante_id, job_id, id_movimiento) no sirve: su columna
-- principal es la equivocada para esta pregunta.
-- ---------------------------------------------------------------------------
create index if not exists idx_aplicaciones_job_comprobante
  on public.aplicaciones_cobro (job_id, comprobante_id);

-- ---------------------------------------------------------------------------
-- limpiar_cobros_desconfirmados(job)
--
-- Quita las aplicaciones de este job cuyo par ya no está confirmado: alguien
-- rechazó un match o lo devolvió a revisión, y su cobro tiene que desaparecer
-- para que el saldo vuelva.
--
-- Sustituye al "borrar todo y rehacer" que hace la versión en Node. Con 447.795
-- aplicaciones ese borrado tarda **90 segundos** —cada fila dispara el trigger
-- de saldo— y encima obliga a reescribirlas todas después. Aquí se toca solo lo
-- que cambió, que en régimen normal es nada.
--
-- ⚠️ El conjunto de comprobantes confirmados se despliega UNA vez con `unnest`.
-- Con `comprobante_id = any(m.comprobante_ids)` Postgres recorrería todos los
-- matches por cada aplicación, que es el mismo error que dejó `residuo_internos`
-- sin terminar en diez minutos.
-- ---------------------------------------------------------------------------
create or replace function public.limpiar_cobros_desconfirmados(p_job_id text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  with confirmados as materialized (
    select unnest(m.comprobante_ids) as comprobante_id
      from public.matches_conciliacion m
     where m.job_id = p_job_id
       and m.estado_revision in ('auto', 'aceptado', 'modificado')
  )
  delete from public.aplicaciones_cobro a
   where a.job_id = p_job_id
     and not exists (
       select 1 from confirmados c where c.comprobante_id = a.comprobante_id
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.limpiar_cobros_desconfirmados(text) is
  'Retira los cobros de los pares que dejaron de estar confirmados. Toca solo '
  'lo que cambió: borrar y rehacer 447.795 aplicaciones tarda 90 s.';

revoke all on function public.limpiar_cobros_desconfirmados(text) from public, anon, authenticated;
grant execute on function public.limpiar_cobros_desconfirmados(text) to service_role;


-- ============================================================================
-- 0026_matches_para_reportes.sql — Reportes y aprendizaje sobre los pares en
-- tabla (parte B, flanco pendiente)
--
-- Los reportes y el módulo de aprendizaje leen `resultado.matches`. En modo
-- tabla ese array queda vacío tras la absorción, así que verían el desglose por
-- método a cero y el pool de ejemplos vacío — justo en la empresa con medio
-- millón de partidas, que es la que más tiene que enseñar.
--
-- Los dos necesitan cosas distintas, y por eso son dos funciones:
--
--   · el aprendizaje quiere los pares que REVISÓ UNA PERSONA. Son pocos por
--     definición —nadie revisa 447.795 a mano— así que se devuelven enteros.
--   · los reportes quieren el DESGLOSE. Traer medio millón de filas para
--     contarlas en Node es exactamente lo que la parte B vino a eliminar, así
--     que se cuentan aquí.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- matches_revisados(jobs) — los pares con decisión humana
--
-- `auto` queda fuera: nadie lo miró, y usarlo como ejemplo de aprendizaje sería
-- enseñarle a la IA un criterio que ninguna persona aplicó. Es la misma razón
-- por la que los `auto` no entran en la tasa de acierto (ver CLAUDE.md §
-- "¿de verdad está aprendiendo?").
-- ---------------------------------------------------------------------------
create or replace function public.matches_revisados(p_job_ids text[])
returns table (
  job_id               text,
  comprobante_ids      uuid[],
  movimiento_ids       uuid[],
  metodo               text,
  estado_revision      text,
  confianza            numeric,
  categoria_diferencia text,
  diferencia_monto     numeric,
  decisiones           jsonb,
  excluido_aprendizaje boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.job_id, m.comprobante_ids, m.movimiento_ids, m.metodo, m.estado_revision,
    m.confianza, m.categoria_diferencia, m.diferencia_monto, m.decisiones,
    m.excluido_aprendizaje
  from public.matches_conciliacion m
  where m.job_id = any (p_job_ids)
    and m.estado_revision <> 'auto';
$$;

-- ---------------------------------------------------------------------------
-- conteo_matches(jobs) — el desglose, contado en la base
--
-- Una fila por (job, método, categoría, estado). Son unas pocas decenas por
-- job aunque detrás haya medio millón de pares.
-- ---------------------------------------------------------------------------
create or replace function public.conteo_matches(p_job_ids text[])
returns table (
  job_id               text,
  metodo               text,
  categoria_diferencia text,
  estado_revision      text,
  n                    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select m.job_id, m.metodo, m.categoria_diferencia, m.estado_revision, count(*)
    from public.matches_conciliacion m
   where m.job_id = any (p_job_ids)
   group by m.job_id, m.metodo, m.categoria_diferencia, m.estado_revision;
$$;

comment on function public.matches_revisados(text[]) is
  'Pares con decisión humana. Los `auto` quedan fuera: nadie los miró.';
comment on function public.conteo_matches(text[]) is
  'Desglose por método/categoría/estado, contado en la base.';

-- Las invoca el backend con service_role. El acotado por empresa lo hace quien
-- llama, que solo pasa jobs de la empresa del usuario (leídos con RLS).
revoke all on function public.matches_revisados(text[]) from public, anon, authenticated;
revoke all on function public.conteo_matches(text[]) from public, anon, authenticated;
grant execute on function public.matches_revisados(text[]) to service_role;
grant execute on function public.conteo_matches(text[]) to service_role;


-- ============================================================================
-- 0027_resumen_comprobantes_periodo.sql — El contador del wizard, en la base
--
-- El Paso 1 dice cuántos comprobantes hay en el período elegido. Lo consultaba
-- el NAVEGADOR con el cliente de RLS y sin filtrar por empresa, confiando en
-- que la política acotara. Con 452.309 comprobantes eso no termina: la política
-- es `es_miembro(empresa_id)`, una función sobre una COLUMNA que Postgres
-- evalúa fila a fila, y la consulta se pasa del `statement_timeout` de 8 s.
--
-- El resultado en pantalla era el peor posible:
--
--     Comprobantes del período
--     0 registros · S/ 0.00
--     No hay comprobantes en este período.
--
-- O sea, una respuesta tranquilizadora y falsa sobre datos que sí estaban. El
-- usuario no tiene forma de distinguir "no hay" de "no se pudo contar".
--
-- Mismo remedio que `resumen_saldos` (0021): la pertenencia se resuelve UNA vez
-- y el filtro por `empresa_id` es una igualdad indexable.
-- ============================================================================

create or replace function public.resumen_comprobantes_periodo(
  p_desde date,
  p_hasta date
)
returns table (
  registros      bigint,
  suma           numeric,
  total_cargados bigint,
  ya_cobrados    bigint
)
language sql
stable
-- ⚠️ SECURITY DEFINER: RLS no aplica dentro, así que el `empresa_id in (...)`
-- de cada consulta ES el control de acceso. La empresa sale siempre de
-- `auth.uid()`; esta función NUNCA acepta un empresa_id por parámetro.
security definer
set search_path = public
as $$
  -- ⚠️ UN SOLO recorrido con `filter`, no cuatro subconsultas.
  --
  -- La primera versión hacía cuatro `select` independientes sobre la misma
  -- tabla: 6,19 s con 452.309 comprobantes, demasiado cerca de los 8 s del
  -- `statement_timeout` para dejarlo así. Los mismos cuatro números salen de
  -- una pasada agregando con `filter`.
  with mias as (
    select ue.empresa_id
      from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  )
  select
    -- Lo que entraría a conciliar: mismo criterio que
    -- `getComprobantesCanonicos` y que la capa exacta en SQL.
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
    ),
    -- Suma EXACTA, no la de las primeras mil filas. Antes salía de las que
    -- alcanzara a traer PostgREST y la pantalla avisaba de que era parcial.
    coalesce(sum(abs(c.monto)) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
    ), 0),
    -- Todo lo cargado, sin filtrar por fecha: si alguien tiene 5 comprobantes
    -- y en el período caen 2, decir solo "2" parece que se perdieron los otros.
    count(*),
    -- Del período pero ya saldados: se dejan fuera y hay que decirlo, o
    -- parecerá que faltan.
    count(*) filter (
      where c.fecha between p_desde and p_hasta and c.estado = 'cobrado'
    )
  from public.comprobantes c
  -- ⚠️ FRONTERA DE SEGURIDAD (ver la nota de SECURITY DEFINER).
  where c.empresa_id in (select empresa_id from mias);
$$;

comment on function public.resumen_comprobantes_periodo(date, date) is
  'Conteos y suma de comprobantes de un período para el Paso 1 del wizard. '
  'Cuenta en la base: con medio millón de filas, hacerlo por PostgREST con RLS '
  'se pasa del statement_timeout y la pantalla dice "0".';

revoke all on function public.resumen_comprobantes_periodo(date, date)
  from public, anon;
grant execute on function public.resumen_comprobantes_periodo(date, date)
  to authenticated, service_role;

-- Apoya el filtro por período, que es el recorrido natural del wizard.
create index if not exists idx_comprobantes_empresa_fecha
  on public.comprobantes (empresa_id, fecha);


-- ============================================================================
-- 0028_conciliar_exacta_por_bloques.sql — La capa exacta, en trozos que caben
--
-- `conciliar_exacta` tarda ~32 s con junio completo (452.177 × 450.999). Medido
-- en psql eso parecía aceptable; por PostgREST no lo es, porque el rol con el
-- que se conecta lleva `statement_timeout = 8s` y la llamada se cancela entera:
--
--     No se pudo correr la capa exacta: canceling statement due to statement timeout
--
-- ⚠️ Y NO se puede ampliar desde dentro. `set local statement_timeout` en el
-- cuerpo de la función no rearma el temporizador de la sentencia que ya está en
-- marcha — probado: se cancela igual, a los 8,3 s.
--
-- ── Por qué se trocea por REFERENCIA y no por fecha ────────────────────────
--
-- Trocear por días sería lo intuitivo y arruinaría el resultado: un asiento del
-- 30/06 puede cobrarse el 28, y el corte diario parte ese par. Es exactamente
-- la diferencia entre el 88,44 % de un día y el 99,03 % del mes.
--
-- Pero un par SIEMPRE comparte referencia. Así que repartiendo las referencias
-- en bloques por su hash, ningún par queda partido: los dos lados de cada
-- emparejamiento caen en el mismo bloque, sea cual sea su fecha. El resultado es
-- idéntico al de una sola pasada.
-- ============================================================================

-- La versión de dos argumentos se sustituye por la de tres. `create or replace`
-- con otra firma deja viva la anterior y las llamadas quedan ambiguas.
drop function if exists public.conciliar_exacta(text);

create or replace function public.conciliar_exacta(
  p_job_id  text,
  p_bloque  integer default 0,
  p_bloques integer default 1
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
  v_pares bigint;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;
  if v_job.lote_extracto_id is null then
    raise exception 'El job % no tiene extracto cargado en tabla', p_job_id
      using errcode = 'check_violation';
  end if;

  with comps as (
    select
      c.id,
      -- Céntimos CON SIGNO, igual que `01_exacta.js`: en valor absoluto un
      -- cobro casaría con un pago del mismo importe.
      round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100)::bigint as cent,
      upper(regexp_replace(coalesce(c.referencia_externa, c.serie_numero, ''), '[^A-Za-z0-9]', '', 'g')) as ref
    from public.comprobantes c
    where c.empresa_id = v_job.empresa_id
      and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
      and c.estado not in ('cobrado', 'anulado')
  ),
  movs as (
    select
      m.id,
      round(m.monto * 100)::bigint as cent,
      upper(regexp_replace(coalesce(m.referencia_banco, ''), '[^A-Za-z0-9]', '', 'g')) as ref
    from public.movimientos_extracto m
    where m.lote_id = v_job.lote_extracto_id
  ),
  -- El bloque se decide por la REFERENCIA, así que los dos lados de un par
  -- caen siempre juntos. `abs(hashtext(...))` reparte de forma pareja.
  ci as (
    select id, cent, ref,
           row_number() over (partition by cent, ref order by id) as n
      from comps
     where ref <> ''
       and mod(abs(hashtext(ref)), p_bloques) = p_bloque
  ),
  mi as (
    select id, cent, ref,
           row_number() over (partition by cent, ref order by id) as n
      from movs
     where ref <> ''
       and mod(abs(hashtext(ref)), p_bloques) = p_bloque
  ),
  pares as (
    insert into public.matches_conciliacion (
      job_id, empresa_id, comprobante_ids, movimiento_ids,
      metodo, estado_revision, diferencia_monto
    )
    select
      p_job_id, v_job.empresa_id, array[ci.id], array[mi.id],
      'exacta',
      -- `auto` como en el motor: exigir un clic humano en cada match exacto
      -- vaciaría de sentido el producto. Y `auto` descuenta saldo.
      'auto',
      0
    from ci join mi on ci.cent = mi.cent and ci.ref = mi.ref and ci.n = mi.n
    returning 1
  )
  select count(*) into v_pares from pares;

  return v_pares;
end;
$$;

comment on function public.conciliar_exacta(text, integer, integer) is
  'Capa exacta (monto + referencia) como JOIN, troceada por hash de la '
  'referencia para caber en el statement_timeout. Trocear por FECHA partiría '
  'los pares cuyo asiento y cobro caen en días distintos.';

revoke all on function public.conciliar_exacta(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.conciliar_exacta(text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- totales_conciliacion(job) — cuántas partidas hay a cada lado
--
-- Antes lo devolvía `conciliar_exacta`. Al trocearla habría que contarlas en
-- cada bloque, que es trabajo repetido; aquí se piden una vez.
-- ---------------------------------------------------------------------------
create or replace function public.totales_conciliacion(p_job_id text)
returns table (internos bigint, movimientos bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;

  return query
  select
    (select count(*) from public.comprobantes c
      where c.empresa_id = v_job.empresa_id
        and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
        and c.estado not in ('cobrado', 'anulado')),
    (select count(*) from public.movimientos_extracto m
      where m.lote_id = v_job.lote_extracto_id);
end;
$$;

revoke all on function public.totales_conciliacion(text) from public, anon, authenticated;
grant execute on function public.totales_conciliacion(text) to service_role;

drop function if exists public._prueba_timeout();


-- ============================================================================
-- 0029_referencia_normalizada.sql — La referencia, ya normalizada en la fila
--
-- La capa exacta casa por `upper(regexp_replace(referencia, '[^A-Za-z0-9]',''))`
-- y lo calculaba EN CADA CONCILIACIÓN, para las 903.176 partidas. Ese trabajo
-- de cadenas es el grueso de los 32 s que tardaba, y no se puede indexar: el
-- planificador tiene que leer y transformar cada fila antes de poder juntar
-- nada.
--
-- Trocear no lo arregla. Se intentó repartir por bloques de hash de la
-- referencia —correcto, porque un par siempre comparte referencia y así ninguno
-- queda partido— pero cada bloque **vuelve a recorrer y normalizar las 900.000
-- filas** y solo se reduce el join: 8 bloques de ~8 s cada uno, la mayoría
-- cancelados por el `statement_timeout`. Trocear reparte el join, no el escaneo.
--
-- Aquí la normalización se hace UNA vez, al insertar, y queda en una columna
-- indexable. El coste se mueve de "cada conciliación" a "cada fila, una vez".
--
-- ⚠️ La expresión tiene que ser EXACTAMENTE la de `n8n/01_exacta.js`
-- (`normRef`), que es quien concilia el residuo. Si divergieran, un par casaría
-- en SQL y no en el motor, o al revés, y la diferencia sería invisible.
-- ============================================================================

alter table public.comprobantes
  add column if not exists ref_norm text
  generated always as (
    upper(regexp_replace(
      coalesce(referencia_externa, serie_numero, ''), '[^A-Za-z0-9]', '', 'g'
    ))
  ) stored;

alter table public.movimientos_extracto
  add column if not exists ref_norm text
  generated always as (
    upper(regexp_replace(coalesce(referencia_banco, ''), '[^A-Za-z0-9]', '', 'g'))
  ) stored;

-- Índices parciales: las filas sin referencia no participan del emparejamiento
-- por código, y en una empresa que factura sin número son la mayoría.
create index if not exists idx_comprobantes_ref_norm
  on public.comprobantes (empresa_id, ref_norm)
  where ref_norm <> '';

create index if not exists idx_mov_extracto_ref_norm
  on public.movimientos_extracto (lote_id, ref_norm)
  where ref_norm <> '';

comment on column public.comprobantes.ref_norm is
  'Referencia normalizada para emparejar (mayúsculas, sin separadores). Misma '
  'expresión que `normRef` en n8n/01_exacta.js.';
comment on column public.movimientos_extracto.ref_norm is
  'Referencia del banco normalizada. Ver comprobantes.ref_norm.';

-- ---------------------------------------------------------------------------
-- La capa exacta, ahora sobre columnas ya normalizadas.
--
-- Se conservan los bloques: siguen siendo la red por si un cliente aún mayor
-- vuelve a rozar el techo, y con `p_bloques = 1` (el valor por defecto) es una
-- sola pasada.
-- ---------------------------------------------------------------------------
create or replace function public.conciliar_exacta(
  p_job_id  text,
  p_bloque  integer default 0,
  p_bloques integer default 1
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
  v_pares bigint;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;
  if v_job.lote_extracto_id is null then
    raise exception 'El job % no tiene extracto cargado en tabla', p_job_id
      using errcode = 'check_violation';
  end if;

  with ci as (
    select
      c.id,
      -- Céntimos CON SIGNO, igual que `01_exacta.js`: en valor absoluto un
      -- cobro casaría con un pago del mismo importe.
      round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100)::bigint as cent,
      c.ref_norm as ref,
      row_number() over (
        partition by round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100), c.ref_norm
        order by c.id
      ) as n
    from public.comprobantes c
    where c.empresa_id = v_job.empresa_id
      and c.fecha between v_job.periodo_desde and v_job.periodo_hasta
      and c.estado not in ('cobrado', 'anulado')
      and c.ref_norm <> ''
      and (p_bloques = 1 or mod(abs(hashtext(c.ref_norm)), p_bloques) = p_bloque)
  ),
  mi as (
    select
      m.id,
      round(m.monto * 100)::bigint as cent,
      m.ref_norm as ref,
      row_number() over (
        partition by round(m.monto * 100), m.ref_norm order by m.id
      ) as n
    from public.movimientos_extracto m
    where m.lote_id = v_job.lote_extracto_id
      and m.ref_norm <> ''
      and (p_bloques = 1 or mod(abs(hashtext(m.ref_norm)), p_bloques) = p_bloque)
  ),
  pares as (
    insert into public.matches_conciliacion (
      job_id, empresa_id, comprobante_ids, movimiento_ids,
      metodo, estado_revision, diferencia_monto
    )
    select
      p_job_id, v_job.empresa_id, array[ci.id], array[mi.id],
      'exacta', 'auto', 0
    from ci join mi on ci.cent = mi.cent and ci.ref = mi.ref and ci.n = mi.n
    returning 1
  )
  select count(*) into v_pares from pares;

  return v_pares;
end;
$$;

revoke all on function public.conciliar_exacta(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.conciliar_exacta(text, integer, integer)
  to service_role;


-- ============================================================================
-- 0030_analizar_tras_carga.sql — Estadísticas frescas después de cargar medio
-- millón de filas
--
-- El planificador de Postgres decide con estadísticas. Cuando una tabla cambia
-- de tamaño de golpe —una importación de 450.999 movimientos, o una migración
-- que la reescribe— esas estadísticas se quedan viejas y elige planes malos
-- para la MISMA consulta que antes iba bien.
--
-- Pasó, y el síntoma no apuntaba a esto: `residuo_internos` tardaba 1,68 s
-- medido, y después de que la `0029` reescribiera `comprobantes` para añadir
-- `ref_norm` empezó a pasarse del `statement_timeout` de 8 s. Nada en el código
-- había cambiado. Un `vacuum analyze` lo devolvió a 1,5 s.
--
-- Autovacuum acaba haciéndolo solo, pero tarda — y la ventana en la que no lo
-- ha hecho es exactamente cuando alguien concilia lo que acaba de importar.
--
-- ⚠️ Va como función SECURITY DEFINER porque `ANALYZE` exige ser dueño de la
-- tabla, y `service_role` no lo es (lo es `supabase_admin`). Sin esto el
-- backend no puede pedirlo.
-- ============================================================================

create or replace function public.analizar_tablas_conciliacion()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  analyze public.comprobantes;
  analyze public.movimientos_extracto;
  analyze public.matches_conciliacion;
end;
$$;

comment on function public.analizar_tablas_conciliacion() is
  'Refresca las estadísticas de las tablas que recorre la conciliación. Se '
  'llama tras una importación grande: sin ello el planificador usa los tamaños '
  'de antes y elige planes que se pasan del statement_timeout.';

revoke all on function public.analizar_tablas_conciliacion() from public, anon, authenticated;
grant execute on function public.analizar_tablas_conciliacion() to service_role;

-- Y de paso, ahora: la 0029 reescribió `comprobantes` y la dejó sin analizar.
analyze public.comprobantes;
analyze public.movimientos_extracto;


-- ============================================================================
-- 0031_analizar_aplicaciones.sql — `aplicaciones_cobro` también necesita
-- estadísticas frescas
--
-- Aprobar una conciliación de medio millón de pares llena `aplicaciones_cobro`
-- de 0 a 447.795 filas en lotes. El anti-join que decide "lo ya aplicado no se
-- vuelve a mirar" consulta esa misma tabla mientras crece: con las estadísticas
-- de cuando estaba vacía, el planificador elige un plan pensado para cero filas
-- y se pasa del `statement_timeout` de 8 s.
--
-- Ocurrió: la aprobación escribió 10.000 cobros y el tercer lote se canceló.
-- Minutos después, el MISMO lote tardaba 3,2 s — autovacuum ya había analizado.
-- Es la misma carrera que en `matches_conciliacion`, y por eso esa tabla entra
-- ahora en la lista.
-- ============================================================================

create or replace function public.analizar_tablas_conciliacion()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  analyze public.comprobantes;
  analyze public.movimientos_extracto;
  analyze public.matches_conciliacion;
  -- Crece durante la propia aprobación, que es cuando más importa.
  analyze public.aplicaciones_cobro;
end;
$$;

analyze public.aplicaciones_cobro;


-- ============================================================================
-- 0032_resumen_ejecutivo.sql — Las cifras que mira quien decide
--
-- No es "otro reporte". Los reportes existentes responden "¿cómo fue la
-- conciliación?"; esto responde "¿cómo está la empresa?", que es otra pregunta
-- y la hace otra persona.
--
-- ⚠️ DOS RELOJES, y confundirlos hace mentir al número:
--
--   · Lo CONCILIADO pertenece a un período: cuánto se procesó en junio.
--   · Lo que te DEBEN es una foto de HOY: no tiene período, tiene antigüedad.
--
-- Un "por cobrar de junio" no significa nada — o son las facturas emitidas en
-- junio (que quizá ya se cobraron) o el saldo vivo (que no es de junio). La
-- función devuelve las dos cosas por separado y la pantalla lo dice con todas
-- las letras.
--
-- Se agrega EN LA BASE por lo de siempre: con 452.309 comprobantes, traerlos
-- para sumarlos en Node es lo que la parte B vino a eliminar.
-- ============================================================================

create or replace function public.resumen_ejecutivo(
  p_desde date,
  p_hasta date,
  p_hoy   date default current_date
)
returns table (
  -- ── Del período elegido ──────────────────────────────────────────────────
  conciliaciones        bigint,
  sin_aprobar           bigint,
  partidas              bigint,
  partidas_conciliadas  bigint,
  cobrado               numeric,
  pagado                numeric,
  diferencia_cuadre     numeric,
  -- ── Foto de hoy ──────────────────────────────────────────────────────────
  por_cobrar            numeric,
  por_cobrar_vencido    numeric,
  por_cobrar_docs       bigint,
  por_pagar             numeric,
  por_pagar_vencido     numeric,
  por_pagar_docs        bigint
)
language sql
stable
-- ⚠️ SECURITY DEFINER: RLS no aplica dentro, así que los `empresa_id in (...)`
-- de abajo SON el control de acceso. La empresa sale siempre de `auth.uid()`;
-- esta función nunca acepta un empresa_id por parámetro.
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  -- Solo lo APROBADO cuenta. Un borrador con decisiones confirmadas no mueve un
  -- céntimo, y presentarlo aquí como si contara sería el peor error posible en
  -- una pantalla de dirección.
  jobs as (
    select j.id, j.resultado
      from public.jobs_conciliacion j
     where j.empresa_id in (select empresa_id from mias)
       and j.estado = 'completado'
       and j.estado_contable = 'aprobada'
       and j.periodo_desde <= p_hasta
       and j.periodo_hasta >= p_desde
  ),
  -- Terminadas y sin aprobar: no suman, pero hay que decir que existen. Si no,
  -- parecería que ese trabajo se perdió.
  pendientes_aprobar as (
    select count(*) as n
      from public.jobs_conciliacion j
     where j.empresa_id in (select empresa_id from mias)
       and j.estado = 'completado'
       and j.estado_contable in ('borrador', 'en_proceso', 'observada')
       and j.periodo_desde <= p_hasta
       and j.periodo_hasta >= p_desde
  ),
  -- El dinero que de verdad se movió, por tipo de comprobante.
  movido as (
    select
      coalesce(sum(a.monto_aplicado) filter (where c.tipo <> 'pago'), 0) as cobrado,
      coalesce(sum(a.monto_aplicado) filter (where c.tipo = 'pago'), 0) as pagado
    from public.aplicaciones_cobro a
    join jobs on jobs.id = a.job_id
    join public.comprobantes c on c.id = a.comprobante_id
  ),
  -- Saldo vivo HOY, con su antigüedad. Mismo criterio que Por cobrar / Por
  -- pagar (`cuentaComoPendiente` en src/lib/aging.ts).
  saldos as (
    select
      coalesce(sum(c.saldo) filter (where c.tipo <> 'pago'), 0) as cobrar,
      coalesce(sum(c.saldo) filter (
        where c.tipo <> 'pago' and coalesce(c.fecha_vencimiento, c.fecha) < p_hoy
      ), 0) as cobrar_vencido,
      count(*) filter (where c.tipo <> 'pago') as cobrar_docs,
      coalesce(sum(c.saldo) filter (where c.tipo = 'pago'), 0) as pagar,
      coalesce(sum(c.saldo) filter (
        where c.tipo = 'pago' and coalesce(c.fecha_vencimiento, c.fecha) < p_hoy
      ), 0) as pagar_vencido,
      count(*) filter (where c.tipo = 'pago') as pagar_docs
    from public.comprobantes c
    where c.empresa_id in (select empresa_id from mias)
      and c.estado not in ('cobrado', 'anulado')
      and c.saldo > 0.005
  )
  select
    (select count(*) from jobs),
    (select n from pendientes_aprobar),
    coalesce((select sum((j.resultado->'resumen'->>'total_internos')::bigint
                       + (j.resultado->'resumen'->>'total_bancarios')::bigint) from jobs j), 0),
    coalesce((select sum((j.resultado->'resumen'->>'total_internos')::bigint
                       + (j.resultado->'resumen'->>'total_bancarios')::bigint
                       - (j.resultado->'resumen'->>'sin_conciliar_internos')::bigint
                       - (j.resultado->'resumen'->>'sin_conciliar_bancarios')::bigint) from jobs j), 0),
    (select cobrado from movido),
    (select pagado from movido),
    -- La suma de lo que quedó SIN EXPLICAR en cada cuadre. Es la cifra que le
    -- dice a un gerente si puede fiarse de sus saldos.
    coalesce((select sum((j.resultado->'cuadre'->>'diferencia')::numeric) from jobs j), 0),
    (select cobrar from saldos),
    (select cobrar_vencido from saldos),
    (select cobrar_docs from saldos),
    (select pagar from saldos),
    (select pagar_vencido from saldos),
    (select pagar_docs from saldos);
$$;

comment on function public.resumen_ejecutivo(date, date, date) is
  'Cifras consolidadas para dirección. Lo conciliado es del período; lo que te '
  'deben es una foto de hoy — son dos relojes distintos y la pantalla lo dice.';

revoke all on function public.resumen_ejecutivo(date, date, date) from public, anon;
grant execute on function public.resumen_ejecutivo(date, date, date)
  to authenticated, service_role;


-- ============================================================================
-- 0033_partidas_del_job.sql — Cuántas partidas cubrió una conciliación
--
-- ⚠️ El total de una conciliación NO puede depender del estado actual de sus
-- comprobantes, y así estaba.
--
-- `totales_conciliacion` cuenta los comprobantes del período que no están
-- cobrados ni anulados — correcto para decidir qué conciliar, y equivocado para
-- decir qué se concilió. Al aprobar, 447.795 pasan a `cobrado` y ese total se
-- desploma de 452.177 a 4.382. El resumen se degradaba solo, y como la pantalla
-- recalcula en cada carga, el número empeoraba cada vez que alguien lo miraba.
--
-- Aquí se cuenta lo que la conciliación TOCÓ, que no cambia después: las
-- partidas que entraron en algún par. Sumado a las que quedaron sin conciliar
-- da el total del período, y es estable para siempre.
-- ============================================================================

create or replace function public.partidas_conciliadas_job(p_job_id text)
returns table (internos bigint, movimientos bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    -- `array_length` y no `count(*)`: un match puede ser 1:N, así que un par no
    -- es una partida — son las que lleva dentro.
    coalesce(sum(coalesce(array_length(m.comprobante_ids, 1), 0)), 0),
    coalesce(sum(coalesce(array_length(m.movimiento_ids, 1), 0)), 0)
  from public.matches_conciliacion m
  where m.job_id = p_job_id
    -- Un par rechazado no concilió nada: sus partidas cuentan como sueltas.
    and m.estado_revision <> 'rechazado';
$$;

comment on function public.partidas_conciliadas_job(text) is
  'Partidas que entraron en algún par. Estable: no cambia cuando los '
  'comprobantes pasan a cobrado.';

revoke all on function public.partidas_conciliadas_job(text) from public, anon, authenticated;
grant execute on function public.partidas_conciliadas_job(text) to service_role;


-- ============================================================================
-- 0034_lotes_importacion.sql — Las cargas hechas, para poder deshacer una
--
-- Cada importación marca sus filas con `lote_importacion`, y `deshacerImportacion`
-- ya sabía borrar una sin tocar las demás. Lo que faltaba era **verlas**: el
-- botón de deshacer solo existía en el momento de subir, dentro del estado del
-- componente. Al recargar la página desaparecía y la única salida era "Empezar
-- de cero", que borra todo y exige escribir una palabra.
--
-- O sea: quitar la última carga para volver a subirla —lo más normal del mundo
-- al preparar datos— obligaba a borrarlo TODO. Aquí se listan para que cada una
-- tenga su propia salida.
--
-- Se agrupa en la base porque PostgREST no sabe agrupar, y contar por lote
-- desde la aplicación exigiría traerse las 452.309 filas.
-- ============================================================================

create or replace function public.lotes_importacion()
returns table (lote uuid, filas bigint, cargado timestamptz)
language sql
stable
-- ⚠️ SECURITY DEFINER: el `empresa_id in (...)` de abajo ES el control de
-- acceso. La empresa sale de `auth.uid()`, nunca de un parámetro.
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  )
  select c.lote_importacion, count(*), min(c.created_at)
    from public.comprobantes c
   where c.empresa_id in (select empresa_id from mias)
     and c.lote_importacion is not null
   group by c.lote_importacion
   order by min(c.created_at) desc
   limit 50;
$$;

comment on function public.lotes_importacion() is
  'Cargas de comprobantes hechas, para poder deshacer una sin borrarlo todo.';

revoke all on function public.lotes_importacion() from public, anon;
grant execute on function public.lotes_importacion() to authenticated, service_role;

-- Sin este índice, agrupar por lote recorre la tabla entera.
create index if not exists idx_comprobantes_lote
  on public.comprobantes (empresa_id, lote_importacion)
  where lote_importacion is not null;


-- ============================================================================
-- 0035_borrar_comprobantes_por_lotes.sql — Borrar medio millón de comprobantes
-- sin pasarse del statement_timeout
--
-- "Quitar esta carga" fallaba con «No se pudo deshacer la importación». El
-- borrado es UNA sentencia sobre 452.309 filas: ~13 s medidos, contra los 8 s
-- del rol con el que se conecta PostgREST. Se cancelaba entera y no borraba
-- nada.
--
-- Mismo remedio que en todo lo demás a este volumen: por lotes, y quien llama
-- repite hasta que devuelva 0.
--
-- ⚠️ Lo que tiene cobros aplicados NO se borra. Se iría en cascada y dejaría un
-- agujero en una conciliación aprobada, que seguiría diciendo que esa factura
-- se cobró. Lo conciliado no se limpia: se ANULA (ver 0016).
-- ============================================================================

create or replace function public.borrar_comprobantes(
  p_lote   uuid default null,
  p_limite integer default 20000
)
returns bigint
language plpgsql
-- ⚠️ SECURITY DEFINER: el `empresa_id in (...)` ES el control de acceso, y la
-- empresa sale de `auth.uid()`. Se llama con el cliente de SESIÓN, nunca con
-- `admin` — con `admin` no hay usuario y no borraría nada, en silencio.
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  with mias as (
    select ue.empresa_id from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  candidatos as (
    select c.id
      from public.comprobantes c
     where c.empresa_id in (select empresa_id from mias)
       and (p_lote is null or c.lote_importacion = p_lote)
       -- Protegidos: los que ya entraron en una conciliación.
       and not exists (
         select 1 from public.aplicaciones_cobro a where a.comprobante_id = c.id
       )
     limit p_limite
  )
  delete from public.comprobantes c
   using candidatos k
   where c.id = k.id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.borrar_comprobantes(uuid, integer) is
  'Borra hasta p_limite comprobantes de la empresa del usuario, opcionalmente '
  'de un lote. Salta los que tienen cobros aplicados. Por lotes: una sola '
  'sentencia sobre medio millón de filas se pasa del statement_timeout.';

-- Cuántos quedan protegidos, para poder informarlo al terminar.
create or replace function public.comprobantes_protegidos(p_lote uuid default null)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  )
  select count(*)
    from public.comprobantes c
   where c.empresa_id in (select empresa_id from mias)
     and (p_lote is null or c.lote_importacion = p_lote)
     and exists (
       select 1 from public.aplicaciones_cobro a where a.comprobante_id = c.id
     );
$$;

revoke all on function public.borrar_comprobantes(uuid, integer) from public, anon;
revoke all on function public.comprobantes_protegidos(uuid) from public, anon;
grant execute on function public.borrar_comprobantes(uuid, integer) to authenticated, service_role;
grant execute on function public.comprobantes_protegidos(uuid) to authenticated, service_role;


-- ============================================================================
-- 0036_borrar_comprobantes_periodo.sql — Quitar los comprobantes de un período
--
-- El Paso 1 del wizard muestra «Comprobantes del período · N registros» y hasta
-- ahora la única forma de deshacer esa carga era irse a /comprobantes. Si
-- alguien subió el archivo equivocado, tenía que abandonar el flujo a medias
-- para arreglarlo y volver a empezar.
--
-- ⚠️ Se borra POR PERÍODO y no "la última carga", aunque suene menos natural.
-- La tarjeta enseña un número concreto; si el botón quitara el último lote
-- podría llevarse otra cosa —o solo una parte— y dejar la tarjeta con un número
-- que el usuario no esperaba. Lo que se ve es lo que se quita.
-- ============================================================================

-- La firma de dos argumentos se sustituye por la de cuatro. `create or replace`
-- con otra firma deja viva la anterior y, con parámetros por defecto, las
-- llamadas quedan ambiguas (ya pasó con `aplicar_cobros_exactos`).
drop function if exists public.borrar_comprobantes(uuid, integer);

create or replace function public.borrar_comprobantes(
  p_lote   uuid default null,
  p_limite integer default 20000,
  p_desde  date default null,
  p_hasta  date default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  with mias as (
    select ue.empresa_id from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  candidatos as (
    select c.id
      from public.comprobantes c
     where c.empresa_id in (select empresa_id from mias)
       and (p_lote is null or c.lote_importacion = p_lote)
       and (p_desde is null or c.fecha >= p_desde)
       and (p_hasta is null or c.fecha <= p_hasta)
       -- Lo que ya entró en una conciliación no se borra: se ANULA (ver 0016).
       and not exists (
         select 1 from public.aplicaciones_cobro a where a.comprobante_id = c.id
       )
     limit p_limite
  )
  delete from public.comprobantes c
   using candidatos k
   where c.id = k.id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

drop function if exists public.comprobantes_protegidos(uuid);

create or replace function public.comprobantes_protegidos(
  p_lote  uuid default null,
  p_desde date default null,
  p_hasta date default null
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  )
  select count(*)
    from public.comprobantes c
   where c.empresa_id in (select empresa_id from mias)
     and (p_lote is null or c.lote_importacion = p_lote)
     and (p_desde is null or c.fecha >= p_desde)
     and (p_hasta is null or c.fecha <= p_hasta)
     and exists (
       select 1 from public.aplicaciones_cobro a where a.comprobante_id = c.id
     );
$$;

comment on function public.borrar_comprobantes(uuid, integer, date, date) is
  'Borra hasta p_limite comprobantes de la empresa del usuario, por lote o por '
  'rango de fechas. Salta los que tienen cobros aplicados.';

revoke all on function public.borrar_comprobantes(uuid, integer, date, date) from public, anon;
revoke all on function public.comprobantes_protegidos(uuid, date, date) from public, anon;
grant execute on function public.borrar_comprobantes(uuid, integer, date, date) to authenticated, service_role;
grant execute on function public.comprobantes_protegidos(uuid, date, date) to authenticated, service_role;


-- ============================================================================
-- 0037_diagnostico_previo.sql — Comprobar la conciliación ANTES de correrla
--
-- Una conciliación de 450.999 movimientos terminó en 0 % porque la columna
-- "Recibos" del extracto no se mapeó a *referencia*. Nada lo dijo hasta ver el
-- resultado, media hora después. Hay un aviso ámbar en el Paso 2, pero avisa de
-- una CAUSA sin medir su CONSECUENCIA — y un aviso que no se sabe ponderar se
-- despacha sin leer, sobre todo cuando dice, con razón, que se puede conciliar
-- igual.
--
-- Al llegar al Paso 3 los dos lados ya están en la base (el Paso 2 importa el
-- extracto y devuelve `lote_id`) y el motor todavía no ha corrido. Ahí cabe una
-- comprobación real en vez de una heurística sobre lo que se ve en pantalla.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) La regla de emparejamiento exacto, extraída a UNA función
--
-- Estaba dentro de `conciliar_exacta`. Si el diagnóstico la copiara, tendríamos
-- dos definiciones del mismo emparejamiento y nada que impidiera que
-- divergieran: el Paso 3 prometería una cobertura que el motor luego no da, o
-- al revés. Es el mismo riesgo que documenta la 0029 con `ref_norm` (tiene que
-- ser EXACTAMENTE `normRef` de n8n/01_exacta.js), y aquí se puede evitar del
-- todo porque las dos consultas viven en Postgres.
--
-- ⚠️ Deliberadamente SIN `security definer` y SIN `set search_path`: las dos
-- cosas impiden que el planificador la incruste (inline) en la consulta que la
-- llama, y esta función está en el camino caliente que empareja 450.000 filas.
-- Todo va calificado con `public.` para que el search_path no importe, y el
-- acceso queda cerrado con el `revoke` del final: solo se invoca desde las dos
-- funciones `definer` de abajo.
--
-- ⚠️ Al desplegar sobre el cliente grande, VOLVER A MEDIR `conciliar_exacta`.
-- Si el tiempo empeorase, la definición anterior (con el cuerpo en línea) está
-- en 0029 y se puede restaurar sin tocar nada más.
-- ---------------------------------------------------------------------------
create or replace function public.pares_exactos(
  p_empresa_id uuid,
  p_lote_id    uuid,
  p_desde      date,
  p_hasta      date,
  p_bloque     integer default 0,
  p_bloques    integer default 1
)
returns table (comprobante_id uuid, movimiento_id uuid)
language sql
stable
as $$
  with ci as (
    select
      c.id,
      -- Céntimos CON SIGNO, igual que `01_exacta.js`: en valor absoluto un
      -- cobro casaría con un pago del mismo importe.
      round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100)::bigint as cent,
      c.ref_norm as ref,
      -- row_number() en los dos lados, casando por número: con cientos de
      -- recibos del mismo importe y la misma referencia, un join a secas da el
      -- producto cartesiano (300 x 300 = 90.000 pares en vez de 300).
      row_number() over (
        partition by round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100), c.ref_norm
        order by c.id
      ) as n
    from public.comprobantes c
    where c.empresa_id = p_empresa_id
      and c.fecha between p_desde and p_hasta
      and c.estado not in ('cobrado', 'anulado')
      and c.ref_norm <> ''
      and (p_bloques = 1 or mod(abs(hashtext(c.ref_norm)), p_bloques) = p_bloque)
  ),
  mi as (
    select
      m.id,
      round(m.monto * 100)::bigint as cent,
      m.ref_norm as ref,
      row_number() over (
        partition by round(m.monto * 100), m.ref_norm order by m.id
      ) as n
    from public.movimientos_extracto m
    where m.lote_id = p_lote_id
      and m.ref_norm <> ''
      and (p_bloques = 1 or mod(abs(hashtext(m.ref_norm)), p_bloques) = p_bloque)
  )
  select ci.id, mi.id
    from ci
    join mi on ci.cent = mi.cent and ci.ref = mi.ref and ci.n = mi.n
$$;

revoke all on function public.pares_exactos(uuid, uuid, date, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.pares_exactos(uuid, uuid, date, date, integer, integer)
  to service_role;


-- ---------------------------------------------------------------------------
-- 2) La capa exacta, ahora sobre la función compartida
--
-- Mismo comportamiento que en 0029; lo único que cambia es de dónde sale el
-- conjunto de pares.
-- ---------------------------------------------------------------------------
create or replace function public.conciliar_exacta(
  p_job_id  text,
  p_bloque  integer default 0,
  p_bloques integer default 1
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
  v_pares bigint;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;
  if v_job.lote_extracto_id is null then
    raise exception 'El job % no tiene extracto cargado en tabla', p_job_id
      using errcode = 'check_violation';
  end if;

  with pares as (
    insert into public.matches_conciliacion (
      job_id, empresa_id, comprobante_ids, movimiento_ids,
      metodo, estado_revision, diferencia_monto
    )
    select
      p_job_id, v_job.empresa_id, array[p.comprobante_id], array[p.movimiento_id],
      'exacta', 'auto', 0
    from public.pares_exactos(
      v_job.empresa_id, v_job.lote_extracto_id,
      v_job.periodo_desde, v_job.periodo_hasta,
      p_bloque, p_bloques
    ) p
    returning 1
  )
  select count(*) into v_pares from pares;

  return v_pares;
end;
$$;

revoke all on function public.conciliar_exacta(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.conciliar_exacta(text, integer, integer)
  to service_role;


-- ---------------------------------------------------------------------------
-- 3) El diagnóstico previo
--
-- Devuelve CONTADORES, no prosa: qué hacer con ellos lo decide
-- `src/lib/diagnosticoPrevio.ts`, que es puro y tiene tests. Aquí solo se
-- cuenta, que es lo que Postgres hace bien y lo que a esta escala no se puede
-- hacer en Node.
--
-- ⚠️ `security definer` con la empresa resuelta desde `auth.uid()`, NUNCA por
-- parámetro: un `empresa_id` recibido de fuera sería un `?empresa_id=` en manos
-- de cualquiera. Mismo patrón que `resumen_saldos` (0021).
--
-- ⚠️ `pares_estimados` puede salir NULL, y eso no es un fallo: emparejar medio
-- millón contra medio millón tarda más que el `statement_timeout` de 8 s, así
-- que por encima de `p_limite_estimacion` no se intenta. La señal que de
-- verdad diagnostica el caso del 0 % es `refs_compartidas` —cuántos códigos de
-- operación aparecen en LOS DOS lados—, que es un join sobre columnas indexadas
-- y cuesta casi nada. Devolver null y decirlo es mejor que colgar la pantalla o
-- que inventar un número.
-- ---------------------------------------------------------------------------
create or replace function public.diagnostico_previo(
  p_lote_id           uuid,
  p_desde             date,
  p_hasta             date,
  p_limite_estimacion integer default 60000
)
returns table (
  internos                 bigint,
  internos_con_ref         bigint,
  internos_ref_repetida    bigint,
  movimientos              bigint,
  movimientos_con_ref      bigint,
  movimientos_ref_repetida bigint,
  movimientos_abono        bigint,
  movimientos_cargo        bigint,
  movimientos_fuera        bigint,
  movimientos_dia_bajo     bigint,
  refs_compartidas         bigint,
  pares_estimados          bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_int bigint;
  v_mov bigint;
  v_pares bigint := null;
begin
  select ue.empresa_id into v_empresa
    from public.usuarios_empresa ue
   where ue.usuario_id = auth.uid()
   limit 1;
  if v_empresa is null then
    return; -- sin sesión no hay empresa, y por tanto no hay nada que contar
  end if;

  -- El lote tiene que ser de ESTA empresa. Sin esta línea, un uuid ajeno
  -- devolvería el diagnóstico del extracto de otro cliente. Se devuelve vacío
  -- en vez de error: tampoco se confirma que el lote exista.
  perform 1
     from public.movimientos_extracto m
    where m.lote_id = p_lote_id
      and m.empresa_id = v_empresa
    limit 1;
  if not found then
    return;
  end if;

  select count(*) into v_int
    from public.comprobantes c
   where c.empresa_id = v_empresa
     and c.fecha between p_desde and p_hasta
     and c.estado not in ('cobrado', 'anulado');

  select count(*) into v_mov
    from public.movimientos_extracto m
   where m.lote_id = p_lote_id
     and m.empresa_id = v_empresa;

  -- La estimación va en un IF y no en un CASE dentro del select: así queda
  -- fuera de toda duda que la consulta cara NO se evalúa cuando se decide
  -- saltarla. Un CASE se lo dejaría a criterio del planificador.
  if v_int <= p_limite_estimacion and v_mov <= p_limite_estimacion then
    select count(*) into v_pares
      from public.pares_exactos(v_empresa, p_lote_id, p_desde, p_hasta);
  end if;

  return query
  with ci as materialized (
    select c.ref_norm as ref
      from public.comprobantes c
     where c.empresa_id = v_empresa
       and c.fecha between p_desde and p_hasta
       and c.estado not in ('cobrado', 'anulado')
  ),
  mi as materialized (
    select m.ref_norm as ref, m.monto, m.fecha
      from public.movimientos_extracto m
     where m.lote_id = p_lote_id
       and m.empresa_id = v_empresa
  ),
  ci_refs as materialized (
    select ref, count(*) as k from ci where ref <> '' group by ref
  ),
  mi_refs as materialized (
    select ref, count(*) as k from mi where ref <> '' group by ref
  )
  select
    v_int,
    (select count(*) from ci where ref <> ''),
    (select coalesce(sum(k), 0) from ci_refs where k > 1),
    v_mov,
    (select count(*) from mi where ref <> ''),
    (select coalesce(sum(k), 0) from mi_refs where k > 1),
    (select count(*) from mi where monto > 0),
    (select count(*) from mi where monto < 0),
    (select count(*) from mi where fecha < p_desde or fecha > p_hasta),
    (select count(*) from mi where extract(day from fecha) <= 12),
    (select count(*) from ci_refs a join mi_refs b on b.ref = a.ref),
    v_pares;
end;
$$;

revoke all on function public.diagnostico_previo(uuid, date, date, integer)
  from public, anon;
grant execute on function public.diagnostico_previo(uuid, date, date, integer)
  to authenticated, service_role;

comment on function public.diagnostico_previo(uuid, date, date, integer) is
  'Contadores para revisar una conciliación antes de dispararla (Paso 3). '
  'La empresa sale de auth.uid(); nunca por parámetro. Ver '
  'src/lib/diagnosticoPrevio.ts para la interpretación.';
