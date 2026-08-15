-- ============================================================================
-- 0050_posicion_caja.sql — Cuánta plata hay, y de qué fecha
--
-- Primera pieza del módulo 2 (ver docs/diseno-posicion-caja.md). Responde
-- «¿cuánto tengo?» con cifras que salen de conciliaciones APROBADAS, no de un
-- saldo tecleado a mano.
--
-- ⚠️⚠️ LO QUE HACE POSIBLE SUMAR SIN CONTAR DOS VECES es el `exclude using gist`
-- de la 0012: no puede haber dos conciliaciones aprobadas con rangos solapados
-- en la misma cuenta. Sin esa garantía, dos corridas del mismo mes duplicarían
-- el saldo y las entradas, y el error sería **invisible**. Con ella, unir por
-- `aprobada` devuelve exactamente un lote por cuenta y tramo de fechas, y lo
-- garantiza la base — no el cuidado de quien escribe esta consulta.
--
-- ── El saldo y los movimientos NO salen del mismo sitio ────────────────────
--
-- El sistema permite conciliar un mes por CORTES: 01–05, 06–17, 18–30. Son
-- rangos que no se solapan, así que conviven aprobados.
--
--   · El SALDO es el del ÚLTIMO corte. Un saldo no se suma: el del 30 ya
--     incluye todo lo anterior. Sumar los tres cortes triplicaría la caja.
--   · Las ENTRADAS y SALIDAS sí se SUMAN, sobre todos los cortes del mismo mes.
--     Enseñar solo las del último tramo diría «entraron 180.000» en un mes de
--     600.000, y el usuario no tendría forma de notarlo.
--
-- Por eso la función devuelve además el rango REAL que abarcan los movimientos
-- sumados (`mov_desde`/`mov_hasta`) y cuántos cortes son: la pantalla etiqueta
-- exactamente lo que sumó, y no hay forma de que el rótulo mienta.
--
-- ── Qué NO hace ────────────────────────────────────────────────────────────
--
-- No convierte monedas (cada cuenta trae la suya y no se mezclan), no proyecta
-- nada, y no inventa un saldo para las cuentas sin conciliar: devuelve `null`,
-- que significa «no lo sé» y es distinto de cero.
-- ============================================================================

create or replace function public.posicion_caja()
returns table (
  cuenta_id   uuid,
  banco       text,
  numero      text,
  moneda      text,
  -- La conciliación que sostiene el saldo. Sirve para poder ir a verla.
  job_id      text,
  corte_desde date,
  corte_hasta date,
  -- `null` cuando la cuenta no tiene ninguna aprobada, o cuando la tiene pero
  -- nadie declaró el saldo final del extracto. Cero sería una afirmación falsa.
  saldo_final numeric,
  -- Sumados sobre TODOS los cortes aprobados del mes del último corte.
  entradas    numeric,
  salidas     numeric,
  movimientos bigint,
  cortes      bigint,
  mov_desde   date,
  mov_hasta   date
)
language sql
stable
-- ⚠️ SECURITY DEFINER: RLS no aplica dentro, así que el `empresa_id in (...)`
-- resuelto desde `auth.uid()` ES el control de acceso. Nunca por parámetro:
-- sería un `?empresa_id=` en manos de cualquiera. Mismo patrón que
-- `resumen_saldos` (0021) y `resumen_ejecutivo` (0032).
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id
      from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  aprobadas as (
    select j.id, j.cuenta_id, j.periodo_desde, j.periodo_hasta,
           j.saldo_final_banco, j.lote_extracto_id, j.payload_entrada
      from public.jobs_conciliacion j
     where j.empresa_id in (select empresa_id from mias)
       and j.estado = 'completado'
       and j.estado_contable = 'aprobada'
  ),
  -- El último corte de cada cuenta: de ahí sale el saldo y la fecha que se
  -- enseña. `distinct on` con el orden explícito es lo que fija cuál es.
  ultima as (
    select distinct on (a.cuenta_id) *
      from aprobadas a
     order by a.cuenta_id, a.periodo_hasta desc, a.id desc
  ),
  -- Los cortes del MISMO MES que el último. Se comparan por el mes de
  -- `periodo_hasta`: un corte pertenece al mes en que cierra.
  del_mes as (
    select a.*
      from aprobadas a
      join ultima u on u.cuenta_id = a.cuenta_id
     where date_trunc('month', a.periodo_hasta)
         = date_trunc('month', u.periodo_hasta)
  ),
  -- Movimientos de cada corte. Se agregan en la base: traerlos para sumarlos en
  -- Node es lo que la parte B vino a eliminar.
  --
  -- ⚠️ DOS ORÍGENES, porque hay dos modos de conciliar y los dos siguen vivos:
  -- en modo TABLA el extracto está en `movimientos_extracto` (lo que hace
  -- viable el cliente grande), y en modo PAYLOAD viaja dentro del JSONB del
  -- job. Mirar solo el primero dejaría las conciliaciones antiguas con
  -- «Entradas 0» al lado de un saldo real — el número plausible y falso de
  -- siempre, y sin nada que delatara la omisión.
  por_job as (
    select d.cuenta_id, d.id, d.periodo_desde, d.periodo_hasta,
           t.entradas, t.salidas, t.n
      from del_mes d
      left join lateral (
        select coalesce(sum(s.v) filter (where s.v > 0), 0) as entradas,
               coalesce(sum(s.v) filter (where s.v < 0), 0) as salidas,
               count(*)                                     as n
          from (
            select m.monto as v
              from public.movimientos_extracto m
             where d.lote_extracto_id is not null
               and m.lote_id = d.lote_extracto_id
            union all
            select (e->>'monto')::numeric
              from jsonb_array_elements(
                     case
                       when d.lote_extracto_id is null
                        and jsonb_typeof(d.payload_entrada->'movimientos_bancarios') = 'array'
                       then d.payload_entrada->'movimientos_bancarios'
                       else '[]'::jsonb
                     end) e
          ) s
      ) t on true
  ),
  movs as (
    select p.cuenta_id,
           sum(p.entradas)     as entradas,
           sum(p.salidas)      as salidas,
           sum(p.n)::bigint    as n,
           count(*)            as cortes,
           min(p.periodo_desde) as desde,
           max(p.periodo_hasta) as hasta
      from por_job p
     group by p.cuenta_id
  )
  select
    cb.id,
    cb.banco,
    cb.numero_enmascarado,
    coalesce(cb.moneda, 'PEN'),
    u.id,
    u.periodo_desde,
    u.periodo_hasta,
    u.saldo_final_banco,
    coalesce(mv.entradas, 0),
    -- Los cargos ya vienen negativos (convención de signos única del sistema):
    -- se devuelven en positivo porque la pantalla los rotula «Salidas» y el
    -- signo lo pone la etiqueta, no el número.
    abs(coalesce(mv.salidas, 0)),
    coalesce(mv.n, 0),
    coalesce(mv.cortes, 0),
    mv.desde,
    mv.hasta
  from public.cuentas_bancarias cb
  -- ⚠️ LEFT JOIN a propósito: las cuentas sin ninguna conciliación aprobada
  -- también salen, con todo en null. Omitirlas haría que el total pareciera
  -- completo cuando le falta una cuenta entera.
  left join ultima u on u.cuenta_id = cb.id
  left join movs   mv on mv.cuenta_id = cb.id
  where cb.empresa_id in (select empresa_id from mias)
  order by cb.banco, cb.numero_enmascarado;
$$;

comment on function public.posicion_caja() is
  'Saldo, entradas y salidas por cuenta, desde las conciliaciones APROBADAS. '
  'El saldo es el del último corte; los movimientos suman todos los cortes del '
  'mes. La empresa sale de auth.uid(); nunca por parámetro.';

revoke all on function public.posicion_caja() from public, anon;
grant execute on function public.posicion_caja() to authenticated, service_role;
