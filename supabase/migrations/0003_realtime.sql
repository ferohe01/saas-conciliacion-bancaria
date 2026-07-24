-- ============================================================================
-- 0003_realtime.sql — Habilita Supabase Realtime en jobs_conciliacion
--
-- La pantalla de progreso se suscribe a la fila del job para ver el avance por
-- fases en vivo. RLS sigue aplicando a Realtime: cada usuario solo recibe los
-- cambios de los jobs de su empresa.
-- ============================================================================

alter publication supabase_realtime add table public.jobs_conciliacion;

-- REPLICA IDENTITY FULL para que los payloads de UPDATE incluyan todas las
-- columnas (necesario para leer `resultado`/`fase_actual` en el cliente).
alter table public.jobs_conciliacion replica identity full;
