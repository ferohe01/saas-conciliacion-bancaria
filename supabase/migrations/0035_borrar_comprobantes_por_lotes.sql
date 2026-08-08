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
