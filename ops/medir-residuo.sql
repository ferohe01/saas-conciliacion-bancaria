-- ============================================================================
-- medir-residuo.sql — Cuánto tarda de verdad el análisis del residuo
--
-- `residuo_explicado()` NO se puede probar desde el SQL Editor: resuelve la
-- empresa con `auth.uid()` y ahí no hay sesión, así que devuelve `null` al
-- instante sin ejecutar nada. Eso es correcto —es su frontera de seguridad—
-- pero deja sin forma de medirla cuando el botón «Analizar» falla.
--
-- Esto es su cuerpo, con los identificadores puestos a mano y sin la
-- comprobación de pertenencia. Solo LEE.
--
-- CÓMO SE USA
--   1. Rellena los dos valores de abajo (el job y su lote de extracto).
--   2. Pégalo entero en el SQL Editor de Studio.
--   3. Mira el `Execution Time` del final:
--        < 8.000 ms  → la función entra; si el botón falla, NO es el tiempo
--        > 8.000 ms  → es el `statement_timeout` de PostgREST, hay que acelerar
--
-- ⚠️ Studio corre como superusuario y NO tiene ese tope, así que aquí la
-- consulta termina siempre. Lo que importa no es que acabe: es cuánto tarda.
-- ============================================================================

-- Los dos identificadores. Salen de:
--   select id, lote_extracto_id, empresa_id, cuenta_id, periodo_desde, periodo_hasta
--     from jobs_conciliacion order by created_at desc limit 5;
\set job    'rec-2026-06-527538'
\set lote   'b3bba531-128a-4c6e-a236-1a894736d4f0'

explain (analyze, buffers, timing)
with j as (
  select empresa_id, cuenta_id, periodo_desde, periodo_hasta, lote_extracto_id
    from public.jobs_conciliacion where id = :'job'
),
casados_c as materialized (
  select unnest(m.comprobante_ids) as id
    from public.matches_conciliacion m where m.job_id = :'job'
),
casados_m as materialized (
  select unnest(m.movimiento_ids) as id
    from public.matches_conciliacion m where m.job_id = :'job'
),
int_pend as materialized (
  select c.ref_norm as ref,
         case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end as monto
    from public.comprobantes c, j
   where c.empresa_id = j.empresa_id
     and c.fecha between j.periodo_desde and j.periodo_hasta
     and c.estado not in ('cobrado', 'anulado')
     and not exists (select 1 from casados_c k where k.id = c.id)
),
mov_pend as materialized (
  select m.ref_norm as ref, m.monto
    from public.movimientos_extracto m
   where m.lote_id = :'lote'::uuid
     and not exists (select 1 from casados_m k where k.id = m.id)
),
int_clas as (
  select case
           when p.ref = '' then 'sin_codigo'
           when exists (select 1 from public.movimientos_extracto m
                         where m.lote_id = :'lote'::uuid and m.ref_norm = p.ref)
             then 'codigo_en_el_otro_lado'
           else 'sin_rastro'
         end as motivo, p.monto
    from int_pend p
),
mov_clas as (
  select case
           when p.ref = '' then 'sin_codigo'
           when exists (select 1 from public.comprobantes c, j
                         where c.empresa_id = j.empresa_id
                           and c.ref_norm = p.ref
                           and c.fecha between j.periodo_desde and j.periodo_hasta)
             then 'codigo_en_el_otro_lado'
           else 'sin_rastro'
         end as motivo, p.monto
    from mov_pend p
),
tot_banco as (
  select left(m.ref_norm, 4) as serie, count(distinct m.ref_norm) as n
    from public.movimientos_extracto m
   where m.lote_id = :'lote'::uuid and m.ref_norm <> ''
   group by 1
),
tot_libros as (
  select left(c.ref_norm, 4) as serie, count(distinct c.ref_norm) as n
    from public.comprobantes c, j
   where c.empresa_id = j.empresa_id
     and c.ref_norm <> ''
     and c.fecha between j.periodo_desde and j.periodo_hasta
   group by 1
)
select
  (select count(*) from int_clas where motivo = 'sin_rastro')             as int_sin_rastro,
  (select count(*) from int_clas where motivo = 'codigo_en_el_otro_lado') as int_con_codigo,
  (select count(*) from mov_clas where motivo = 'sin_rastro')             as mov_sin_rastro,
  (select count(*) from mov_clas where motivo = 'codigo_en_el_otro_lado') as mov_con_codigo,
  (select n from tot_banco  where serie = 'S001')                          as s001_banco,
  (select n from tot_libros where serie = 'S001')                          as s001_libros;
