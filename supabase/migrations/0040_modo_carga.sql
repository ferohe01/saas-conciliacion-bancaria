-- ============================================================================
-- 0040_modo_carga.sql — Plantilla obligatoria salvo que la empresa diga otra cosa
--
-- El mapeo de columnas (0039) resolvió el caso de una recaudadora: 450.000
-- filas al mes que nadie va a transponer a una plantilla. Pero abrirlo a TODAS
-- las empresas tiene un coste que no se ve: una PyME que exporta cualquier
-- Excel y elige mal una columna no descubre el error al mapear, sino cuando la
-- conciliación da 0 % — y entonces culpa al sistema, no a su elección.
--
-- Para el caso normal, la plantilla es mejor producto: garantiza los datos
-- limpios y no exige entender la diferencia entre "número de documento" y
-- "referencia de operación", que es justo lo que más se confunde.
--
-- ⚠️ EL DISCRIMINADOR ES LA EMPRESA, NO EL ARCHIVO.
--
-- La tentación era abrir el mapeo "para archivos grandes". No sirve: la primera
-- prueba del flujo de la recaudadora se hizo con un archivo de 200 filas, que
-- una regla por tamaño habría bloqueado. Y una PyME que pasa de 4.900 a 5.100
-- filas cambiaría de flujo de un mes a otro sin entender por qué. Un umbral
-- convierte una decisión de producto en una lotería.
-- ============================================================================

alter table public.empresas
  add column if not exists modo_carga text not null default 'plantilla';

alter table public.empresas drop constraint if exists empresas_modo_carga_chk;
alter table public.empresas
  add constraint empresas_modo_carga_chk
  check (modo_carga in ('plantilla', 'archivo_propio'));

comment on column public.empresas.modo_carga is
  'Cómo carga sus comprobantes esta empresa. `plantilla` (por defecto) exige el '
  'formato de la plantilla; `archivo_propio` habilita el mapeo de columnas para '
  'quien exporta desde un ERP. Ver src/lib/modoCarga.ts.';

-- ---------------------------------------------------------------------------
-- ⚠️ EL GRANT NO ES OPCIONAL.
--
-- La 0005 revocó el UPDATE amplio sobre `empresas` y lo reconcede columna a
-- columna, así que toda columna nueva nace sin permiso de escritura. Sin esta
-- línea la pantalla de configuración fallaría al guardar sin decir por qué —ya
-- pasó con `criterios_conciliacion` (0019) y con `mapeo_comprobantes` (0039).
--
-- Se concede al usuario a propósito: quien de verdad exporta desde un ERP no
-- debería esperar a que alguien le active nada. Lo que evita que una PyME
-- acabe aquí por accidente no es el permiso, es que la opción vive en
-- Configuración y no en el flujo de carga.
--
-- Si algún día conviene que sea decisión comercial, basta con quitar este
-- grant: el resto del sistema no cambia.
-- ---------------------------------------------------------------------------
grant update (modo_carga) on public.empresas to authenticated;
