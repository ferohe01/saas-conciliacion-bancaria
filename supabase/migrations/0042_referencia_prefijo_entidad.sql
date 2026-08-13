-- ============================================================================
-- 0042_referencia_prefijo_entidad.sql — El mismo recibo con y sin prefijo
--
-- ── El caso ────────────────────────────────────────────────────────────────
--
-- El mismo cobro aparece con dos códigos distintos según quién lo escriba:
--
--     mayor del cliente (ERP)  →  WIN-S001-11618954
--     extracto del banco       →      S001-11618954
--
-- Es LA MISMA operación. Como cadenas no lo son, así que `ref_norm` daba
-- `WINS00111618954` contra `S00111618954`, la capa exacta no las casaba, caían
-- al residuo —donde tampoco casaban— y terminaban en "sin conciliar" sin que
-- nada dijera por qué. Son 276 recibos del cliente grande, repartidos por todo
-- el mes, y en su extracto hay 559 movimientos con esa serie.
--
-- ── La regla ───────────────────────────────────────────────────────────────
--
-- Se descarta un PRIMER SEGMENTO HECHO SOLO DE LETRAS —el nombre de la entidad
-- que emite (`WIN-`)— y solo cuando lo que queda sigue pareciendo un código de
-- documento. Las tres condiciones tapan un falso positivo concreto:
--
--   · letras Y dígitos en el resto → `F001-123` no se queda en `123`, y `A-123`
--     y `B-123` no pasan a ser la misma referencia. Un número pelado no
--     identifica nada.
--   · ≥ 6 caracteres útiles → una clave corta colisiona con cualquier cosa.
--   · primer segmento sin dígitos → `SR11-02748951`, la serie normal de este
--     cliente (452.317 filas), NO se toca: `SR11` lleva números, así que no es
--     un nombre de entidad. Es la condición que deja intacto lo que ya
--     funcionaba.
--
-- ⚠️⚠️ **No puede romper un emparejamiento que antes funcionaba.** Es una
-- función aplicada a los dos lados por igual: si dos referencias eran iguales,
-- sus formas canónicas siguen siéndolo. Lo único que puede aparecer son pares
-- NUEVOS —los que colisionen al quitar el prefijo—, y siguen exigiendo además
-- el mismo importe al céntimo y su `row_number()` dentro del grupo.
--
-- ⚠️ La expresión tiene que ser EXACTAMENTE la de `normRef` en
-- `src/lib/normalizacion/referencia.ts` y la copiada en `n8n/01_exacta.js` y
-- `n8n/03a_agrupacion.js`. Si divergieran, un par casaría en SQL y no en el
-- motor —o al revés— y la diferencia sería invisible. Misma advertencia que la
-- 0029, que es donde nació esta columna.
--
-- ⚠️ Deliberadamente SIN lookahead (`(?=.)`) aunque la regex de Postgres lo
-- admita: con `ABC-` el resto queda vacío, no pasa el filtro de "letras y
-- dígitos" y se cae al valor original. Las guardas ya lo cubren, y una regex
-- que dice lo mismo en los tres lenguajes vale más que una más corta.
--
-- ⚠️ SE REESCRIBE LA TABLA ENTERA (`ref_norm` es `generated ... stored`), así
-- que con medio millón de comprobantes esto tarda. Va desde el SQL Editor de
-- Studio, que corre como superusuario y no tiene el `statement_timeout` de 8 s
-- de PostgREST. Al final hay `analyze`: una tabla recién reescrita deja al
-- planificador con estadísticas viejas, y por exactamente eso `residuo_internos`
-- se pasó del timeout tras la 0029.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- comprobantes.ref_norm
--
-- Drop + add EN UNA SOLA sentencia: separarlas son dos reescrituras de la
-- tabla. Al soltar la columna se van sus índices, así que se recrean debajo.
-- ---------------------------------------------------------------------------
alter table public.comprobantes
  drop column if exists ref_norm,
  add column ref_norm text
  generated always as (
    upper(regexp_replace(
      case
        when regexp_replace(
               btrim(coalesce(referencia_externa, serie_numero, '')),
               '^[A-Za-z]+[-_/ ]+', '')
             <> btrim(coalesce(referencia_externa, serie_numero, ''))
         and regexp_replace(
               btrim(coalesce(referencia_externa, serie_numero, '')),
               '^[A-Za-z]+[-_/ ]+', '') ~ '[A-Za-z]'
         and regexp_replace(
               btrim(coalesce(referencia_externa, serie_numero, '')),
               '^[A-Za-z]+[-_/ ]+', '') ~ '[0-9]'
         and length(regexp_replace(
               regexp_replace(
                 btrim(coalesce(referencia_externa, serie_numero, '')),
                 '^[A-Za-z]+[-_/ ]+', ''),
               '[^A-Za-z0-9]', '', 'g')) >= 6
        then regexp_replace(
               btrim(coalesce(referencia_externa, serie_numero, '')),
               '^[A-Za-z]+[-_/ ]+', '')
        else btrim(coalesce(referencia_externa, serie_numero, ''))
      end, '[^A-Za-z0-9]', '', 'g'))
  ) stored;

-- ---------------------------------------------------------------------------
-- movimientos_extracto.ref_norm — misma expresión, otra columna de origen.
-- ---------------------------------------------------------------------------
alter table public.movimientos_extracto
  drop column if exists ref_norm,
  add column ref_norm text
  generated always as (
    upper(regexp_replace(
      case
        when regexp_replace(
               btrim(coalesce(referencia_banco, '')),
               '^[A-Za-z]+[-_/ ]+', '')
             <> btrim(coalesce(referencia_banco, ''))
         and regexp_replace(
               btrim(coalesce(referencia_banco, '')),
               '^[A-Za-z]+[-_/ ]+', '') ~ '[A-Za-z]'
         and regexp_replace(
               btrim(coalesce(referencia_banco, '')),
               '^[A-Za-z]+[-_/ ]+', '') ~ '[0-9]'
         and length(regexp_replace(
               regexp_replace(
                 btrim(coalesce(referencia_banco, '')),
                 '^[A-Za-z]+[-_/ ]+', ''),
               '[^A-Za-z0-9]', '', 'g')) >= 6
        then regexp_replace(
               btrim(coalesce(referencia_banco, '')),
               '^[A-Za-z]+[-_/ ]+', '')
        else btrim(coalesce(referencia_banco, ''))
      end, '[^A-Za-z0-9]', '', 'g'))
  ) stored;

-- Los índices se fueron con la columna. Mismos que la 0029: parciales, porque
-- las filas sin referencia no participan del emparejamiento por código.
create index if not exists idx_comprobantes_ref_norm
  on public.comprobantes (empresa_id, ref_norm)
  where ref_norm <> '';

create index if not exists idx_mov_extracto_ref_norm
  on public.movimientos_extracto (lote_id, ref_norm)
  where ref_norm <> '';

comment on column public.comprobantes.ref_norm is
  'Referencia canónica para emparejar: mayúsculas, sin separadores y sin el '
  'prefijo de entidad (WIN-S001-11618954 → S00111618954). Misma regla que '
  'normRef en src/lib/normalizacion/referencia.ts y en n8n/01_exacta.js.';
comment on column public.movimientos_extracto.ref_norm is
  'Referencia del banco en forma canónica. Ver comprobantes.ref_norm.';

-- ⚠️ Obligatorio tras reescribir una tabla grande: el planificador decide con
-- estadísticas y las acaba de perder. Sin esto, la primera conciliación después
-- de la migración elige un plan pensado para otra tabla y se cancela a los 8 s.
analyze public.comprobantes;
analyze public.movimientos_extracto;
