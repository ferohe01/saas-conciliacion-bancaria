-- ============================================================================
-- 0059_pgvector_ejemplos.sql — Ejemplos de aprendizaje por SIMILITUD (pgvector)
-- ============================================================================
--
-- La IA del motor calibra su criterio con decisiones humanas pasadas
-- (few-shot). Hasta ahora recibía las 12 MÁS RECIENTES, se parecieran o no al
-- caso que tenía delante. Con esto recibe las MÁS PARECIDAS: cada decisión se
-- guarda con su embedding y, en cada corrida, se buscan las vecinas de los
-- casos que se le van a preguntar al modelo.
--
-- - Un embedding por decisión, calculado UNA vez (`clave` = hash del ejemplo).
--   Cada corrida solo calcula los que faltan.
-- - Índice HNSW por distancia coseno: la búsqueda no recorre la tabla.
-- - Sin políticas: la lee y escribe solo el servidor (service_role) desde el
--   motor. RLS activado igual, para que la key pública no vea nada.
-- - `ejemplos_similares` resuelve TODAS las consultas de una corrida en una
--   sola llamada (un `lateral` por consulta), no una petición por caso.
--
-- ⚠️ Supabase instala las extensiones en el esquema `extensions`; por eso el
-- tipo y el operador van calificados y la función fija su search_path.
--
-- Si esta migración no está aplicada, el motor usa las recientes como siempre:
-- una mejora no puede tumbar la conciliación.
--
-- Re-ejecutable.
-- ============================================================================

create extension if not exists vector with schema extensions;

create table if not exists public.ejemplos_vectoriales (
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  clave       text not null,
  decision    text not null check (decision in ('aceptado', 'rechazado')),
  interno     text not null,
  banco       text not null,
  categoria   text,
  motivo      text,
  embedding   extensions.vector(1536) not null,
  created_at  timestamptz not null default now(),
  primary key (empresa_id, clave)
);

create index if not exists idx_ejemplos_vectoriales_hnsw
  on public.ejemplos_vectoriales
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.ejemplos_vectoriales enable row level security;
revoke all on public.ejemplos_vectoriales from anon, authenticated;

create or replace function public.ejemplos_similares(
  p_empresa   uuid,
  p_consultas jsonb,           -- arreglo de vectores como texto: ["[0.1,…]", …]
  p_k         integer default 3
)
returns table (
  consulta   integer,
  clave      text,
  decision   text,
  interno    text,
  banco      text,
  categoria  text,
  motivo     text,
  distancia  double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select q.i::integer, e.clave, e.decision, e.interno, e.banco, e.categoria, e.motivo, s.distancia
    from jsonb_array_elements_text(p_consultas) with ordinality as q(v, i)
    cross join lateral (
      select v.clave, (v.embedding <=> q.v::extensions.vector) as distancia
        from public.ejemplos_vectoriales v
       where v.empresa_id = p_empresa
       order by v.embedding <=> q.v::extensions.vector
       limit greatest(1, least(p_k, 10))
    ) s
    join public.ejemplos_vectoriales e
      on e.empresa_id = p_empresa and e.clave = s.clave;
$$;

revoke all on function public.ejemplos_similares(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.ejemplos_similares(uuid, jsonb, integer) to service_role;

comment on table public.ejemplos_vectoriales is
  'Decisiones humanas con su embedding, para elegir los ejemplos de aprendizaje '
  'más parecidos a cada caso (0059). La escribe solo el motor.';
