-- ============================================================================
-- 0043_origen_partidas.sql — De tu archivo a la conciliación, sin huecos
--
-- ── El problema, tal cual apareció en una demo ──────────────────────────────
--
-- «El mayor tiene 452.605 filas y el panel dice 452.177 registros internos.
-- ¿Dónde están los otros 428?» No había forma de contestarlo desde la
-- aplicación. Hubo que abrir el Excel, cruzar contra la base y reconstruir a
-- mano una cuenta que el sistema tenía delante:
--
--     452.605 filas del archivo
--       − 296  no se cargaron (repetidas / sin datos / ya existían)
--     452.309 comprobantes
--       − 132  fuera del período conciliado
--     452.177 registros internos
--       − 447.795 conciliados
--       =   4.382 sin conciliar
--
-- Cada resta tiene una explicación distinta y todas son legítimas. Lo que no es
-- legítimo es que el usuario tenga que descubrirlas por su cuenta: un número
-- que no cuadra con su archivo destruye la confianza en TODOS los demás, por
-- muy correctos que sean.
--
-- ── Dos piezas ─────────────────────────────────────────────────────────────
--
-- 1) `importaciones_comprobantes` — qué pasó en cada carga. La ruta de ingesta
--    ya contaba insertados / repetidos / inválidos / ya existentes, pero solo
--    para ponerlo en un mensaje que desaparece al recargar la página.
--
-- 2) `jobs_conciliacion.origen_partidas` — la cascada CONGELADA en el momento
--    de conciliar.
--
-- ⚠️⚠️ Lo segundo no es una comodidad, es lo único que puede funcionar: al
-- aprobar, los 447.795 comprobantes casados pasan a `cobrado`, así que "del
-- período y sin cobrar" se desploma de 452.177 a 4.382. Una pantalla que
-- recalculara se degradaría sola y enseñaría un número peor cada vez que
-- alguien la mirase — exactamente el fallo que la 0033 tuvo que arreglar en el
-- resumen ejecutivo. La foto se toma antes de que el motor corra y ya no se
-- toca. Mismo criterio que `abonos_no_registrados`: el informe sigue diciendo
-- lo que dijo el día que se emitió.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Qué pasó en cada carga de comprobantes
--
-- Una fila por importación. `fecha_min`/`fecha_max` no son decorativas: son lo
-- que permite saber QUÉ CARGAS alimentan un período sin recorrer medio millón
-- de comprobantes para averiguarlo.
-- ---------------------------------------------------------------------------
create table if not exists public.importaciones_comprobantes (
  lote                 uuid primary key,
  empresa_id           uuid not null references public.empresas (id) on delete cascade,
  archivo              text,
  filas_leidas         integer not null default 0,
  insertados           integer not null default 0,
  ya_existian          integer not null default 0,
  repetidas_en_archivo integer not null default 0,
  invalidas            integer not null default 0,
  fecha_min            date,
  fecha_max            date,
  created_at           timestamptz not null default now()
);

create index if not exists idx_importaciones_empresa_rango
  on public.importaciones_comprobantes (empresa_id, fecha_min, fecha_max);

alter table public.importaciones_comprobantes enable row level security;

-- Se LEE desde la aplicación (con sesión) y se ESCRIBE solo desde el servidor
-- con `service_role`, que salta RLS. No hay política de insert a propósito:
-- estos contadores describen lo que hizo el sistema, no algo que el usuario
-- declare.
drop policy if exists importaciones_select on public.importaciones_comprobantes;
create policy importaciones_select on public.importaciones_comprobantes
  for select using (public.es_miembro(empresa_id));

comment on table public.importaciones_comprobantes is
  'Qué pasó en cada carga de comprobantes (leídas, insertadas, repetidas, '
  'inválidas). Alimenta la cascada "de tu archivo a la conciliación".';


-- ---------------------------------------------------------------------------
-- 2) La foto del origen de las partidas, dentro del job
-- ---------------------------------------------------------------------------
alter table public.jobs_conciliacion
  add column if not exists origen_partidas jsonb;

comment on column public.jobs_conciliacion.origen_partidas is
  'Cascada archivo → comprobantes → internos, CONGELADA al iniciar. No se '
  'recalcula: tras aprobar, los comprobantes casados pasan a cobrado y el '
  'mismo cálculo daría un número peor cada vez.';


-- ---------------------------------------------------------------------------
-- 3) El contador
--
-- ⚠️ Una SOLA pasada sobre `comprobantes` con `filter`, no cinco subconsultas.
-- Es la lección de la 0027: cuatro `select` sobre 452.309 filas tardaban 6,19 s
-- contra un `statement_timeout` de 8 s. Los mismos números salen de una pasada.
--
-- ⚠️ `security definer` + acceso solo a `service_role`: lo llama el backend al
-- iniciar, con la empresa que ya resolvió de la sesión. Es el mismo patrón que
-- `conciliar_exacta` — y por eso aquí SÍ puede aceptar `p_empresa_id`, al
-- contrario que las funciones que invoca el navegador (`resumen_saldos`,
-- `diagnostico_previo`), donde un parámetro sería un `?empresa_id=` en manos de
-- cualquiera.
--
-- El ALCANCE se acota a las cargas que solapan el período. Sin eso, una empresa
-- con doce meses cargados vería "fuera del período: 400.000", que es cierto y
-- no dice nada. Si no hay ninguna carga registrada —comprobantes anteriores a
-- esta migración— se cuenta la empresa entera y se devuelve `alcance =
-- 'empresa'` para que la pantalla no prometa lo que no sabe.
-- ---------------------------------------------------------------------------
create or replace function public.origen_partidas(
  p_empresa_id uuid,
  p_desde      date,
  p_hasta      date,
  p_moneda     text default null
)
returns table (
  alcance            text,
  cargas             bigint,
  archivo_filas      bigint,
  archivo_repetidas  bigint,
  archivo_invalidas  bigint,
  archivo_existentes bigint,
  archivo_insertados bigint,
  cargados           bigint,
  fuera_periodo      bigint,
  ya_cobrados        bigint,
  otra_moneda        bigint,
  internos           bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lotes uuid[];
  v_moneda text := coalesce(p_moneda, 'PEN');
begin
  select array_agg(i.lote),
         count(*), coalesce(sum(i.filas_leidas), 0),
         coalesce(sum(i.repetidas_en_archivo), 0), coalesce(sum(i.invalidas), 0),
         coalesce(sum(i.ya_existian), 0), coalesce(sum(i.insertados), 0)
    into v_lotes, cargas, archivo_filas,
         archivo_repetidas, archivo_invalidas, archivo_existentes, archivo_insertados
    from public.importaciones_comprobantes i
   where i.empresa_id = p_empresa_id
     and i.fecha_min <= p_hasta
     and i.fecha_max >= p_desde;

  alcance := case when v_lotes is null then 'empresa' else 'cargas' end;

  select
    count(*),
    count(*) filter (where c.fecha < p_desde or c.fecha > p_hasta),
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado in ('cobrado', 'anulado')
    ),
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and coalesce(c.moneda, 'PEN') <> v_moneda
    ),
    -- ⚠️ Mismo criterio EXACTO que `pares_exactos` y `residuo_internos`: si esta
    -- cifra no fuera la que el motor recibe, la cascada explicaría una resta que
    -- no ocurrió.
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and coalesce(c.moneda, 'PEN') = v_moneda
    )
    into cargados, fuera_periodo, ya_cobrados, otra_moneda, internos
    from public.comprobantes c
   where c.empresa_id = p_empresa_id
     and (v_lotes is null or c.lote_importacion = any(v_lotes));

  return next;
end;
$$;

revoke all on function public.origen_partidas(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.origen_partidas(uuid, date, date, text)
  to service_role;

comment on function public.origen_partidas(uuid, date, date, text) is
  'Cascada archivo → comprobantes → registros internos de un período. La llama '
  'el backend al iniciar y el resultado se congela en jobs.origen_partidas.';

-- Apoya la pasada de arriba cuando hay lotes: sin él, filtrar por lote sobre
-- medio millón de filas obliga a recorrer la tabla entera.
create index if not exists idx_comprobantes_lote_fecha
  on public.comprobantes (empresa_id, lote_importacion, fecha);
