-- ============================================================================
-- 0026_matches_para_reportes.sql — Reportes y aprendizaje sobre los pares en
-- tabla (parte B, flanco pendiente)
--
-- Los reportes y el módulo de aprendizaje leen `resultado.matches`. En modo
-- tabla ese array queda vacío tras la absorción, así que verían el desglose por
-- método a cero y el pool de ejemplos vacío — justo en la empresa con medio
-- millón de partidas, que es la que más tiene que enseñar.
--
-- Los dos necesitan cosas distintas, y por eso son dos funciones:
--
--   · el aprendizaje quiere los pares que REVISÓ UNA PERSONA. Son pocos por
--     definición —nadie revisa 447.795 a mano— así que se devuelven enteros.
--   · los reportes quieren el DESGLOSE. Traer medio millón de filas para
--     contarlas en Node es exactamente lo que la parte B vino a eliminar, así
--     que se cuentan aquí.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- matches_revisados(jobs) — los pares con decisión humana
--
-- `auto` queda fuera: nadie lo miró, y usarlo como ejemplo de aprendizaje sería
-- enseñarle a la IA un criterio que ninguna persona aplicó. Es la misma razón
-- por la que los `auto` no entran en la tasa de acierto (ver CLAUDE.md §
-- "¿de verdad está aprendiendo?").
-- ---------------------------------------------------------------------------
create or replace function public.matches_revisados(p_job_ids text[])
returns table (
  job_id               text,
  comprobante_ids      uuid[],
  movimiento_ids       uuid[],
  metodo               text,
  estado_revision      text,
  confianza            numeric,
  categoria_diferencia text,
  diferencia_monto     numeric,
  decisiones           jsonb,
  excluido_aprendizaje boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.job_id, m.comprobante_ids, m.movimiento_ids, m.metodo, m.estado_revision,
    m.confianza, m.categoria_diferencia, m.diferencia_monto, m.decisiones,
    m.excluido_aprendizaje
  from public.matches_conciliacion m
  where m.job_id = any (p_job_ids)
    and m.estado_revision <> 'auto';
$$;

-- ---------------------------------------------------------------------------
-- conteo_matches(jobs) — el desglose, contado en la base
--
-- Una fila por (job, método, categoría, estado). Son unas pocas decenas por
-- job aunque detrás haya medio millón de pares.
-- ---------------------------------------------------------------------------
create or replace function public.conteo_matches(p_job_ids text[])
returns table (
  job_id               text,
  metodo               text,
  categoria_diferencia text,
  estado_revision      text,
  n                    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select m.job_id, m.metodo, m.categoria_diferencia, m.estado_revision, count(*)
    from public.matches_conciliacion m
   where m.job_id = any (p_job_ids)
   group by m.job_id, m.metodo, m.categoria_diferencia, m.estado_revision;
$$;

comment on function public.matches_revisados(text[]) is
  'Pares con decisión humana. Los `auto` quedan fuera: nadie los miró.';
comment on function public.conteo_matches(text[]) is
  'Desglose por método/categoría/estado, contado en la base.';

-- Las invoca el backend con service_role. El acotado por empresa lo hace quien
-- llama, que solo pasa jobs de la empresa del usuario (leídos con RLS).
revoke all on function public.matches_revisados(text[]) from public, anon, authenticated;
revoke all on function public.conteo_matches(text[]) from public, anon, authenticated;
grant execute on function public.matches_revisados(text[]) to service_role;
grant execute on function public.conteo_matches(text[]) to service_role;
