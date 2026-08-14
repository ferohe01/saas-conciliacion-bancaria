-- ============================================================================
-- medir-residuo.sql — La comprobación de un minuto
--
-- `residuo_explicado()` no se puede medir desde el SQL Editor: resuelve la
-- empresa con `auth.uid()`, allí no hay sesión, y devuelve `null` al instante.
-- Esto es la sonda que hace 4.382 veces, aislada.
--
-- QUÉ MIRAR en la salida:
--   «Index Only Scan using idx_mov_extracto_ref_norm»  → correcto, milisegundos
--   «Seq Scan on movimientos_extracto»                 → el índice PARCIAL no se
--                                                        está usando: es esto lo
--                                                        que agota los 8 s
-- ============================================================================

-- 1) Cómo se resuelve la sonda SIN la condición del índice parcial (lo que
--    hacían las versiones 0044-0048):
explain (analyze, buffers)
select exists (
  select 1 from public.movimientos_extracto m
   where m.lote_id = (select lote_extracto_id from public.jobs_conciliacion
                       where id = 'rec-2026-06-527538')
     and m.ref_norm = 'SR1102748951'
);

-- 2) Y CON ella (lo que hace la 0049). Compara los dos tiempos:
explain (analyze, buffers)
select exists (
  select 1 from public.movimientos_extracto m
   where m.lote_id = (select lote_extracto_id from public.jobs_conciliacion
                       where id = 'rec-2026-06-527538')
     and m.ref_norm = 'SR1102748951'
     and m.ref_norm <> ''
);

-- 3) Lo mismo del otro lado (comprobantes):
explain (analyze, buffers)
select exists (
  select 1 from public.comprobantes c
   where c.empresa_id = (select empresa_id from public.jobs_conciliacion
                          where id = 'rec-2026-06-527538')
     and c.ref_norm = 'SR1102748951'
     and c.ref_norm <> ''
     and c.fecha between '2026-06-01' and '2026-06-30'
);
