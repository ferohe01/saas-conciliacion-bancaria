-- ============================================================================
-- reiniciar-conciliacion-win.sql — Volver a conciliar junio de WIN desde cero
--
-- Para pruebas y demostraciones. Borra las conciliaciones de
-- «WIN Telecomunicaciones - TEST» (con sus pares y sus cobros aplicados) y
-- devuelve los comprobantes a pendiente. CONSERVA los comprobantes cargados
-- (el libro mayor), así que no hace falta volver a subirlo: solo el extracto.
--
-- Es `ops/borrar-conciliaciones.sql` con el id de la empresa fijo.
--
-- ⚠️ NO SE DESHACE. Borra también las conciliaciones APROBADAS.
--
-- CÓMO EJECUTARLO
--   SQL Editor de Supabase Studio, cada bloque POR SEPARADO y EN ORDEN (1, 2
--   y 4 — el VACUUM, línea a línea). El 3 es la comprobación.
--   Por la API no se puede: corta a los 8 s y no permite apagar triggers.
--
--   Si Studio devuelve un error con `invalid_type` y `formattedError`, es su
--   gateway que se cortó por tiempo, NO un error de Postgres, y no dice si se
--   aplicó. No reintentes a ciegas: ejecuta el bloque 3 (vuelve al instante) y
--   mira qué quedó hecho. Ya pasó con el bloque 2 y se había aplicado entero.
--
-- DESPUÉS
--   - El lote del extracto de la corrida anterior queda sin uso (el wizard
--     importa el extracto otra vez y crea uno nuevo). No estorba; se puede
--     borrar con el bloque 4 de `ops/borrar-conciliaciones.sql`.
--   - En el wizard, elegir el período «Junio 2026»: abre por defecto en el mes
--     anterior al actual, y ahí los comprobantes de junio salen como
--     «pendientes de meses anteriores».
-- ============================================================================


-- ---------------------------------------------------------------------------
-- BLOQUE 1 — Borrar las conciliaciones, sus pares y sus cobros aplicados
-- ---------------------------------------------------------------------------
begin;
do $$
declare v uuid := '05dade93-3aaf-4a7e-bba0-d7d9e0859080'; n bigint;
begin
  alter table public.aplicaciones_cobro disable trigger trg_saldo_comprobante;
  alter table public.reversiones_cobro  disable trigger trg_saldo_reversion;
  alter table public.reversiones_cobro  disable trigger trg_validar_reversion;
  delete from public.jobs_conciliacion where empresa_id = v;
  get diagnostics n = row_count; raise notice 'conciliaciones borradas: %', n;
  delete from public.aplicaciones_cobro a using public.comprobantes c
   where c.id = a.comprobante_id and c.empresa_id = v;
  alter table public.aplicaciones_cobro enable trigger trg_saldo_comprobante;
  alter table public.reversiones_cobro  enable trigger trg_saldo_reversion;
  alter table public.reversiones_cobro  enable trigger trg_validar_reversion;
end $$;
commit;
analyze public.matches_conciliacion; analyze public.aplicaciones_cobro; analyze public.jobs_conciliacion;


-- ---------------------------------------------------------------------------
-- BLOQUE 2 — Devolver los saldos de los comprobantes a pendiente
--
-- Obligatorio después del 1: sin él los comprobantes siguen «cobrado» sin un
-- cobro detrás y la conciliación nueva no los ofrecería. Re-ejecutable.
-- ---------------------------------------------------------------------------
with ap as (select a.comprobante_id id, sum(a.monto_aplicado) m from public.aplicaciones_cobro a
              join public.comprobantes c on c.id = a.comprobante_id
             where c.empresa_id = '05dade93-3aaf-4a7e-bba0-d7d9e0859080' group by 1),
     rv as (select r.comprobante_id id, sum(r.monto_revertido) m from public.reversiones_cobro r
              join public.comprobantes c on c.id = r.comprobante_id
             where c.empresa_id = '05dade93-3aaf-4a7e-bba0-d7d9e0859080' group by 1),
     nuevos as (select c.id, abs(c.monto) - coalesce(ap.m,0) + coalesce(rv.m,0) saldo
                  from public.comprobantes c left join ap on ap.id = c.id left join rv on rv.id = c.id
                 where c.empresa_id = '05dade93-3aaf-4a7e-bba0-d7d9e0859080' and c.monto is not null)
update public.comprobantes c set saldo = n.saldo from nuevos n
 where c.id = n.id and c.saldo is distinct from n.saldo;
analyze public.comprobantes;


-- ---------------------------------------------------------------------------
-- BLOQUE 3 — Comprobación (solo lectura; se puede ejecutar cuando quieras)
--
-- Esperado tras los bloques 1 y 2: conciliaciones 0, pares 0, cobros 0,
-- cobrados 0, y todos los comprobantes (452.454) en pendiente.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.jobs_conciliacion
    where empresa_id = '05dade93-3aaf-4a7e-bba0-d7d9e0859080')                     as conciliaciones,
  (select count(*) from public.matches_conciliacion
    where empresa_id = '05dade93-3aaf-4a7e-bba0-d7d9e0859080')                     as pares,
  (select count(*) from public.aplicaciones_cobro a join public.comprobantes c on c.id = a.comprobante_id
    where c.empresa_id = '05dade93-3aaf-4a7e-bba0-d7d9e0859080')                   as cobros_aplicados,
  (select count(*) from public.comprobantes
    where empresa_id = '05dade93-3aaf-4a7e-bba0-d7d9e0859080')                     as comprobantes,
  (select count(*) from public.comprobantes
    where empresa_id = '05dade93-3aaf-4a7e-bba0-d7d9e0859080' and estado = 'pendiente') as pendientes,
  (select count(*) from public.comprobantes
    where empresa_id = '05dade93-3aaf-4a7e-bba0-d7d9e0859080'
      and estado in ('cobrado', 'parcial'))                                         as OJO_deberia_ser_0;


-- ---------------------------------------------------------------------------
-- BLOQUE 4 — VACUUM (después del 2, y después de borrar lotes de extracto)
--
-- ⚠️ No es opcional en este volumen. El bloque 2 reescribe los 452.454
-- comprobantes y el 1 borra ~900.000 pares y cobros; cada UPDATE/DELETE deja
-- la fila vieja muerta en la tabla hasta que pasa un VACUUM. La capa exacta
-- recorre las tablas enteras en CADA uno de sus trozos, así que con la basura
-- encima se pasa de los 8 s incluso partida en 32: falló así el 15/11/2026
-- («no pudo completarse ni troceada en 32 partes») con los mismos datos que
-- el día anterior habían conciliado en 99 s.
--
-- ⚠️ VACUUM no puede ir dentro de una transacción: ejecuta CADA LÍNEA SOLA en
-- el SQL Editor (selecciónala y pulsa Run). Si Studio se corta por tiempo,
-- repítela: es inofensivo.
-- ---------------------------------------------------------------------------
vacuum (analyze) public.comprobantes;
vacuum (analyze) public.movimientos_extracto;
vacuum (analyze) public.matches_conciliacion;
vacuum (analyze) public.aplicaciones_cobro;


-- ============================================================================
-- SALDOS PARA EL PASO 1 DEL WIZARD — Junio 2026, cuenta BCP 191-7349676-0-49
--
--   Saldo según libros (final) ....... 13886769.15   (S/ 13.886.769,15)
--       del libro mayor de WIN, línea más reciente: 30/06/2026. El Paso 1 lo
--       propone solo si el mayor se cargó con la versión que guarda el saldo.
--
--   Saldo extracto final ............. 13940958.44   (S/ 13.940.958,44)
--       «Saldo contable al 30/06/2026» del estado de cuenta corriente del BCP.
--       El reporte de recaudación no trae columna de saldo: hay que escribirlo.
--
--   (Saldo extracto inicial, si lo pide: 7217897.68 — saldo contable al
--    01/06/2026 del mismo estado de cuenta.)
-- ============================================================================
