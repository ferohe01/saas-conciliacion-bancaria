-- ============================================================================
-- 0011_saldo_inicial.sql — un comprobante nuevo nace con saldo = su importe
--
-- 0008 rellenó `saldo` para los comprobantes que ya existían, pero no dejó
-- forma de rellenarlo en los nuevos: el importador no lo escribe y la columna
-- no tenía DEFAULT. Resultado: todo comprobante cargado despues nacía con
-- `saldo` en NULL.
--
-- No se notaba a simple vista —la columna generada `estado` lo trata como
-- 'pendiente'— pero el aging filtra por `saldo > 0.005`, y NULL no pasa esa
-- comparación: las facturas pendientes DESAPARECÍAN de cuentas por cobrar.
--
-- Va como TRIGGER y no como DEFAULT porque un DEFAULT no puede referirse a
-- otra columna de la misma fila. Y va en la base y no en el código para que
-- cubra todos los caminos de entrada: la plantilla Excel, el XML que viene, y
-- cualquier carga manual.
-- ============================================================================

create or replace function public.saldo_inicial_comprobante()
returns trigger
language plpgsql
as $$
begin
  -- Solo al crear, y solo si no se indicó saldo explícitamente.
  if new.saldo is null then
    new.saldo := abs(coalesce(new.monto, 0));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_saldo_inicial on public.comprobantes;
create trigger trg_saldo_inicial
  before insert on public.comprobantes
  for each row execute function public.saldo_inicial_comprobante();

-- Los que ya nacieron sin saldo.
update public.comprobantes
   set saldo = abs(monto)
 where saldo is null and monto is not null;
