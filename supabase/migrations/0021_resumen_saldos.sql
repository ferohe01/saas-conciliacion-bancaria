-- ============================================================================
-- 0021_resumen_saldos.sql — Agregar la antigüedad de deuda EN LA BASE
--
-- Por cobrar / Por pagar traían todas las filas pendientes y las sumaban en
-- Node. Con 452.309 comprobantes eso son ~453 peticiones paginadas de 1.000
-- filas: varios minutos para pintar una tabla de cinco columnas.
--
-- Y el resultado es diminuto: lo que la pantalla enseña es un total por
-- contraparte y tramo. Traer medio millón de filas para producir unas pocas
-- decenas es el trabajo puesto en el sitio equivocado.
--
-- ⚠️ ESTA FUNCIÓN DUPLICA REGLAS QUE VIVEN EN TypeScript:
--
--   · qué cuenta como deuda viva  → `cuentaComoPendiente` (src/lib/aging.ts)
--   · los tramos de antigüedad    → `tramoDe` + `diasVencido` (idem)
--   · la normalización del buscador → `normalizar` (src/lib/filtrosComprobantes.ts)
--
-- Si se separan, la pantalla enseñará totales que no corresponden a sus filas
-- y nadie sabrá cuál creer. Hay tests que fijan el lado TypeScript; al tocar
-- cualquiera de los tres hay que tocar esto.
-- ============================================================================

-- Para reproducir el `normalize("NFD") + quitar diacríticos` de JS.
create extension if not exists unaccent;

-- ---------------------------------------------------------------------------
-- resumen_saldos(tipo, tramo, solo_vencido, busca, hoy)
--
-- Devuelve una fila por (contraparte, tramo). SECURITY INVOKER —el modo por
-- defecto— para que RLS siga aplicando: cada empresa solo agrega lo suyo.
--
-- `p_hoy` es un parámetro y no `current_date` para que los tests puedan fijar
-- el día. Los tramos dependen de la fecha, y una función que solo se puede
-- probar "hoy" no se puede probar.
-- ---------------------------------------------------------------------------
create or replace function public.resumen_saldos(
  p_tipo         text,
  p_tramo        text default 'todos',
  p_solo_vencido boolean default false,
  p_busca        text default '',
  p_hoy          date default current_date
)
returns table (
  contraparte text,
  ruc         text,
  tramo       text,
  total       numeric,
  documentos  bigint
)
language sql
stable
-- ⚠️⚠️ SECURITY DEFINER: RLS NO se aplica dentro. El control de acceso es la
-- linea `c.empresa_id in (select ... where ue.usuario_id = auth.uid())` de mas
-- abajo, y esa linea ES la frontera de seguridad — quitarla filtraria los
-- saldos de unas empresas a otras.
--
-- No es una preferencia: medido contra los 452.309 comprobantes de un cliente
-- real, la misma agregacion tarda 187 ms sin RLS y 9.500 ms con ella, por
-- encima del statement_timeout de 8 s. El predicado de RLS es
-- `es_miembro(empresa_id)`, una funcion sobre una COLUMNA, asi que Postgres la
-- ejecuta una vez por fila. Aqui la pertenencia se resuelve UNA vez.
--
-- Mismo patron que `aprobar_conciliacion` (0013). La regla al tocar esto: la
-- funcion NUNCA acepta un empresa_id por parametro; la empresa sale siempre de
-- `auth.uid()`.
security definer
set search_path = public
as $$
  -- Las empresas del usuario, resueltas UNA vez. Esta CTE y el `in` de abajo
  -- son el control de acceso de la funcion (ver la nota de SECURITY DEFINER).
  with mias as (
    select ue.empresa_id
      from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  ),
  base as (
    select
      -- Mismo criterio que el TypeScript: sin nombre, un cubo único. Si cada
      -- factura sin identificar fuera su propia fila, la tabla sería inútil.
      coalesce(nullif(btrim(c.razon_social_contraparte), ''), 'Sin identificar') as contraparte,
      c.ruc_contraparte as ruc,
      c.saldo,
      -- diasVencido: se cuenta desde el vencimiento y, si no lo hay —muchas
      -- ventas son al contado—, desde la emisión.
      p_hoy - coalesce(c.fecha_vencimiento, c.fecha) as dias
    from public.comprobantes c
    -- ⚠️ FRONTERA DE SEGURIDAD. No tocar sin leer la nota de arriba.
    where c.empresa_id in (select m.empresa_id from mias m)
      and c.estado not in ('anulado', 'cobrado')
      -- Por debajo de medio céntimo no hay deuda que gestionar.
      and c.saldo > 0.005
      and case
            when p_tipo = 'pago' then c.tipo = 'pago'
            -- Un comprobante SIN tipo se cuenta como cobranza, igual que en el
            -- resto del sistema.
            else c.tipo is null or c.tipo = 'cobranza'
          end
      -- ⚠️ El buscador se aplica AQUI y no despues, con el corte barato
      -- delante. Calculando `unaccent(lower(...))` como columna se evaluaba
      -- para las 452.309 filas aunque nadie hubiera escrito nada en la caja:
      -- 9,2 s, por encima del statement_timeout de 8. Con el corte constante a
      -- la izquierda, sin busqueda no se llama a unaccent ni una vez.
      and (
        btrim(p_busca) = ''
        or unaccent(lower(
             coalesce(c.serie_numero, '') || ' ' ||
             coalesce(c.razon_social_contraparte, '') || ' ' ||
             coalesce(c.ruc_contraparte, '')
           )) like '%' || unaccent(lower(btrim(p_busca))) || '%'
      )
  ),
  clasificado as (
    select
      b.contraparte, b.ruc, b.saldo,
      case
        -- Sin fecha no se puede saber si venció: se trata como por vencer, que
        -- es lo prudente — no se reclama una deuda que quizá no lo esté.
        when b.dias is null or b.dias <= 0 then 'por_vencer'
        when b.dias <= 30 then 'd1_30'
        when b.dias <= 60 then 'd31_60'
        when b.dias <= 90 then 'd61_90'
        else 'd90_mas'
      end as tramo
    from base b
  )
  select
    c.contraparte,
    -- Determinista a propósito. El TypeScript tomaba el RUC del primer
    -- comprobante que veía; aquí manda el orden, que no depende del paginado.
    min(c.ruc) as ruc,
    c.tramo,
    sum(c.saldo)::numeric as total,
    count(*)::bigint as documentos
  from clasificado c
  where (p_tramo = 'todos' or c.tramo = p_tramo)
    -- "Vencido" es todo lo que ya pasó su fecha: cualquier tramo menos el
    -- primero, que es justamente el de lo que aún no vence.
    and (not p_solo_vencido or c.tramo <> 'por_vencer')
  group by c.contraparte, c.tramo;
$$;

-- ⚠️ Llamada con `service_role` (que salta RLS) devuelve VACÍO, porque
-- `auth.uid()` es nulo y no hay empresa que resolver. Es lo correcto para esta
-- función —la piden las pantallas en nombre del usuario— pero conviene saberlo
-- antes de depurarla desde un script con la clave de servicio.

comment on function public.resumen_saldos(text, text, boolean, text, date) is
  'Antigüedad de deuda agregada por contraparte y tramo. Reemplaza el traer '
  'medio millón de filas para sumarlas en la aplicación. SECURITY INVOKER: RLS '
  'sigue acotando por empresa.';

-- ⚠️ El REVOKE no sobra: Postgres concede EXECUTE a `public` por defecto en
-- cada función nueva, así que sin esto `anon` podría invocar una función
-- SECURITY DEFINER. Hoy no filtraría nada (sin `auth.uid()` no hay empresa que
-- resolver y devuelve vacío), pero dejar una puerta abierta que depende de que
-- el cuerpo se porte bien es exactamente lo que no se hace con `definer`.
-- Mismo cierre que las funciones de la 0013.
revoke all on function public.resumen_saldos(text, text, boolean, text, date)
  from public, anon;
grant execute on function public.resumen_saldos(text, text, boolean, text, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Índice de apoyo. La función escanea `comprobantes` filtrando por estado y
-- saldo, que es justo lo que aquí se acota. Parcial para que ocupe lo que la
-- deuda viva y no lo que la tabla entera: en una empresa con medio millón de
-- comprobantes casi todos acaban cobrados.
-- ---------------------------------------------------------------------------
create index if not exists idx_comprobantes_saldo_vivo
  on public.comprobantes (empresa_id, tipo)
  where estado not in ('anulado', 'cobrado') and saldo > 0.005;
