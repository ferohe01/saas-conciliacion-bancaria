-- ============================================================================
-- 0053_resumen_periodo_cierra.sql — Que la cuenta del Paso 1 cierre
--
-- `resumen_comprobantes_periodo` devolvía el total cargado y los que entran,
-- pero de las exclusiones solo contaba dos: los ya cobrados y los de otra
-- moneda. La tarjeta rellenaba el hueco con una frase fija —«el resto es de
-- otros períodos»— que se pintaba SIEMPRE que sobrara alguno.
--
-- ⚠️ Y era falsa en el caso más normal. Con el juego de pruebas de junio: 236
-- cargados, 233 entran, y los 3 que faltan son facturas en dólares fechadas el
-- 03, el 15 y el 24 de JUNIO. Ni una está fuera del período. La pantalla decía
-- a la vez «el resto es de otros períodos» y «3 están en otra moneda»: dos
-- explicaciones para las mismas tres filas, y la primera inventada.
--
-- Es exactamente el fallo que la 0043 documenta en la cascada de partidas: una
-- explicación que no cuadra es peor que ninguna, porque convierte una duda
-- concreta en desconfianza general. Y el remedio es el mismo: **contar cada
-- causa por separado** y, si aun así sobra algo, decir que no se sabe en vez de
-- atribuirlo a la primera causa a mano.
--
-- Faltaban dos contadores: los de fuera del período y los anulados (que no
-- entraban en ninguno de los tres que ya había).
-- ============================================================================

-- ⚠️ `create or replace` no puede cambiar la forma de salida de una función
-- (error 42P13, aprendido aplicando la 0041 a mitad de camino). Se suelta antes.
drop function if exists public.resumen_comprobantes_periodo(date, date, text);

create or replace function public.resumen_comprobantes_periodo(
  p_desde  date,
  p_hasta  date,
  p_moneda text default null
)
returns table (
  registros      bigint,
  suma           numeric,
  total_cargados bigint,
  ya_cobrados    bigint,
  otras_monedas  bigint,
  -- Cargados cuya fecha cae fuera del período que se va a conciliar. Es lo que
  -- la tarjeta decía sin haberlo contado nunca.
  fuera_periodo  bigint,
  -- Del período pero anulados. No entraban en ningún contador, así que se
  -- colaban dentro del «resto» y se anunciaban como de otro período.
  anulados       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with mias as (
    select ue.empresa_id
      from public.usuarios_empresa ue
     where ue.usuario_id = auth.uid()
  )
  select
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and (p_moneda is null or c.moneda = p_moneda)
    ),
    coalesce(sum(
      case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end
    ) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and (p_moneda is null or c.moneda = p_moneda)
    ), 0),
    count(*),
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado = 'cobrado'
    ),
    -- Los del período que quedan fuera SOLO por la moneda.
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and p_moneda is not null
        and c.moneda <> p_moneda
    ),
    -- ⚠️ `fecha` puede ser nula: un comprobante sin fecha no está «fuera del
    -- período», está sin fechar, y `between` con null no lo cuenta en ningún
    -- lado. Se agrupa aquí porque tampoco entra a conciliar, y es preferible a
    -- que desaparezca de la cuenta.
    count(*) filter (
      where c.fecha is null or c.fecha not between p_desde and p_hasta
    ),
    count(*) filter (
      where c.fecha between p_desde and p_hasta
        and c.estado = 'anulado'
    )
  from public.comprobantes c
  where c.empresa_id in (select empresa_id from mias);
$$;

comment on function public.resumen_comprobantes_periodo(date, date, text) is
  'Conteos y suma de comprobantes de un período para el Paso 1 del wizard. '
  'Cada exclusión se cuenta por su causa real para que la cuenta cierre.';

revoke all on function public.resumen_comprobantes_periodo(date, date, text)
  from public, anon;
grant execute on function public.resumen_comprobantes_periodo(date, date, text)
  to authenticated, service_role;
