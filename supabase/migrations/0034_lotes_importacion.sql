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
