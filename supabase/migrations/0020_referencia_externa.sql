-- ============================================================================
-- 0020_referencia_externa.sql — Separar el NÚMERO DE DOCUMENTO de la
-- REFERENCIA DE EMPAREJAMIENTO
--
-- EL PROBLEMA, encontrado con datos reales de una recaudadora de telecom:
--
--   `serie_numero` hacía dos trabajos incompatibles a la vez. Es el número del
--   documento —único, y por eso lleva el índice de la `0018` que impide cargar
--   dos veces la misma factura— y ADEMÁS era lo que el motor usaba para casar
--   contra el extracto (`getComprobantesCanonicos` lo mapea a `referencia`).
--
--   En una cuenta recaudadora esos dos datos NO son el mismo:
--
--     Recibos   SR11-02748951, SR11-03590663   → único por documento
--     EFECTIVO  00000001300486                 → la operación bancaria, y se
--                                                REPITE cuando un cliente paga
--                                                dos recibos de una vez
--
--   Con un solo campo había que elegir: o el índice único rechazaba 509 de
--   20.000 filas (las que comparten operación), o el motor no podía casar por
--   referencia y 20.000 registros caían en las capas cuadráticas.
--
--   Justamente esos casos repetidos son la agrupación 1:N —dos recibos, un
--   depósito— que el motor ya sabe detectar. Perderlos en la importación era
--   perder exactamente lo que hay que conciliar.
--
-- LA SEPARACIÓN:
--
--   serie_numero        → identidad del documento. Único (índice de la 0018).
--   referencia_externa  → con qué casarlo en el banco. Se repite a propósito.
-- ============================================================================

alter table public.comprobantes
  add column if not exists referencia_externa text;

comment on column public.comprobantes.referencia_externa is
  'Referencia con la que el motor casa contra el extracto (codigo de operacion, '
  'numero de deposito). SE REPITE cuando varios comprobantes se pagan juntos: no '
  'lleva indice unico, a diferencia de serie_numero.';

-- Búsqueda por referencia al conciliar y al investigar un cobro.
create index if not exists comprobantes_referencia_externa_idx
  on public.comprobantes (empresa_id, referencia_externa)
  where referencia_externa is not null;

-- ---------------------------------------------------------------------------
-- PERMISOS POR COLUMNA — el mismo cierre de la 0008/0010.
--
-- `revoke update` + `grant update (...)` significa que **toda columna nueva
-- nace sin permiso de escritura**, así que hay que reconceder la lista entera
-- cada vez. Se mantiene fuera `saldo`: lo decide el trigger a partir de las
-- aplicaciones, nunca el usuario.
-- ---------------------------------------------------------------------------
revoke update on public.comprobantes from authenticated;
grant  update (fecha, fecha_vencimiento, monto, tipo, serie_numero,
               referencia_externa, ruc_contraparte, razon_social_contraparte,
               descripcion, anulado)
  on public.comprobantes to authenticated;

-- ---------------------------------------------------------------------------
-- Y el INSERT, que estaba sin cubrir.
--
-- La `0018` añadió `lote_importacion` sin tocar permisos y ese camino no se ha
-- ejercitado desde entonces: si el INSERT estuviera acotado por columna, la
-- importación fallaría con un error de permisos difícil de leer. Los GRANT son
-- aditivos, así que esto es inocuo si ya había permiso a nivel de tabla, y lo
-- arregla si no lo había.
-- ---------------------------------------------------------------------------
grant insert (empresa_id, fecha, fecha_vencimiento, monto, tipo, serie_numero,
              referencia_externa, ruc_contraparte, razon_social_contraparte,
              descripcion, origen, lote_importacion)
  on public.comprobantes to authenticated;
