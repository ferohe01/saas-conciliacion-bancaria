-- ============================================================================
-- limpiar-empresa.sql — Dejar una empresa sin datos para una corrida limpia
--
-- Borra TODO lo transaccional de UNA empresa —comprobantes, extractos,
-- conciliaciones, cobros aplicados— y conserva lo que no querrías volver a
-- configurar: la propia empresa, sus usuarios, sus cuentas bancarias y sus
-- ajustes.
--
-- ⚠️⚠️ ESTO NO SE DESHACE. No hay papelera, no hay `undo`, y las conciliaciones
-- aprobadas desaparecen con sus cobros. El único camino de vuelta es el backup
-- (`ops/backup-supabase.sh`), y **hoy los dumps solo viven en el VPS**:
-- `RCLONE_REMOTE` está vacío. Antes de ejecutar nada, comprueba que hay un dump
-- reciente en /opt/backups/supabase.
--
-- ⚠️ SE EJECUTA DESDE EL SQL EDITOR DE STUDIO, y no es una preferencia: **por
-- la API no se puede**. El rol de PostgREST lleva `statement_timeout = 8s` y
-- además no puede desactivar triggers. Medido contra producción el 09/08/2026:
-- borrar por REST **200 filas** de `aplicaciones_cobro` filtrando por empresa se
-- cancela a los 8,7 s. No es el número de filas —lo caro es recorrer y ordenar
-- 447.795— así que bajar el lote no arregla nada. Studio corre como
-- superusuario, sin ese tope.
--
-- CÓMO SE USA: dos pasos. Pega el BLOQUE 1 y léelo —no borra nada, solo enseña
-- qué se llevaría y de qué empresa—. Si el nombre y el RUC son los correctos,
-- pega el BLOQUE 2 entero: borra, refresca estadísticas y comprueba.
--
-- Lo que había en WIN al medirlo (09/08/2026), para reconocer el bloque 1:
--   comprobantes 452.309 · movimientos 450.999 · conciliaciones 1 (junio,
--   APROBADA) · pares 447.795 · cobros aplicados 447.795 · cuentas 1 (se queda).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) QUÉ EMPRESA Y QUÉ SE VA A BORRAR  (no borra nada — ejecútalo primero)
--
-- ⚠️ Comprueba el nombre y el RUC antes de seguir. Un id equivocado aquí borra
-- los datos de otro cliente y no hay vuelta atrás.
-- ---------------------------------------------------------------------------
select
  e.id            as empresa_id,
  e.nombre,
  e.ruc,
  (select count(*) from public.comprobantes         c  where c.empresa_id = e.id) as comprobantes,
  (select count(*) from public.movimientos_extracto m  where m.empresa_id = e.id) as movimientos,
  (select count(*) from public.jobs_conciliacion    j  where j.empresa_id = e.id) as conciliaciones,
  (select count(*) from public.matches_conciliacion mc where mc.empresa_id = e.id) as pares,
  (select count(*) from public.aplicaciones_cobro   a
     join public.comprobantes c2 on c2.id = a.comprobante_id
    where c2.empresa_id = e.id) as cobros_aplicados,
  (select count(*) from public.cuentas_bancarias cb where cb.empresa_id = e.id) as cuentas_que_se_CONSERVAN
from public.empresas e
where e.nombre ilike '%WIN%'      -- ← ajusta si hace falta
order by e.nombre;


-- ---------------------------------------------------------------------------
-- 2) EL BORRADO  (pega este bloque entero, de aquí al final)
--
-- Sustituye el `where` del `select ... into` por el id exacto que devolvió el
-- bloque 1. Se hace todo en UNA transacción: si algo falla, no queda a medias.
--
-- ⚠️ Los triggers de saldo se desactivan durante el borrado, y esto NO es un
-- atajo peligroso: `trg_saldo_comprobante` recalcula el saldo del comprobante
-- cada vez que se borra una fila de `aplicaciones_cobro`, y aquí se están
-- borrando también los comprobantes. Son 447.795 recálculos para dejar en un
-- estado que nadie va a leer: minutos de trabajo tirado. Se reactivan dentro de
-- la misma transacción, así que no pueden quedarse apagados.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_empresa uuid;
  v_borrados bigint;
begin
  -- ⚠️ PON AQUÍ EL ID EXACTO del bloque 1. Se resuelve por nombre para poder
  -- copiar y pegar, pero si hubiera dos empresas que casan, esto FALLA en vez
  -- de elegir una — que es lo que tiene que pasar.
  select e.id into strict v_empresa
    from public.empresas e
   where e.nombre ilike '%WIN%';   -- ← o: where e.id = '....'::uuid

  -- Comprobado el 09/08/2026: el id de «WIN Telecomunicaciones - TEST» es
  -- 05dade93-3aaf-4a7e-bba0-d7d9e0859080, y el otro inquilino (Proinnovate,
  -- 031ae6cb-…) no casa con '%WIN%'. Si prefieres no fiarte del nombre,
  -- sustituye el where por el id y borra este raise.
  if v_empresa <> '05dade93-3aaf-4a7e-bba0-d7d9e0859080'::uuid then
    raise notice '⚠️  Ojo: la empresa resuelta NO es la WIN de agosto de 2026.';
  end if;

  raise notice 'Limpiando empresa %', v_empresa;

  alter table public.aplicaciones_cobro disable trigger trg_saldo_comprobante;
  alter table public.reversiones_cobro  disable trigger trg_saldo_reversion;
  alter table public.reversiones_cobro  disable trigger trg_validar_reversion;

  -- Las conciliaciones arrastran en cascada sus pares, sus cobros aplicados y
  -- sus reversiones (0008, 0016, 0023).
  delete from public.jobs_conciliacion where empresa_id = v_empresa;
  get diagnostics v_borrados = row_count;
  raise notice '  conciliaciones borradas: %', v_borrados;

  -- Por si quedara alguna aplicación de un job ya inexistente.
  delete from public.aplicaciones_cobro a
   using public.comprobantes c
   where c.id = a.comprobante_id and c.empresa_id = v_empresa;

  delete from public.movimientos_extracto where empresa_id = v_empresa;
  get diagnostics v_borrados = row_count;
  raise notice '  movimientos de extracto borrados: %', v_borrados;

  -- ⚠️ La FICHA de cada carga de extracto (0051). Igual que las fichas de
  -- importación de comprobantes, no es dato transaccional y por eso es fácil
  -- olvidarla — pero si sobrevive, `/caja` de una empresa recién vaciada
  -- anunciaría un «saldo según el banco» sacado de un lote cuyos movimientos ya
  -- no existen. Un número plausible sin nada detrás, que es la peor clase.
  delete from public.extractos_cargados where empresa_id = v_empresa;
  get diagnostics v_borrados = row_count;
  raise notice '  fichas de extracto borradas: %', v_borrados;

  delete from public.comprobantes where empresa_id = v_empresa;
  get diagnostics v_borrados = row_count;
  raise notice '  comprobantes borrados: %', v_borrados;

  -- ⚠️ Las FICHAS DE CARGA, que no son datos transaccionales y por eso es fácil
  -- olvidarlas. Alimentan la cascada «de tu archivo a la conciliación»
  -- (`origen_partidas`, 0043): si sobreviven, la siguiente conciliación de una
  -- empresa recién vaciada anuncia «las 8 cargas de este período · 1.584 filas
  -- leídas» sobre un archivo de 236 filas que se acaba de subir por primera vez.
  --
  -- Pasó: este script es anterior a la 0043 y nadie lo actualizó al crear la
  -- tabla. Regla para la próxima tabla nueva por empresa: o entra aquí, o entra
  -- en cascada desde una que ya esté.
  delete from public.importaciones_comprobantes where empresa_id = v_empresa;
  get diagnostics v_borrados = row_count;
  raise notice '  fichas de importación borradas: %', v_borrados;

  alter table public.aplicaciones_cobro enable trigger trg_saldo_comprobante;
  alter table public.reversiones_cobro  enable trigger trg_saldo_reversion;
  alter table public.reversiones_cobro  enable trigger trg_validar_reversion;
end $$;

commit;


-- ⚠️ Las estadísticas van FUERA de la transacción: `analyze` no puede correr
-- dentro de un bloque explícito. No es opcional — estas tablas acaban de perder
-- medio millón de filas y el planificador sigue creyendo que están llenas, así
-- que elegiría planes pensados para lo que ya no hay. Es la lección de la
-- 0029/0030 al revés: allí la tabla creció, aquí se vació, y el efecto es el
-- mismo.
analyze public.comprobantes;
analyze public.movimientos_extracto;
analyze public.matches_conciliacion;
analyze public.aplicaciones_cobro;
analyze public.jobs_conciliacion;

-- Y la comprobación: los cinco primeros a cero, las cuentas bancarias intactas.
select
  e.nombre,
  (select count(*) from public.comprobantes         c  where c.empresa_id = e.id) as comprobantes,
  (select count(*) from public.movimientos_extracto m  where m.empresa_id = e.id) as movimientos,
  (select count(*) from public.jobs_conciliacion    j  where j.empresa_id = e.id) as conciliaciones,
  (select count(*) from public.matches_conciliacion mc where mc.empresa_id = e.id) as pares,
  (select count(*) from public.extractos_cargados   ec where ec.empresa_id = e.id) as fichas_extracto,
  (select count(*) from public.cuentas_bancarias    cb where cb.empresa_id = e.id) as cuentas,
  e.modo_carga,
  (e.mapeo_comprobantes is not null) as tiene_formato_guardado
from public.empresas e
where e.nombre ilike '%WIN%';


-- ---------------------------------------------------------------------------
-- 3) OPCIONAL — empezar también sin la configuración de formatos
--
-- Lo de arriba CONSERVA el formato de columnas aprendido y el modo de carga,
-- que es lo que normalmente quieres: la corrida limpia es de datos, no de
-- ajustes, y volver a mapear nueve columnas no prueba nada.
--
-- Ejecuta esto solo si quieres reproducir la experiencia de un cliente nuevo
-- desde el primer clic.
-- ---------------------------------------------------------------------------
-- update public.empresas
--    set mapeo_comprobantes = null
--  where nombre ilike '%WIN%';

-- El mapeo del EXTRACTO vive en la cuenta, no en la empresa:
-- update public.cuentas_bancarias
--    set mapeo_columnas = null
--  where empresa_id = (select id from public.empresas where nombre ilike '%WIN%');

-- Y para volver a exigir la plantilla (deshace el modo «archivo propio»):
-- update public.empresas
--    set modo_carga = 'plantilla'
--  where nombre ilike '%WIN%';
