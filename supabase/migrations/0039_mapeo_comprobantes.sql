-- ============================================================================
-- 0039_mapeo_comprobantes.sql — Recordar el formato del archivo del cliente
--
-- El sistema trataba los dos lados con criterios opuestos: al extracto del
-- banco se adapta él (mapeo, detección y memoria en
-- `cuentas_bancarias.mapeo_columnas`), y a los comprobantes se tenía que
-- adaptar el cliente, transponiendo su export a nuestra plantilla.
--
-- Con 450.000 filas al mes eso no es un esfuerzo de alta: es trabajo recurrente
-- que nadie repite el segundo mes. Esta columna es lo que convierte "transponer
-- cada mes" en "confirmar las columnas una vez".
--
-- Va en `empresas` y no en `cuentas_bancarias` porque **un comprobante no
-- pertenece a ninguna cuenta bancaria** — la misma razón por la que Por cobrar
-- y Por pagar no tienen filtro de cuenta. El formato es del sistema que factura,
-- no del banco.
-- ============================================================================

alter table public.empresas
  add column if not exists mapeo_comprobantes jsonb;

comment on column public.empresas.mapeo_comprobantes is
  'Qué columna del archivo del cliente corresponde a cada campo de comprobante, '
  'más el tipo fijo si su export no trae columna de tipo. Lo escribe la pantalla '
  'de Comprobantes al confirmar un mapeo. Ver src/lib/parsing/mapeoComprobantes.ts.';

-- ---------------------------------------------------------------------------
-- ⚠️ EL GRANT NO ES OPCIONAL.
--
-- La 0005 revocó el UPDATE amplio sobre `empresas` y lo reconcede columna a
-- columna, así que **toda columna nueva nace sin permiso de escritura**. Sin
-- esta línea, RLS deja pasar la fila y el GRANT la para: la pantalla falla al
-- guardar sin explicar por qué. Ya pasó con `criterios_conciliacion` (0019).
-- ---------------------------------------------------------------------------
grant update (mapeo_comprobantes) on public.empresas to authenticated;
