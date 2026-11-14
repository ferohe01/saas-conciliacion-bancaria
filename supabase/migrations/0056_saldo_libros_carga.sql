-- ============================================================================
-- 0056_saldo_libros_carga.sql — El saldo según libros sale del libro mayor
-- ============================================================================
--
-- El Paso 1 pedía teclear el «saldo según libros» aunque el archivo que el
-- cliente acaba de subir lo trae: un libro mayor lleva la columna `Saldo`, el
-- acumulado de la cuenta línea a línea, y el de la línea más reciente ES el
-- saldo en libros a esa fecha. La importación lo descartaba porque no es un
-- campo de ningún comprobante.
--
-- Se guarda en la FICHA DE LA CARGA, no en el wizard: los comprobantes se cargan
-- un día y se concilian otro, y un dato que solo viviera en la respuesta de la
-- importación desaparecería al recargar — justo lo que la 0043 vino a evitar
-- con los contadores.
--
-- ⚠️ `saldo_libros_fecha` no es decorativa: es la fecha de la línea de la que
-- sale el saldo, y es lo que permite proponerlo SOLO para el período que
-- cubre. Un saldo al 30/06 propuesto para conciliar julio sería un número
-- plausible y equivocado.
--
-- Re-ejecutable: `add column if not exists`.
-- ============================================================================

alter table public.importaciones_comprobantes
  add column if not exists saldo_libros       numeric(18, 2),
  add column if not exists saldo_libros_fecha date;

comment on column public.importaciones_comprobantes.saldo_libros is
  'Saldo acumulado de la línea más reciente del libro mayor cargado (columna '
  'Saldo). Null si el archivo no la trae.';
comment on column public.importaciones_comprobantes.saldo_libros_fecha is
  'Fecha de la línea de la que sale saldo_libros. Acota a qué período se propone.';
