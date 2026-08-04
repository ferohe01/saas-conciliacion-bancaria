-- ============================================================================
-- 0018_comprobantes_sin_duplicados.sql — Que subir dos veces la plantilla no
-- duplique las facturas, y poder deshacer una carga.
--
-- `importarComprobantes` hacía `insert` a secas. Subir el mismo archivo dos
-- veces creaba dos juegos de comprobantes idénticos, y el daño no se queda en
-- una lista fea: cada copia lleva su propio `saldo`, así que la empresa
-- aparecía debiendo el doble en Por cobrar, y el wizard ofrecía dos veces la
-- misma factura como registro interno.
--
-- POR QUÉ LA CLAVE ES (empresa_id, tipo, serie_numero) Y NO EL MONTO:
--
--   Una factura se identifica por su serie y número; es lo que la hace única
--   para SUNAT y para el cliente. Deduplicar por (fecha, monto, contraparte)
--   fusionaría dos boletas legítimas del mismo cliente por el mismo importe el
--   mismo día — que en un negocio con precios fijos pasa todos los días.
--
--   `tipo` entra en la clave porque una cobranza y un pago pueden compartir
--   numeración: son documentos de emisores distintos.
--
-- POR QUÉ EL ÍNDICE ES PARCIAL:
--
--   `serie_numero` es opcional en la plantilla (hay ventas al contado sin
--   documento). Sin número no hay identidad que comparar, así que esas filas
--   quedan fuera del índice y se insertan siempre. La alternativa —inventarles
--   una clave— acabaría descartando ventas reales.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Lote de importación: qué comprobantes entraron juntos, para poder deshacer
-- esa carga sin tocar las demás. Nulo en todo lo cargado antes de esta
-- migración (no hay forma de reconstruirlo) y en lo que no venga de plantilla.
-- ---------------------------------------------------------------------------
alter table public.comprobantes
  add column if not exists lote_importacion uuid;

create index if not exists comprobantes_lote_idx
  on public.comprobantes (lote_importacion)
  where lote_importacion is not null;

comment on column public.comprobantes.lote_importacion is
  'Identifica los comprobantes subidos en una misma carga de plantilla, para poder deshacerla.';

-- ---------------------------------------------------------------------------
-- Limpieza de los duplicados que ya existen.
--
-- Se conserva el MÁS ANTIGUO de cada grupo: es el que pudo entrar en una
-- conciliación, y el que el usuario vio primero.
--
-- Solo se borran copias INTACTAS —sin cobros aplicados ni reversiones—. Una
-- copia con cobros detrás no es basura de una importación repetida: es parte de
-- una conciliación aprobada, y borrarla en una migración silenciosa sería
-- exactamente el tipo de daño que este proyecto evita.
-- ---------------------------------------------------------------------------
with ordenados as (
  select id,
         row_number() over (
           partition by empresa_id, tipo, upper(btrim(serie_numero))
           order by created_at, id
         ) as pos
    from public.comprobantes
   where serie_numero is not null
     and btrim(serie_numero) <> ''
)
delete from public.comprobantes c
 using ordenados o
 where c.id = o.id
   and o.pos > 1
   and not exists (select 1 from public.aplicaciones_cobro a where a.comprobante_id = c.id)
   and not exists (select 1 from public.reversiones_cobro r where r.comprobante_id = c.id);

-- Si tras la limpieza siguen quedando duplicados, es porque tienen cobros
-- detrás. Se aborta con un mensaje que dice qué hacer, en vez de dejar que
-- falle el índice con un error de Postgres que no orienta a nadie.
do $$
declare
  v_dups int;
begin
  select count(*) into v_dups from (
    select 1
      from public.comprobantes
     where serie_numero is not null and btrim(serie_numero) <> ''
     group by empresa_id, tipo, upper(btrim(serie_numero))
    having count(*) > 1
  ) x;

  if v_dups > 0 then
    raise exception
      'Quedan % series duplicadas con cobros aplicados. Revisa cual conservar '
      '(anula el cobro de la copia sobrante en /comprobantes) y vuelve a aplicar '
      'esta migracion.', v_dups
      using errcode = 'unique_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- La regla, en la base. La app además la comprueba antes de insertar para poder
-- decir "20 ya existían", pero el que manda es este índice: vale para cualquier
-- escritura, venga de la app, de n8n o de un psql.
-- ---------------------------------------------------------------------------
create unique index if not exists comprobantes_serie_unica
  on public.comprobantes (empresa_id, tipo, upper(btrim(serie_numero)))
  where serie_numero is not null and btrim(serie_numero) <> '';
