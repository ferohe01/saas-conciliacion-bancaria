-- ============================================================================
-- 0010_fecha_vencimiento.sql — la fecha que el aging necesita
--
-- `comprobantes` solo tenía `fecha` (emisión). El aging —lo único que le
-- importa al dueño— se cuenta desde el VENCIMIENTO: una factura emitida hace
-- 60 días a 90 días de crédito no está vencida, y con solo la emisión lo
-- parecería.
--
-- Es nullable a propósito: muchos comprobantes son al contado y no tienen
-- vencimiento. Cuando falta, el aging usa `fecha` como referencia.
-- ============================================================================

alter table public.comprobantes
  add column if not exists fecha_vencimiento date;

create index if not exists idx_comprobantes_vencimiento
  on public.comprobantes (empresa_id, fecha_vencimiento)
  where fecha_vencimiento is not null;

-- El usuario administra este campo como el resto de la ficha del comprobante.
revoke update on public.comprobantes from authenticated;
grant  update (fecha, fecha_vencimiento, monto, tipo, serie_numero,
               ruc_contraparte, razon_social_contraparte, descripcion, anulado)
  on public.comprobantes to authenticated;
