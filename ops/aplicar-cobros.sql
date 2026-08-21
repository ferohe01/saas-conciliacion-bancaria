-- ============================================================================
-- aplicar-cobros.sql — Terminar el reparto de cobros de una conciliación
--                      aprobada que se quedó a medias
--
-- ── Cuándo hace falta ───────────────────────────────────────────────────────
--
-- Aprobar son DOS escrituras: la transición contable y el reparto del saldo. La
-- primera puede salir bien con la segunda a cero, y entonces la pantalla dice:
--
--     «Esta conciliación rige, pero el saldo de tus comprobantes solo se
--      actualizó en parte: 0 de 448.070 cobros.»
--
-- ── Por qué la app no puede sola, y por qué esto sí ─────────────────────────
--
-- El botón «Reintentar la aplicación de cobros» va por PostgREST, cuyo rol lleva
-- `statement_timeout = 8 s`. Por eso la app escribe en lotes de 5.000: cada fila
-- de `aplicaciones_cobro` dispara `trg_saldo_comprobante`, que recalcula el
-- saldo de ese comprobante con dos subconsultas. Son ~2,7 s por lote, y 448.070
-- filas suman entre dos y cuatro minutos de trigger.
--
-- ⚠️⚠️ AQUÍ EL TRIGGER SE APAGA, y eso cambia el orden de magnitud: sin él, las
-- 448.070 aplicaciones entran de una sentencia, y el saldo se rehace DESPUÉS en
-- UNA pasada con la misma fórmula que usa el trigger. El resultado es idéntico
-- —es la misma aritmética— pero en vez de 448.070 UPDATE sueltos es uno.
--
-- Es la misma técnica que `ops/borrar-conciliaciones.sql`, y por el mismo
-- motivo: el trigger existe para mantener el saldo correcto cuando alguien
-- concilia UN cobro desde la aplicación. En una operación masiva sobre medio
-- millón de filas es puro trabajo tirado.
--
-- ── Dónde ejecutarlo ────────────────────────────────────────────────────────
--
--   · SQL Editor de Studio — pega el BLOQUE 2 y luego el BLOQUE 3, por
--     separado. Cada uno ronda la media escala de un minuto; juntos no caben.
--
--   · psql, si tienes acceso al VPS — de una sola vez, sin nada que corte:
--
--       docker ps --format '{{.Names}}' | grep -i db     ← el nombre real
--       docker exec -i <contenedor-db> \
--         psql -U supabase_admin -d postgres < aplicar-cobros.sql
--
--     (Dokploy tiene terminal web en cada servicio: sirve igual que un SSH.)
--
-- SI STUDIO DEVUELVE ESTO —no es un error de Postgres, es su propia UI:
--
--     [{ "code": "invalid_type", "path": ["code"], … },
--      { "code": "invalid_type", "path": ["formattedError"], … }]
--
-- la petición se cortó por tiempo del gateway y Studio no supo qué pintar. NO
-- dice si el trabajo se hizo. Ejecuta el BLOQUE 1, que vuelve al instante, y
-- mira los contadores antes de reintentar.
--
-- ⚠️ ESTO DESBLOQUEA, NO DIAGNOSTICA. Por qué falló el reparto la primera vez lo
-- dice el log de la app, con el prefijo `[cobranzas]` y el `code` de Postgres:
-- `57014` es tiempo agotado; cualquier otro es otra avería.
--
-- ⚠️ Y NO LO TERMINA TODO. `aplicar_cobros_exactos` solo toca los pares de la
-- capa EXACTA — son 1:1 y del mismo importe, así que el factor de reparto es 1.
-- Los pagos parciales, las agrupaciones 1:N y las diferencias absorbidas los
-- reparte `src/lib/cobranzas.ts`, que es puro y tiene tests. Cuando esto acabe,
-- pulsa **«Reintentar la aplicación de cobros»** en la pantalla: encontrará los
-- cientos de miles ya hechos y despachará esos pocos miles en un momento.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) QUÉ CONCILIACIÓN, Y CUÁNTO LE FALTA  (no escribe nada — vuelve al instante)
--
-- `pendientes` es lo que falta por aplicar. Sirve antes, para saber qué hay que
-- hacer, y después de un corte, para saber por dónde se quedó.
-- ---------------------------------------------------------------------------
select
  j.id,
  j.periodo_desde,
  j.periodo_hasta,
  j.estado_contable,
  (select count(*) from public.matches_conciliacion m
    where m.job_id = j.id
      and m.metodo = 'exacta'
      and m.estado_revision in ('auto', 'aceptado', 'modificado'))      as confirmados,
  (select count(*) from public.aplicaciones_cobro a
    where a.job_id = j.id)                                             as aplicados,
  (select count(*) from public.matches_conciliacion m
    where m.job_id = j.id
      and m.metodo = 'exacta'
      and m.estado_revision in ('auto', 'aceptado', 'modificado')
      and not exists (select 1 from public.aplicaciones_cobro a
                       where a.job_id = j.id
                         and a.comprobante_id = m.comprobante_ids[1])) as pendientes,
  (select count(*) from public.comprobantes c
    where c.empresa_id = j.empresa_id
      and c.estado in ('cobrado', 'parcial'))                          as comprobantes_con_saldo_descontado
from public.jobs_conciliacion j
where j.id = 'rec-2026-06-11e625';   -- ← el identificador del proceso


-- ---------------------------------------------------------------------------
-- 2) ESCRIBIR LOS COBROS, con el trigger apagado  (pega el bloque entero)
--
-- Reentrante: `aplicar_cobros_exactos` salta lo que este job ya aplicó y no
-- duplica (`on conflict do nothing`). Si se corta, se vuelve a lanzar.
--
-- ⚠️⚠️ AL ACABAR ESTE BLOQUE, EL SALDO ESTÁ MAL A PROPÓSITO. Hay 448.070 cobros
-- escritos y ni un comprobante marcado como cobrado, porque el trigger que lo
-- haría estaba apagado. Es un estado intermedio y **el bloque 3 es lo que lo
-- cierra**: no te vayas a media escalera. Mientras tanto, «Por cobrar» dirá que
-- te deben todo lo que ya se cobró.
--
-- El trigger se reactiva DENTRO de la misma transacción, así que no puede
-- quedarse apagado aunque esto se corte.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_job   text := 'rec-2026-06-11e625';   -- ← el identificador del proceso
  v_n     bigint;
  v_ini   timestamptz := clock_timestamp();
begin
  -- Retira lo que dejó de estar confirmado. En una aprobación recién hecha no
  -- borra nada, pero si alguien rechazó un par después, sin esto seguiría
  -- descontando saldo.
  perform public.limpiar_cobros_desconfirmados(v_job);

  alter table public.aplicaciones_cobro disable trigger trg_saldo_comprobante;

  -- Sin trigger, el lote deja de tener sentido: entran todas de una sentencia.
  -- El límite es un techo de seguridad, no una tanda.
  v_n := public.aplicar_cobros_exactos(v_job, 1000000);

  alter table public.aplicaciones_cobro enable trigger trg_saldo_comprobante;

  raise notice '── Cobros escritos: % en % ──', v_n, clock_timestamp() - v_ini;
  raise notice '   ⚠️  El saldo TODAVÍA no refleja esto. Ejecuta el bloque 3.';
end $$;

commit;

analyze public.aplicaciones_cobro;


-- ---------------------------------------------------------------------------
-- 2-BIS) SI EL BLOQUE 2 TAMPOCO CABE — a bocados, pulsando varias veces
--
-- Pega SOLO esto y dale a Run. Devuelve cuántas escribió; repite hasta que diga
-- 0. Con 448.070 pares son ~9 pulsaciones. Cada una tarda segundos, así que no
-- hay corte de proxy que valga.
--
-- ⚠️ Devuelve una fila a propósito. Un bloque `do` no devuelve nada, y una
-- respuesta vacía es justo lo que Studio no sabe pintar.
--
-- ⚠️ El trigger se apaga y se enciende DENTRO de cada pulsación, así que entre
-- una y otra queda encendido: si te vas a medias, no dejas la base sin su
-- guarda. Lo que sí queda a medias es el SALDO — eso lo cierra el bloque 3, y
-- hay que ejecutarlo igualmente al final.
-- ---------------------------------------------------------------------------
begin;
alter table public.aplicaciones_cobro disable trigger trg_saldo_comprobante;
select public.aplicar_cobros_exactos('rec-2026-06-11e625', 50000) as escritos;
alter table public.aplicaciones_cobro enable trigger trg_saldo_comprobante;
commit;


-- ---------------------------------------------------------------------------
-- 3) REHACER EL SALDO, de una pasada  (pega esto DESPUÉS del bloque 2)
--
-- Misma fórmula que `recalcular_saldo_comprobante` (0008/0016): el importe menos
-- lo aplicado más lo revertido. `estado` es una columna GENERADA a partir del
-- saldo, así que pasa sola a `cobrado`; y `anulado` manda sobre todo lo demás en
-- esa expresión, de modo que un comprobante anulado sigue anulado.
--
-- Idempotente: `is distinct from` deja fuera las filas que ya están bien, así
-- que reejecutarlo no reescribe nada. Si se cortó a medias, vuelve a pegarlo.
-- ---------------------------------------------------------------------------
with empresa as (
  select j.empresa_id as id
    from public.jobs_conciliacion j
   where j.id = 'rec-2026-06-11e625'      -- ← el identificador del proceso
),
aplicado as (
  select a.comprobante_id as id, sum(a.monto_aplicado) as m
    from public.aplicaciones_cobro a
    join public.comprobantes c on c.id = a.comprobante_id
   where c.empresa_id = (select id from empresa)
   group by 1
),
revertido as (
  select r.comprobante_id as id, sum(r.monto_revertido) as m
    from public.reversiones_cobro r
    join public.comprobantes c on c.id = r.comprobante_id
   where c.empresa_id = (select id from empresa)
   group by 1
),
nuevos as (
  select c.id,
         abs(c.monto) - coalesce(ap.m, 0) + coalesce(rv.m, 0) as saldo
    from public.comprobantes c
    left join aplicado  ap on ap.id = c.id
    left join revertido rv on rv.id = c.id
   where c.empresa_id = (select id from empresa)
     and c.monto is not null
)
update public.comprobantes c
   set saldo = n.saldo
  from nuevos n
 where c.id = n.id
   -- No reescribir la fila que ya está bien: `estado` es `generated stored` y
   -- cada UPDATE la recalcula.
   and c.saldo is distinct from n.saldo;

-- ⚠️ `comprobantes` se acaba de reescribir casi entera. Sin esto el planificador
-- sigue con las estadísticas de antes — la lección de la 0029/0030, y muerde
-- justo en la conciliación siguiente.
analyze public.comprobantes;


-- ---------------------------------------------------------------------------
-- 4) LA COMPROBACIÓN
--
-- `pendientes` a cero, `cobrados` cerca de `aplicados`, y ni un saldo negativo
-- ni un comprobante con más aplicado que su importe — las dos cosas que la 0015
-- aborta, comprobadas también desde fuera.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.matches_conciliacion m
    where m.job_id = 'rec-2026-06-11e625'
      and m.metodo = 'exacta'
      and m.estado_revision in ('auto', 'aceptado', 'modificado')
      and not exists (select 1 from public.aplicaciones_cobro a
                       where a.job_id = m.job_id
                         and a.comprobante_id = m.comprobante_ids[1]))  as pendientes_deberia_ser_0,
  (select count(*) from public.aplicaciones_cobro a
    where a.job_id = 'rec-2026-06-11e625')                              as aplicados,
  (select count(*) from public.comprobantes c
     join public.jobs_conciliacion j on j.id = 'rec-2026-06-11e625'
    where c.empresa_id = j.empresa_id and c.estado = 'cobrado')         as cobrados,
  (select count(*) from public.comprobantes c
     join public.jobs_conciliacion j on j.id = 'rec-2026-06-11e625'
    where c.empresa_id = j.empresa_id and c.saldo < 0)                  as saldo_negativo_deberia_ser_0;


-- ---------------------------------------------------------------------------
-- 5) SI VUELVE A FALLAR — la sonda aislada
--
-- Mide UN lote con el plan real. Es la regla de método de la 0049: cuando algo
-- se pasa de tiempo, `explain analyze` ANTES de la segunda hipótesis. Comparar
-- filas estimadas contra reales señala el nodo en un minuto; razonar sobre el
-- código costó cuatro rondas.
--
-- El `rollback` deja la base como estaba: aquí solo interesa el plan.
-- ---------------------------------------------------------------------------
-- begin;
-- explain (analyze, buffers, timing)
--   select public.aplicar_cobros_exactos('rec-2026-06-11e625', 5000);
-- rollback;
