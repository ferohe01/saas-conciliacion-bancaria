-- ============================================================================
-- 0019_criterios_empresa.sql — Arranque en frío del aprendizaje
--
-- EL PROBLEMA: el aprendizaje se alimenta de decisiones humanas anteriores. Una
-- empresa nueva tiene CERO, justo durante los 30 días de prueba en que decide
-- si paga. El diferenciador del producto está vacío exactamente cuando se
-- evalúa el producto.
--
-- LA SALIDA: que declare su criterio en vez de esperar a que se deduzca. No es
-- lo mismo que una decisión real —es lo que dicen que hacen, no lo que hacen—,
-- y por eso viaja al prompt en una sección aparte y con otro nombre. Pero es
-- criterio DE ESA EMPRESA desde el primer día, que es justo lo que faltaba.
--
-- POR QUÉ UNA COLUMNA APARTE Y NO DENTRO DE `config_conciliacion`:
--
--   `config_conciliacion` son números que el motor consume como tolerancias
--   (`ConfigConciliacion` en el contrato zod, validado y con forma cerrada).
--   Esto son afirmaciones en lenguaje natural que acaban en un prompt. Meterlas
--   ahí obligaría a ensanchar un esquema estricto que ya viaja en cada payload,
--   y a que el motor heurístico —que no lee prompts— cargara con ellas.
-- ============================================================================

alter table public.empresas
  add column if not exists criterios_conciliacion jsonb not null default '[]'::jsonb;

comment on column public.empresas.criterios_conciliacion is
  'Codigos de criterio declarados por la empresa (ver src/lib/criteriosIniciales.ts). '
  'Semilla del aprendizaje mientras no hay decisiones humanas.';

-- ---------------------------------------------------------------------------
-- ⚠️ IMPRESCINDIBLE, Y FÁCIL DE OLVIDAR.
--
-- La `0005` revocó el UPDATE amplio sobre `empresas` y lo reconcedió columna a
-- columna (nombre, ruc, config_conciliacion) para que nadie se auto-active el
-- plan. Consecuencia: una columna nueva **nace sin permiso de escritura**, y la
-- pantalla fallaría al guardar sin decir por qué — RLS deja pasar la fila y es
-- el GRANT el que la para.
--
-- `plan` y `prueba_hasta` siguen fuera, que es el motivo de todo aquello.
-- ---------------------------------------------------------------------------
grant update (criterios_conciliacion) on public.empresas to authenticated;
