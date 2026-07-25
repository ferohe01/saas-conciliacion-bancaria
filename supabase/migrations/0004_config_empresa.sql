-- ============================================================================
-- 0004_config_empresa.sql — Configuración de tolerancias por empresa
--
-- Guarda la config de conciliación (tolerancias, umbral, banda IA) editable
-- desde la pantalla de configuración. Si es null, se usan los defaults del
-- contrato. RLS: la política empresas_update ya permite a los miembros editar.
-- ============================================================================

alter table public.empresas
  add column if not exists config_conciliacion jsonb;
