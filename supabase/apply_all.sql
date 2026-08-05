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
