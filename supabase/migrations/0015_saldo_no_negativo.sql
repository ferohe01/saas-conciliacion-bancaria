-- ============================================================================
-- 0015_saldo_no_negativo.sql — Que aplicar de más falle en voz alta
--
-- Tercera y última red del arreglo del doble descuento. Las otras dos viven en
-- la aplicación:
--
--   1. El wizard ya no ofrece como registros internos los comprobantes
--      saldados ni anulados.
--   2. `calcularAplicaciones` topa lo aplicado al saldo que le queda al
--      comprobante, descontando lo que aplicaron OTROS jobs.
--
-- Las dos se pueden esquivar: un script con `service_role`, un nodo de n8n mal
-- editado o un camino futuro que nadie previó escriben directo en
-- `aplicaciones_cobro` y el trigger recalcula sin preguntar.
--
-- EL PROBLEMA DE FONDO ERA EL PROPIO TRIGGER. La versión de la 0008 cerraba el
-- cálculo con `greatest(..., 0)`, así que aplicar 2000 sobre una factura de
-- 1000 no dejaba rastro: el saldo se quedaba en 0 y el comprobante figuraba
-- como cobrado, correcto a la vista, con el doble de aplicaciones detrás. Ese
-- clamp no protegía de nada; escondía el error justo donde se vería.
--
-- Aquí se quita el clamp y se añade la constraint que antes era imposible de
-- violar. A partir de ahora, aplicar de más aborta la escritura con un error
-- en vez de corromper la contabilidad en silencio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ¿Hay ya excesos escondidos por el clamp? Se avisa con nombres y apellidos
--    en lugar de fallar con un mensaje opaco al crear la constraint.
-- ---------------------------------------------------------------------------
do $$
declare
  v_malos int;
  v_detalle text;
begin
  select count(*), string_agg(x.serie_numero || ' (importe ' || x.importe ||
                              ', aplicado ' || x.aplicado || ')', '; ')
    into v_malos, v_detalle
    from (
      select c.serie_numero,
             abs(c.monto) as importe,
             sum(a.monto_aplicado) as aplicado
        from public.comprobantes c
        join public.aplicaciones_cobro a on a.comprobante_id = c.id
       group by c.id, c.serie_numero, c.monto
      having sum(a.monto_aplicado) > abs(c.monto) + 0.005
    ) x;

  if v_malos > 0 then
    raise exception
      'No se puede aplicar 0015: % comprobante(s) tienen mas aplicado que su '
      'importe: %. Son cobros duplicados que el clamp del trigger venia '
      'ocultando. Revisa `aplicaciones_cobro` por comprobante_id y elimina el '
      'exceso antes de volver a intentarlo.',
      v_malos, v_detalle;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. El trigger deja de disimular: el saldo dice lo que de verdad hay.
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_saldo_comprobante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comprobante uuid := coalesce(new.comprobante_id, old.comprobante_id);
begin
  -- Sin `greatest(..., 0)`: si lo aplicado supera al importe, el saldo sale
  -- negativo y la constraint de abajo aborta la operación. Es justo lo que se
  -- quiere — el error se ve en el momento y no meses después.
  update public.comprobantes c
     set saldo = abs(c.monto) - coalesce((
           select sum(a.monto_aplicado)
             from public.aplicaciones_cobro a
            where a.comprobante_id = v_comprobante
         ), 0)
   where c.id = v_comprobante;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. La red. Se permite exactamente 0 (factura cobrada del todo), nunca menos.
--    Los importes son numeric(14,2): no hay deriva de redondeo que justifique
--    un margen, así que si sale negativo es que se aplicó de más.
-- ---------------------------------------------------------------------------
alter table public.comprobantes
  drop constraint if exists comprobantes_saldo_no_negativo;

alter table public.comprobantes
  add constraint comprobantes_saldo_no_negativo
  check (saldo is null or saldo >= 0);

comment on constraint comprobantes_saldo_no_negativo on public.comprobantes is
  'Un comprobante no puede recibir mas cobros que su importe. Si esta '
  'constraint salta, se aplico dos veces el mismo documento: revisa '
  '`aplicaciones_cobro` por comprobante_id antes de tocar el saldo.';
