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
