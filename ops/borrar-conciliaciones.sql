-- ============================================================================
-- borrar-conciliaciones.sql — Dejar una empresa SIN conciliaciones, conservando
--                             los datos que ya tiene cargados
--
-- Hermano pequeño de `ops/limpiar-empresa.sql`. Aquel deja la empresa sin nada;
-- este borra **solo las conciliaciones** —los jobs y, en cascada, sus pares,
-- sus cobros aplicados y sus reversiones— y deja intactos los comprobantes y
-- los movimientos de extracto ya cargados.
--
-- Para qué sirve: volver a conciliar el mismo período sin recargar medio millón
-- de filas. Es lo que hace falta, por ejemplo, tras un cambio en el motor
-- (0054, el arrastre de pendientes): los datos son los mismos y lo que se
-- quiere medir es el resultado nuevo.
--
-- ⚠️⚠️ ESTO NO SE DESHACE. Las conciliaciones aprobadas desaparecen con sus
-- cobros. El único camino de vuelta es el backup (`ops/backup-supabase.sh`), y
-- **hoy los dumps solo viven en el VPS**: `RCLONE_REMOTE` está vacío. Antes de
-- ejecutar nada, comprueba que hay un dump reciente en /opt/backups/supabase.
-- ============================================================================


-- ============================================================================
-- 0) ⚠️⚠️ DÓNDE EJECUTARLO — Studio se queda corto a este volumen
--
-- Por la API de PostgREST no se puede: `statement_timeout = 8 s` y no puede
-- desactivar triggers. Quedan dos sitios, y a 450.000 filas NO dan lo mismo:
--
--   ✔ RECOMENDADO · psql dentro del VPS. Sin gateway HTTP delante, así que no
--     hay nada que pueda cortar a mitad. Todo en una transacción:
--
--       docker exec -i <contenedor-db> \
--         psql -U supabase_admin -d postgres < borrar-conciliaciones.sql
--
--   ⚠ SQL Editor de Studio. Vale, pero **por bloques**: el 2A y el 2B se pegan
--     por separado. Juntos se pasan del tiempo del gateway.
--
-- SI STUDIO DEVUELVE ESTO —y no es un error de Postgres, es su propia UI:
--
--     [{ "code": "invalid_type", "path": ["code"], … },
--      { "code": "invalid_type", "path": ["formattedError"], … }]
--
-- significa que la respuesta no llegó ni como resultado ni como error de
-- Postgres: la petición se cortó (tiempo del gateway) y Studio no supo qué
-- pintar. NO dice si el borrado ocurrió o no.
--
-- ⚠️ Y hay que averiguarlo antes de reintentar: si la conexión murió, Postgres
-- deshizo la transacción y no se borró NADA; si solo murió el gateway mientras
-- el servidor seguía, pudo confirmarse entera. Ejecuta el bloque 1 —es un
-- `select`, vuelve al instante— y compara. Los dos estados son consistentes;
-- lo que no vale es suponer cuál es.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) QUÉ EMPRESA Y QUÉ SE VA A BORRAR  (no borra nada — ejecútalo primero)
--
-- ⚠️ Comprueba el nombre y el RUC antes de seguir. Un id equivocado aquí borra
-- las conciliaciones de otro cliente y no hay vuelta atrás.
--
-- Las tres últimas columnas son lo que se CONSERVA. Si salieran en cero, es que
-- querías el otro script.
--
-- Sirve también DESPUÉS, para saber por dónde se quedó una ejecución cortada.
-- ---------------------------------------------------------------------------
select
  e.id     as empresa_id,
  e.nombre,
  e.ruc,
  (select count(*) from public.jobs_conciliacion j
    where j.empresa_id = e.id)                                   as conciliaciones,
  (select count(*) from public.jobs_conciliacion j
    where j.empresa_id = e.id and j.estado_contable = 'aprobada') as de_ellas_APROBADAS,
  (select count(*) from public.matches_conciliacion mc
    where mc.empresa_id = e.id)                                  as pares,
  (select count(*) from public.aplicaciones_cobro a
     join public.comprobantes c2 on c2.id = a.comprobante_id
    where c2.empresa_id = e.id)                                  as cobros_aplicados,
  (select count(*) from public.comprobantes c
    where c.empresa_id = e.id and c.estado in ('cobrado', 'parcial')) as comprobantes_con_saldo_descontado,
  -- Lo que NO se toca:
  (select count(*) from public.comprobantes c
    where c.empresa_id = e.id)                                   as comprobantes_que_se_CONSERVAN,
  (select count(*) from public.movimientos_extracto m
    where m.empresa_id = e.id)                                   as movimientos_que_se_CONSERVAN,
  (select count(*) from public.cuentas_bancarias cb
    where cb.empresa_id = e.id)                                  as cuentas_que_se_CONSERVAN
from public.empresas e
where e.nombre ilike '%WIN%'      -- ← ajusta si hace falta
order by e.nombre;


-- ---------------------------------------------------------------------------
-- 2A) BORRAR LAS CONCILIACIONES  (pega este bloque entero)
--
-- Re-ejecutable: si ya no queda ningún job, no hace nada.
--
-- ⚠️ Los triggers de saldo se desactivan durante el borrado, y no es un atajo
-- peligroso: `trg_saldo_comprobante` recalcula el saldo del comprobante cada
-- vez que se borra una fila de `aplicaciones_cobro`. Son 447.795 UPDATE fila a
-- fila para llegar exactamente al mismo sitio al que llega el 2B de una pasada.
-- Se reactivan DENTRO de la misma transacción, así que no pueden quedarse
-- apagados aunque esto se corte.
--
-- ⚠️⚠️ Al terminar este bloque los comprobantes siguen marcados `cobrado` SIN UN
-- SOLO COBRO DETRÁS. Es un estado intermedio, y el 2B es lo que lo cierra: no
-- te vayas a media escalera. Sin él, `pares_exactos` deja fuera lo cobrado y la
-- conciliación nueva no ofrecería ni una de esas facturas — un agujero
-- silencioso exactamente del tamaño de lo que acabas de borrar.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_empresa  uuid;
  v_borrados bigint;
begin
  -- ⚠️ PON AQUÍ EL ID EXACTO del bloque 1. Se resuelve por nombre para poder
  -- copiar y pegar, pero si hubiera dos empresas que casan, esto FALLA en vez
  -- de elegir una — que es lo que tiene que pasar.
  select e.id into strict v_empresa
    from public.empresas e
   where e.nombre ilike '%WIN%';   -- ← o: where e.id = '....'::uuid

  raise notice 'Borrando las conciliaciones de la empresa %', v_empresa;

  alter table public.aplicaciones_cobro disable trigger trg_saldo_comprobante;
  alter table public.reversiones_cobro  disable trigger trg_saldo_reversion;
  alter table public.reversiones_cobro  disable trigger trg_validar_reversion;

  -- Los jobs arrastran en cascada sus pares (0023), sus cobros aplicados (0008)
  -- y sus reversiones (0016). El extracto NO cuelga de ellos: `lote_extracto_id`
  -- apunta del job al lote, no al revés, así que los movimientos se quedan.
  delete from public.jobs_conciliacion where empresa_id = v_empresa;
  get diagnostics v_borrados = row_count;
  raise notice '  conciliaciones borradas: %', v_borrados;

  -- Por si quedara alguna aplicación de un job ya inexistente.
  delete from public.aplicaciones_cobro a
   using public.comprobantes c
   where c.id = a.comprobante_id and c.empresa_id = v_empresa;
  get diagnostics v_borrados = row_count;
  raise notice '  cobros huérfanos borrados: %', v_borrados;

  alter table public.aplicaciones_cobro enable trigger trg_saldo_comprobante;
  alter table public.reversiones_cobro  enable trigger trg_saldo_reversion;
  alter table public.reversiones_cobro  enable trigger trg_validar_reversion;
end $$;

commit;

analyze public.matches_conciliacion;
analyze public.aplicaciones_cobro;
analyze public.jobs_conciliacion;


-- ---------------------------------------------------------------------------
-- 2B) DEVOLVER EL SALDO  (pega este bloque entero, después del 2A)
--
-- El saldo se rehace **en bloque**, con la misma fórmula que usa el trigger. Es
-- una pasada sobre `comprobantes` en vez de 447.795 UPDATE sueltos.
--
-- `estado` es una columna GENERADA a partir del saldo (0008), así que no hay
-- que tocarla: vuelve sola a `pendiente`. Y `anulado` manda sobre todo lo demás
-- en esa expresión, de modo que un comprobante anulado sigue anulado.
--
-- Idempotente: `is distinct from` deja fuera las filas que ya están bien, así
-- que reejecutarlo no reescribe nada. Si se cortó a medias, vuelve a pegarlo.
-- ---------------------------------------------------------------------------
with empresa as (
  select e.id from public.empresas e where e.nombre ilike '%WIN%'
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
     -- Sin importe no hay saldo que calcular; el `estado` generado ya los trata
     -- como pendientes.
     and c.monto is not null
)
update public.comprobantes c
   set saldo = n.saldo
  from nuevos n
 where c.id = n.id
   -- No reescribir la fila que ya está bien: `estado` es `generated stored` y
   -- cada UPDATE la recalcula.
   and c.saldo is distinct from n.saldo;

-- ⚠️ `analyze` no es opcional: `comprobantes` se acaba de reescribir casi
-- entera y el planificador sigue con las estadísticas de antes. Es la lección
-- de la 0029/0030, y muerde justo en la conciliación siguiente. Va después del
-- `commit` para que mida el estado ya confirmado, no el de dentro de la
-- transacción.
analyze public.comprobantes;


-- ---------------------------------------------------------------------------
-- 3) LA COMPROBACIÓN
--
-- Las tres primeras a cero; comprobantes y movimientos, intactos; y
-- `OJO_deberia_ser_0` en cero — si quedara algo ahí, el 2B no llegó a correr y
-- la conciliación nueva no ofrecería esas facturas.
-- ---------------------------------------------------------------------------
select
  e.nombre,
  (select count(*) from public.jobs_conciliacion j
    where j.empresa_id = e.id)                          as conciliaciones,
  (select count(*) from public.matches_conciliacion mc
    where mc.empresa_id = e.id)                         as pares,
  (select count(*) from public.aplicaciones_cobro a
     join public.comprobantes c2 on c2.id = a.comprobante_id
    where c2.empresa_id = e.id)                         as cobros_aplicados,
  (select count(*) from public.comprobantes c
    where c.empresa_id = e.id)                          as comprobantes,
  (select count(*) from public.comprobantes c
    where c.empresa_id = e.id and c.estado = 'pendiente') as pendientes,
  (select count(*) from public.comprobantes c
    where c.empresa_id = e.id and c.estado in ('cobrado', 'parcial')) as OJO_deberia_ser_0,
  (select count(*) from public.movimientos_extracto m
    where m.empresa_id = e.id)                          as movimientos,
  (select count(*) from public.cuentas_bancarias cb
    where cb.empresa_id = e.id)                         as cuentas
from public.empresas e
where e.nombre ilike '%WIN%';


-- ---------------------------------------------------------------------------
-- 4) OPCIONAL — los lotes de extracto que quedan sueltos
--
-- El extracto se conserva a propósito, pero **la interfaz no sabe reutilizar un
-- lote**: el Paso 2 del wizard vuelve a importar el archivo y crea uno nuevo.
-- Los movimientos del lote viejo se quedan ahí sin que nadie los lea, igual que
-- los que deja cualquier intento de wizard abandonado.
--
-- ⚠️⚠️ EL FILTRO POR `origen` NO ES DECORATIVO. Un extracto subido desde /caja
-- para ver el saldo de hoy **nunca tiene job** —esa es su naturaleza, no un
-- descuido—, así que «lotes sin job» se lo llevaría por delante y /caja se
-- quedaría sin saldo vivo sin que nada lo explicara. Solo se borran los lotes
-- del wizard, y los anteriores a la 0051 (que no tienen ficha ninguna).
-- ---------------------------------------------------------------------------
-- with huerfanos as (
--   select distinct m.lote_id
--     from public.movimientos_extracto m
--     left join public.extractos_cargados e on e.lote_id = m.lote_id
--    where m.empresa_id = (select id from public.empresas where nombre ilike '%WIN%')
--      and coalesce(e.origen, 'wizard') = 'wizard'
--      and not exists (
--        select 1 from public.jobs_conciliacion j where j.lote_extracto_id = m.lote_id
--      )
-- )
-- delete from public.movimientos_extracto m
--  using huerfanos h
--  where m.lote_id = h.lote_id;
--
-- delete from public.extractos_cargados e
--  where e.empresa_id = (select id from public.empresas where nombre ilike '%WIN%')
--    and e.origen = 'wizard'
--    and not exists (
--      select 1 from public.movimientos_extracto m where m.lote_id = e.lote_id
--    );
--
-- analyze public.movimientos_extracto;
