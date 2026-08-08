-- ============================================================================
-- 0032_resumen_ejecutivo.sql — Las cifras que mira quien decide
--
-- No es "otro reporte". Los reportes existentes responden "¿cómo fue la
-- conciliación?"; esto responde "¿cómo está la empresa?", que es otra pregunta
-- y la hace otra persona.
--
-- ⚠️ DOS RELOJES, y confundirlos hace mentir al número:
--
--   · Lo CONCILIADO pertenece a un período: cuánto se procesó en junio.
--   · Lo que te DEBEN es una foto de HOY: no tiene período, tiene antigüedad.
--
-- Un "por cobrar de junio" no significa nada — o son las facturas emitidas en
-- junio (que quizá ya se cobraron) o el saldo vivo (que no es de junio). La
-- función devuelve las dos cosas por separado y la pantalla lo dice con todas
-- las letras.
--
-- Se agrega EN LA BASE por lo de siempre: con 452.309 comprobantes, traerlos
-- para sumarlos en Node es lo que la parte B vino a eliminar.
-- ============================================================================

create or replace function public.resumen_ejecutivo(
  p_desde date,
  p_hasta date,
  p_hoy   date default current_date
)
returns table (
  -- ── Del período elegido ──────────────────────────────────────────────────
  conciliaciones        bigint,
  sin_aprobar           bigint,
  partidas              bigint,
  partidas_conciliadas  bigint,
  cobrado               numeric,
  pagado                numeric,
  diferencia_cuadre     numeric,
  -- ── Foto de hoy ──────────────────────────────────────────────────────────
  por_cobrar            numeric,
  por_cobrar_vencido    numeric,
  por_cobrar_docs       bigint,
  por_pagar             numeric,
  por_pagar_vencido     numeric,
  por_pagar_docs        bigint
)
language sql
stable
-- ⚠️ SECURITY DEFINER: RLS no aplica dentro, así que los `empresa_id in (...)`
-- de abajo SON el control de acceso. La empresa sale siempre de `auth.uid()`;
-- esta función nunca acepta un empresa_id por parámetro.
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  -- Solo lo APROBADO cuenta. Un borrador con decisiones confirmadas no mueve un
  -- céntimo, y presentarlo aquí como si contara sería el peor error posible en
  -- una pantalla de dirección.
  jobs as (
    select j.id, j.resultado
      from public.jobs_conciliacion j
     where j.empresa_id in (select empresa_id from mias)
       and j.estado = 'completado'
       and j.estado_contable = 'aprobada'
       and j.periodo_desde <= p_hasta
       and j.periodo_hasta >= p_desde
  ),
  -- Terminadas y sin aprobar: no suman, pero hay que decir que existen. Si no,
  -- parecería que ese trabajo se perdió.
  pendientes_aprobar as (
    select count(*) as n
      from public.jobs_conciliacion j
     where j.empresa_id in (select empresa_id from mias)
       and j.estado = 'completado'
       and j.estado_contable in ('borrador', 'en_proceso', 'observada')
       and j.periodo_desde <= p_hasta
       and j.periodo_hasta >= p_desde
  ),
  -- El dinero que de verdad se movió, por tipo de comprobante.
  movido as (
    select
      coalesce(sum(a.monto_aplicado) filter (where c.tipo <> 'pago'), 0) as cobrado,
      coalesce(sum(a.monto_aplicado) filter (where c.tipo = 'pago'), 0) as pagado
    from public.aplicaciones_cobro a
    join jobs on jobs.id = a.job_id
    join public.comprobantes c on c.id = a.comprobante_id
  ),
  -- Saldo vivo HOY, con su antigüedad. Mismo criterio que Por cobrar / Por
  -- pagar (`cuentaComoPendiente` en src/lib/aging.ts).
  saldos as (
    select
      coalesce(sum(c.saldo) filter (where c.tipo <> 'pago'), 0) as cobrar,
      coalesce(sum(c.saldo) filter (
        where c.tipo <> 'pago' and coalesce(c.fecha_vencimiento, c.fecha) < p_hoy
      ), 0) as cobrar_vencido,
      count(*) filter (where c.tipo <> 'pago') as cobrar_docs,
      coalesce(sum(c.saldo) filter (where c.tipo = 'pago'), 0) as pagar,
      coalesce(sum(c.saldo) filter (
        where c.tipo = 'pago' and coalesce(c.fecha_vencimiento, c.fecha) < p_hoy
      ), 0) as pagar_vencido,
      count(*) filter (where c.tipo = 'pago') as pagar_docs
    from public.comprobantes c
    where c.empresa_id in (select empresa_id from mias)
      and c.estado not in ('cobrado', 'anulado')
      and c.saldo > 0.005
  )
  select
    (select count(*) from jobs),
    (select n from pendientes_aprobar),
    coalesce((select sum((j.resultado->'resumen'->>'total_internos')::bigint
                       + (j.resultado->'resumen'->>'total_bancarios')::bigint) from jobs j), 0),
    coalesce((select sum((j.resultado->'resumen'->>'total_internos')::bigint
                       + (j.resultado->'resumen'->>'total_bancarios')::bigint
                       - (j.resultado->'resumen'->>'sin_conciliar_internos')::bigint
                       - (j.resultado->'resumen'->>'sin_conciliar_bancarios')::bigint) from jobs j), 0),
    (select cobrado from movido),
    (select pagado from movido),
    -- La suma de lo que quedó SIN EXPLICAR en cada cuadre. Es la cifra que le
    -- dice a un gerente si puede fiarse de sus saldos.
    coalesce((select sum((j.resultado->'cuadre'->>'diferencia')::numeric) from jobs j), 0),
    (select cobrar from saldos),
    (select cobrar_vencido from saldos),
    (select cobrar_docs from saldos),
    (select pagar from saldos),
    (select pagar_vencido from saldos),
    (select pagar_docs from saldos);
$$;

comment on function public.resumen_ejecutivo(date, date, date) is
  'Cifras consolidadas para dirección. Lo conciliado es del período; lo que te '
  'deben es una foto de hoy — son dos relojes distintos y la pantalla lo dice.';

revoke all on function public.resumen_ejecutivo(date, date, date) from public, anon;
grant execute on function public.resumen_ejecutivo(date, date, date)
  to authenticated, service_role;
