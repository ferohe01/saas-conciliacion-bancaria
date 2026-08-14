-- ============================================================================
-- medir-residuo.sql — Qué parte del análisis del residuo se come los 8 s
--
-- `residuo_explicado()` no se puede medir desde el SQL Editor: resuelve la
-- empresa con `auth.uid()`, allí no hay sesión, y devuelve `null` al instante
-- sin ejecutar nada. Eso es su frontera de seguridad y está bien — pero deja
-- sin forma de cronometrarla cuando el botón «Analizar» falla.
--
-- Esto es su cuerpo troceado, con los identificadores puestos a mano y sin la
-- comprobación de pertenencia. Solo LEE; no cambia nada.
--
-- CÓMO SE USA
--   Ejecuta los bloques UNO A UNO y anota el tiempo de cada uno (Studio lo
--   muestra abajo a la derecha). El que se dispare es el culpable.
--
-- ⚠️ Studio corre como superusuario y NO tiene el tope de 8 s, así que aquí
-- todos terminan. Lo que importa no es que acaben: es cuánto tardan.
-- ============================================================================

-- ── 0) Los identificadores de la última conciliación ────────────────────────
select id, lote_extracto_id, empresa_id, cuenta_id, periodo_desde, periodo_hasta,
       pg_size_pretty(pg_column_size(payload_entrada)::bigint) as payload,
       jsonb_array_length(payload_entrada -> 'registros_internos')   as internos,
       jsonb_array_length(payload_entrada -> 'movimientos_bancarios') as movimientos
  from public.jobs_conciliacion
 order by created_at desc
 limit 3;


-- ── 1) Leer el job entero (incluye desempaquetar el payload) ────────────────
-- Si esto ya tarda segundos, el problema es el tamaño del JSONB, no las
-- consultas de después.
explain (analyze, buffers)
select * from public.jobs_conciliacion where id = 'rec-2026-06-527538';


-- ── 2) Sacar el residuo del payload y unirlo por clave primaria ─────────────
-- Debería ser instantáneo: son ~4.400 búsquedas por PK. Si aquí aparece un
-- "Seq Scan on comprobantes", el planificador eligió recorrer la tabla entera
-- porque no sabe cuántas filas trae el jsonb — y ese es el problema.
explain (analyze, buffers)
with j as (select * from public.jobs_conciliacion where id = 'rec-2026-06-527538')
select count(*)
  from j,
       jsonb_to_recordset(j.payload_entrada -> 'registros_internos')
         as r(comprobante_id uuid)
  join public.comprobantes c on c.id = r.comprobante_id;


-- ── 3) Descontar lo que n8n casó después del residuo ────────────────────────
-- Con la 0047 esto son tres búsquedas por índice. Si tarda, el índice
-- `idx_matches_job_metodo` no se está usando.
explain (analyze, buffers)
select count(*)
  from public.matches_conciliacion m
 where m.job_id = 'rec-2026-06-527538'
   and m.metodo in ('difusa', 'ia', 'manual');


-- ── 4) La pregunta «¿está su código en el otro lado?» ───────────────────────
-- ~4.400 sondas al índice del extracto. Debería ser cosa de milisegundos.
explain (analyze, buffers)
with j as (select * from public.jobs_conciliacion where id = 'rec-2026-06-527538'),
pend as (
  select c.ref_norm as ref
    from j,
         jsonb_to_recordset(j.payload_entrada -> 'registros_internos')
           as r(comprobante_id uuid)
    join public.comprobantes c on c.id = r.comprobante_id
)
select count(*) filter (
         where exists (select 1 from public.movimientos_extracto m, j
                        where m.lote_id = j.lote_extracto_id and m.ref_norm = p.ref)
       ) as con_codigo_en_el_banco,
       count(*) as total
  from pend p;


-- ── 5) El recuento por serie (la OTRA función, `residuo_series`) ────────────
-- Esta sí recorre las dos tablas enteras a propósito. Va en su propia llamada,
-- así que si es la lenta, la clasificación no debería verse afectada.
explain (analyze, buffers)
select left(m.ref_norm, 4) as serie, count(distinct m.ref_norm)
  from public.movimientos_extracto m
 where m.lote_id = (select lote_extracto_id from public.jobs_conciliacion
                     where id = 'rec-2026-06-527538')
   and m.ref_norm <> ''
 group by 1;
