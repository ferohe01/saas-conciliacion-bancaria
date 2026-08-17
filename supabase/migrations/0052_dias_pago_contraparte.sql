-- ============================================================================
-- 0052_dias_pago_contraparte.sql — Cuándo te pagan de verdad (fase 3a)
--
-- Primera pieza del flujo de caja proyectado (docs/diseno-flujo-proyectado.md),
-- y la única que **no proyecta nada**: mide lo que ya pasó.
--
-- ── Por qué esto existe ────────────────────────────────────────────────────
--
-- Una hoja de cálculo asume que la factura a 30 días se cobra el día 30. Aquí
-- no hace falta suponerlo: el sistema tiene el par (factura ↔ movimiento del
-- extracto) de cada cobro que la empresa ya concilió y aprobó, así que la fecha
-- real de pago es un HECHO consultable.
--
--     comprobantes ──► matches_conciliacion ──► movimientos_extracto
--       (vencimiento)     (par conciliado)         (fecha real del abono)
--
-- `matches_conciliacion` guarda `comprobante_ids` y `movimiento_ids` como
-- claves reales desde la 0023; el dato llevaba ahí desde entonces sin que nadie
-- lo mirara.
--
-- ── Qué NO decide esta función ─────────────────────────────────────────────
--
-- No elige qué mediana usar, ni si hay observaciones suficientes, ni cómo se
-- rotula. Devuelve HECHOS agregados y decide `src/lib/diasPago.ts`, que es puro
-- y tiene tests. Mismo reparto que `candidatos_partida` (0038) /
-- `diagnosticoPartida`: **SQL busca, TypeScript decide.**
-- ============================================================================

-- El calibrado recorre los pares de la empresa; hasta ahora solo se entraba a
-- esta tabla por `job_id`. También lo usa el guardia de volumen de abajo, que
-- tiene que ser barato o no sirve de guardia.
create index if not exists idx_matches_empresa
  on public.matches_conciliacion (empresa_id);

drop function if exists public.dias_pago_contraparte(date, integer);

create or replace function public.dias_pago_contraparte(
  -- ⚠️ Ventana de 12 meses por defecto: cómo pagaba un cliente hace tres años
  -- no describe cómo paga hoy, y además acota el trabajo.
  p_desde date default (current_date - interval '12 months')::date,
  -- ⚠️ Tope de pares, mismo criterio que `pares_estimados` en `diagnostico_previo`
  -- (0037): por encima de esto NO se calcula y se dice, en vez de agotar el
  -- `statement_timeout` de 8 s y dejar la pantalla colgada. Con medio millón de
  -- recibos de una recaudadora el calibrado además no significaría nada —son
  -- cobros al contado sin vencimiento— así que no se pierde nada útil.
  p_max_pares integer default 100000
)
returns table (
  -- 'contraparte' · 'empresa' (la mediana global, que es el respaldo) ·
  -- 'no_calculado' (se pasó del tope; `observaciones` trae cuántos pares hay)
  nivel          text,
  contraparte    text,
  ruc            text,
  tipo           text,
  moneda         text,
  observaciones  bigint,
  dias_mediana   numeric,
  dias_min       integer,
  dias_max       integer,
  ultimo_pago    date,
  monto_total    numeric
)
language sql
stable
-- ⚠️ SECURITY DEFINER con la empresa resuelta desde auth.uid(), NUNCA por
-- parámetro. Ver la nota de `resumen_saldos` (0021).
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id
      from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  -- ⚠️ El guardia va PRIMERO y es barato (un count por índice). Contar después
  -- de construir las observaciones no serviría de nada: el trabajo caro ya se
  -- habría hecho. Al ser un subselect escalar, el planificador lo resuelve como
  -- «One-Time Filter» y se salta el resto del plan cuando no se cumple.
  tope as (
    select count(*)::bigint as pares
      from public.matches_conciliacion m
     where m.empresa_id in (select empresa_id from mias)
  ),
  -- Una observación por comprobante liquidado: cuándo acabó de entrar su dinero.
  --
  -- ⚠️ Solo comprobantes LIQUIDADOS (saldo ≈ 0). Uno cobrado a medias todavía no
  -- ha terminado de pagarse: apuntar la fecha de su último abono parcial como si
  -- fuera la del pago completo **sesga la mediana a la baja**, y justo hacia el
  -- lado optimista, que es el que una proyección de caja no se puede permitir.
  obs as (
    select
      c.id,
      coalesce(nullif(trim(c.razon_social_contraparte), ''), 'Sin identificar') as contraparte,
      max(c.ruc_contraparte)       as ruc,
      coalesce(c.tipo, 'cobranza') as tipo,
      coalesce(c.moneda, 'PEN')    as moneda,
      c.monto                      as monto,
      max(mo.fecha)                as fecha_pago,
      -- Sin vencimiento se usa la emisión, igual que `diasVencido` en el aging:
      -- muchas ventas son al contado. Una sola regla para los dos sitios.
      (max(mo.fecha) - coalesce(c.fecha_vencimiento, c.fecha))::integer as retraso
    from public.matches_conciliacion m
    join public.jobs_conciliacion j
      on j.id = m.job_id
     -- Solo lo aprobado mueve saldo, y solo eso puede enseñar nada.
     and j.estado_contable = 'aprobada'
    cross join lateral unnest(m.comprobante_ids) as cid
    cross join lateral unnest(m.movimiento_ids)  as mid
    join public.comprobantes         c  on c.id = cid
    join public.movimientos_extracto mo on mo.id = mid
    where m.empresa_id in (select empresa_id from mias)
      and (select pares from tope) <= p_max_pares
      -- Los mismos estados que descuentan saldo (`ESTADOS_CONFIRMADOS`). Una
      -- sugerencia pendiente no ha cobrado nada.
      and m.estado_revision in ('auto', 'aceptado', 'modificado')
      and c.saldo <= 0.005
      and coalesce(c.fecha_vencimiento, c.fecha) >= p_desde
    group by c.id, c.razon_social_contraparte, c.tipo, c.moneda, c.monto,
             c.fecha_vencimiento, c.fecha
  )
  -- ⚠️ Se DICE que no se calculó. Devolver cero filas se leería como «no hay
  -- historial», que es una afirmación falsa y tranquilizadora.
  select 'no_calculado'::text, null::text, null::text, null::text, null::text,
         t.pares, null::numeric, null::integer, null::integer, null::date, null::numeric
    from tope t
   where t.pares > p_max_pares

  union all

  select
    'contraparte'::text,
    o.contraparte,
    max(o.ruc),
    o.tipo,
    o.moneda,
    count(*),
    -- ⚠️ MEDIANA, no media: un cliente que una vez pagó a 180 días desplazaría
    -- toda su previsión. La mediana describe lo que suele pasar, que es lo que
    -- se va a proyectar.
    percentile_cont(0.5) within group (order by o.retraso)::numeric,
    min(o.retraso)::integer,
    max(o.retraso)::integer,
    max(o.fecha_pago),
    sum(o.monto)::numeric
  from obs o
  group by o.contraparte, o.tipo, o.moneda

  union all

  -- La mediana de la empresa: el respaldo cuando una contraparte no tiene
  -- historial suficiente. Se calcula sobre las observaciones crudas, no
  -- promediando medianas — eso daría otro número.
  select
    'empresa'::text, null::text, null::text, o.tipo, o.moneda, count(*),
    percentile_cont(0.5) within group (order by o.retraso)::numeric,
    min(o.retraso)::integer, max(o.retraso)::integer,
    max(o.fecha_pago), sum(o.monto)::numeric
  from obs o
  group by o.tipo, o.moneda;
$$;

comment on function public.dias_pago_contraparte(date, integer) is
  'Cuántos días tarda de verdad cada contraparte en pagar, medido contra el '
  'extracto en conciliaciones APROBADAS. Devuelve hechos; la interpretación '
  'vive en src/lib/diasPago.ts. La empresa sale de auth.uid().';

revoke all on function public.dias_pago_contraparte(date, integer) from public, anon;
grant execute on function public.dias_pago_contraparte(date, integer) to authenticated, service_role;
