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
