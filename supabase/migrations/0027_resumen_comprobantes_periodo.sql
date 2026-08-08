-- ============================================================================
-- 0027_resumen_comprobantes_periodo.sql — El contador del wizard, en la base
--
-- El Paso 1 dice cuántos comprobantes hay en el período elegido. Lo consultaba
-- el NAVEGADOR con el cliente de RLS y sin filtrar por empresa, confiando en
-- que la política acotara. Con 452.309 comprobantes eso no termina: la política
-- es `es_miembro(empresa_id)`, una función sobre una COLUMNA que Postgres
-- evalúa fila a fila, y la consulta se pasa del `statement_timeout` de 8 s.
--
-- El resultado en pantalla era el peor posible:
--
--     Comprobantes del período
--     0 registros · S/ 0.00
--     No hay comprobantes en este período.
--
-- O sea, una respuesta tranquilizadora y falsa sobre datos que sí estaban. El
-- usuario no tiene forma de distinguir "no hay" de "no se pudo contar".
--
-- Mismo remedio que `resumen_saldos` (0021): la pertenencia se resuelve UNA vez
-- y el filtro por `empresa_id` es una igualdad indexable.
-- ============================================================================

create or replace function public.resumen_comprobantes_periodo(
  p_desde date,
  p_hasta date
)
returns table (
  registros      bigint,
  suma           numeric,
  total_cargados bigint,
  ya_cobrados    bigint
)
language sql
stable
-- ⚠️ SECURITY DEFINER: RLS no aplica dentro, así que el `empresa_id in (...)`
-- de cada consulta ES el control de acceso. La empresa sale siempre de
-- `auth.uid()`; esta función NUNCA acepta un empresa_id por parámetro.
security definer
set search_path = public
as $$
  -- ⚠️ UN SOLO recorrido con `filter`, no cuatro subconsultas.
  --
  -- La primera versión hacía cuatro `select` independientes sobre la misma
  -- tabla: 6,19 s con 452.309 comprobantes, demasiado cerca de los 8 s del
  -- `statement_timeout` para dejarlo así. Los mismos cuatro números salen de
  -- una pasada agregando con `filter`.
  with mias as (
    select ue.empresa_id
      from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  )
  select
    -- Lo que entraría a conciliar: mismo criterio que
    -- `getComprobantesCanonicos` y que la capa exacta en SQL.
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
    ),
    -- Suma EXACTA, no la de las primeras mil filas. Antes salía de las que
    -- alcanzara a traer PostgREST y la pantalla avisaba de que era parcial.
    coalesce(sum(abs(c.monto)) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
    ), 0),
    -- Todo lo cargado, sin filtrar por fecha: si alguien tiene 5 comprobantes
    -- y en el período caen 2, decir solo "2" parece que se perdieron los otros.
    count(*),
    -- Del período pero ya saldados: se dejan fuera y hay que decirlo, o
    -- parecerá que faltan.
    count(*) filter (
      where c.fecha between p_desde and p_hasta and c.estado = 'cobrado'
    )
  from public.comprobantes c
  -- ⚠️ FRONTERA DE SEGURIDAD (ver la nota de SECURITY DEFINER).
  where c.empresa_id in (select empresa_id from mias);
$$;

comment on function public.resumen_comprobantes_periodo(date, date) is
  'Conteos y suma de comprobantes de un período para el Paso 1 del wizard. '
  'Cuenta en la base: con medio millón de filas, hacerlo por PostgREST con RLS '
  'se pasa del statement_timeout y la pantalla dice "0".';

revoke all on function public.resumen_comprobantes_periodo(date, date)
  from public, anon;
grant execute on function public.resumen_comprobantes_periodo(date, date)
  to authenticated, service_role;

-- Apoya el filtro por período, que es el recorrido natural del wizard.
create index if not exists idx_comprobantes_empresa_fecha
  on public.comprobantes (empresa_id, fecha);
