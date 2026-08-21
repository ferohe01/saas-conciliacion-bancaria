-- ============================================================================
-- 0054_arrastre_pendientes.sql — Un cobro que llega el mes siguiente también
--                                se concilia
--
-- ── El agujero ──────────────────────────────────────────────────────────────
--
-- Los comprobantes que entran a una conciliación se elegían por FECHA DE
-- EMISIÓN dentro del período. Con crédito a 30 días —lo normal— eso deja pares
-- que no se pueden conciliar en NINGÚN período:
--
--   Factura emitida el 25/06, cobrada el 28/07.
--     · en junio  el abono todavía no existe   → la factura queda suelta ✔ (es
--       un depósito en tránsito al 30/06, y eso es contabilidad correcta)
--     · en julio  la factura no entra al conjunto porque su fecha es de junio
--       → el abono del 28/07 no tiene con qué casar ✘
--
-- Y no se queda quieto: el comprobante conserva `saldo > 0` para siempre, el
-- movimiento queda «sin conciliar» para siempre, el cuadre arrastra la
-- diferencia y CRECE CADA MES, y `/cuando-pagan` no puede medir un solo retraso
-- real porque los únicos pares que ve son los del mismo día.
--
-- Se descubrió por ese último síntoma: los 271 documentos medidos daban todos
-- exactamente −30 días. Ver `docs/analisis-periodo-comprobantes.md`.
--
-- ⚠️ El rango libre NO es la salida. `jobs_una_aprobada_por_rango` (0012) impide
-- dos aprobadas solapadas, así que conciliar 01/06–31/07 con junio ya aprobado
-- degrada junio a `reemplazada` y BORRA SUS COBROS. O cierras mes a mes y
-- arrastras el agujero, o no cierras nunca los meses sueltos.
--
-- ── El arreglo ──────────────────────────────────────────────────────────────
--
-- El conjunto deja de ser «los emitidos en el período» y pasa a ser «los que
-- siguen pendientes y no son más viejos que N meses»:
--
--     antes    c.fecha between periodo_desde and periodo_hasta
--     después  c.fecha between arrastre_desde(empresa, periodo_desde)
--                          and periodo_hasta
--
-- ⚠️⚠️ EL LÍMITE SUPERIOR NO SE MUEVE. Solo baja el inferior. Un comprobante
-- POSTERIOR al período sigue fuera —no puede haberse cobrado antes de existir—
-- y el arrastre no puede meter en junio nada de julio.
--
-- `arrastre_meses` vive en el `config_conciliacion` que ya existe, por defecto
-- 12, y **cero devuelve exactamente el comportamiento de antes**. El tope acota
-- las dos cosas que crecen con la ventana: el volumen del cliente grande
-- (4.382 de residuo al mes son 52.000 al año) y la ventana de falsos positivos
-- —`referencia_externa` SE REPITE a propósito, así que un abono de julio podría
-- casar con un comprobante viejo de igual importe y misma referencia—.
--
-- ── Y se empareja por SALDO, no por importe ────────────────────────────────
--
-- Lo que el banco paga de una factura a medio cobrar es LO QUE QUEDA. Mientras
-- no se haya cobrado nada `saldo = monto`, así que para el 99 % de las filas no
-- cambia nada; pero un arrastrado con cobro parcial se ofrecía por su importe
-- entero y produciría un match que dice que se cobró todo. El dinero ya estaba
-- protegido por el tope de `aplicar_cobros_exactos`; el MATCH no lo estaba.
--
-- ⚠️ Esto solo puede AÑADIR pares, nunca quitar uno que hoy casa: donde
-- `saldo = monto` la expresión es idéntica. Mismo argumento que la 0042.
--
-- ── Qué se toca, y por qué todo a la vez ───────────────────────────────────
--
-- El filtro estaba escrito en siete sitios y los siete decían lo mismo. Si se
-- cambiara solo el del motor, la pantalla dejaría de contar lo que el motor
-- concilia — que es justo lo que el Paso 1 promete y lo que la cascada de la
-- 0043 existe para demostrar.
--
--     pares_exactos / conciliar_exacta    qué casa la capa exacta en SQL
--     residuo_internos                    qué viaja a n8n
--     resumen_comprobantes_periodo        el recuento del Paso 1
--     origen_partidas                     la cascada archivo → conciliación
--     diagnostico_previo                  la estimación del Paso 3
--     residuo_series / residuo_explicado  de qué es el residuo que quedó
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) Desde cuándo se arrastra
--
-- Una sola definición de la ventana. Con siete llamantes, dos definiciones
-- serían siete oportunidades de que la pantalla y el motor discrepen — el mismo
-- riesgo que la 0037 eliminó extrayendo `pares_exactos`.
--
-- ⚠️ NO es `security definer`, y por eso puede aceptar `p_empresa_id`: las
-- funciones que invoca el navegador resuelven la empresa desde `auth.uid()`
-- (un parámetro sería un `?empresa_id=` en manos de cualquiera). Esta se llama
-- SIEMPRE desde dentro de una función que ya resolvió la empresa, así que hereda
-- sus privilegios y no abre ninguna puerta.
-- ---------------------------------------------------------------------------
create or replace function public.arrastre_desde(
  p_empresa_id uuid,
  p_desde      date
)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_txt   text;
  -- Mismo defecto que CONFIG_CONCILIACION_DEFAULT en src/lib/contract/config.ts.
  v_meses integer := 12;
begin
  select e.config_conciliacion ->> 'arrastre_meses'
    into v_txt
    from public.empresas e
   where e.id = p_empresa_id;

  -- ⚠️ Un valor escrito a mano en el JSONB no puede tumbar la capa exacta: si no
  -- es un entero razonable se usa el defecto en vez de reventar el cast. El zod
  -- de /configuracion ya valida, pero esta función corre en el camino de
  -- 450.000 filas y ahí no se confía en que nadie haya tocado la base.
  if v_txt is not null and v_txt ~ '^[0-9]{1,3}$' then
    v_meses := v_txt::integer;
  end if;

  -- Cero = arrastre desactivado. Devuelve EXACTAMENTE el comportamiento previo
  -- a esta migración, que es lo que hace reversible el cambio sin desplegar.
  if v_meses <= 0 then
    return p_desde;
  end if;
  if v_meses > 120 then
    v_meses := 120;
  end if;

  return (p_desde - (v_meses || ' months')::interval)::date;
end;
$$;

comment on function public.arrastre_desde(uuid, date) is
  'Desde qué fecha entran los comprobantes pendientes de meses anteriores. '
  'Una sola definición de la ventana para los siete sitios que la usan.';

revoke all on function public.arrastre_desde(uuid, date)
  from public, anon, authenticated;
grant execute on function public.arrastre_desde(uuid, date) to service_role;


-- ---------------------------------------------------------------------------
-- 2) El importe que queda por cobrar, con su signo
--
-- `immutable` y de una sola sentencia a propósito: así Postgres la INCRUSTA y
-- no hay una llamada a función por cada una de las 450.000 filas. Es la lección
-- de la 0021 (`es_miembro` por fila costaba 50×), aplicada por adelantado.
--
-- ⚠️ `coalesce(saldo, monto)`: el trigger de la 0011 rellena `saldo` al insertar,
-- pero una fila anterior a aquella migración puede traerlo nulo, y nulo no es
-- cero. Sin el coalesce esas filas dejarían de casar — un arreglo que rompe lo
-- que ya funcionaba.
-- ---------------------------------------------------------------------------
create or replace function public.importe_pendiente(
  p_tipo  text,
  p_monto numeric,
  p_saldo numeric
)
returns numeric
language sql
immutable
as $$
  select case
           when p_tipo = 'pago' then -abs(coalesce(p_saldo, p_monto))
           else                       abs(coalesce(p_saldo, p_monto))
         end
$$;

comment on function public.importe_pendiente(text, numeric, numeric) is
  'Lo que queda por cobrar/pagar de un comprobante, firmado con la convención '
  'única del sistema (entradas +, salidas −).';


-- ---------------------------------------------------------------------------
-- 3) La capa exacta empareja por saldo
--
-- ⚠️ La firma NO cambia: la ventana la decide quien llama (`conciliar_exacta`,
-- `diagnostico_previo`), que es quien conoce la empresa. Así esta función sigue
-- siendo la misma sentencia compartida por el motor y por la estimación del
-- Paso 3 — con dos definiciones, el Paso 3 prometería una cobertura que el
-- motor luego no da y nadie lo notaría.
--
-- ⚠️ Sigue SIN `security definer` y SIN `set search_path`: las dos cosas
-- impiden que el planificador la incruste, y está en el camino que empareja
-- medio millón de filas. Todo va calificado con `public.`.
-- ---------------------------------------------------------------------------
create or replace function public.pares_exactos(
  p_empresa_id uuid,
  p_lote_id    uuid,
  p_desde      date,
  p_hasta      date,
  p_moneda     text,
  p_bloque     integer default 0,
  p_bloques    integer default 1
)
returns table (comprobante_id uuid, movimiento_id uuid)
language sql
stable
as $$
  with ci as (
    select
      c.id,
      round(public.importe_pendiente(c.tipo, c.monto, c.saldo) * 100)::bigint as cent,
      c.ref_norm as ref,
      row_number() over (
        partition by round(public.importe_pendiente(c.tipo, c.monto, c.saldo) * 100),
                     c.ref_norm
        order by c.id
      ) as n
    from public.comprobantes c
    where c.empresa_id = p_empresa_id
      -- ⚠️ El límite superior NO se mueve nunca: un comprobante posterior al
      -- período no puede haberse cobrado antes de existir. Quien abre la
      -- ventana por abajo es el llamante, con `arrastre_desde`.
      and c.fecha between p_desde and p_hasta
      and c.estado not in ('cobrado', 'anulado')
      and c.ref_norm <> ''
      -- ⚠️ La guarda contra el par falso: 200 USD y S/ 200,00 comparten
      -- número, y sin esta línea la capa exacta los casa y lo marca `auto`.
      and c.moneda = p_moneda
      and (p_bloques = 1 or mod(abs(hashtext(c.ref_norm)), p_bloques) = p_bloque)
  ),
  mi as (
    select
      m.id,
      round(m.monto * 100)::bigint as cent,
      m.ref_norm as ref,
      row_number() over (
        partition by round(m.monto * 100), m.ref_norm order by m.id
      ) as n
    from public.movimientos_extracto m
    where m.lote_id = p_lote_id
      and m.ref_norm <> ''
      and (p_bloques = 1 or mod(abs(hashtext(m.ref_norm)), p_bloques) = p_bloque)
  )
  select ci.id, mi.id
    from ci
    join mi on ci.cent = mi.cent and ci.ref = mi.ref and ci.n = mi.n
$$;

revoke all on function public.pares_exactos(uuid, uuid, date, date, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.pares_exactos(uuid, uuid, date, date, text, integer, integer)
  to service_role;


-- ---------------------------------------------------------------------------
-- 4) `conciliar_exacta` abre la ventana
-- ---------------------------------------------------------------------------
create or replace function public.conciliar_exacta(
  p_job_id  text,
  p_bloque  integer default 0,
  p_bloques integer default 1
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job    public.jobs_conciliacion%rowtype;
  v_moneda text;
  v_desde  date;
  v_pares  bigint;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;
  if v_job.lote_extracto_id is null then
    raise exception 'El job % no tiene extracto cargado en tabla', p_job_id
      using errcode = 'check_violation';
  end if;

  select cb.moneda into v_moneda
    from public.cuentas_bancarias cb
   where cb.id = v_job.cuenta_id;
  v_moneda := coalesce(v_moneda, 'PEN');

  v_desde := public.arrastre_desde(v_job.empresa_id, v_job.periodo_desde);

  with pares as (
    insert into public.matches_conciliacion (
      job_id, empresa_id, comprobante_ids, movimiento_ids,
      metodo, estado_revision, diferencia_monto
    )
    select
      p_job_id, v_job.empresa_id, array[p.comprobante_id], array[p.movimiento_id],
      'exacta', 'auto', 0
    from public.pares_exactos(
      v_job.empresa_id, v_job.lote_extracto_id,
      v_desde, v_job.periodo_hasta, v_moneda,
      p_bloque, p_bloques
    ) p
    returning 1
  )
  select count(*) into v_pares from pares;

  return v_pares;
end;
$$;

revoke all on function public.conciliar_exacta(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.conciliar_exacta(text, integer, integer)
  to service_role;


-- ---------------------------------------------------------------------------
-- 5) El residuo que va a n8n arrastra igual, y con el saldo
--
-- Si el motor de n8n recibiera solo los del período, sus capas difusa, de
-- agrupación e IA volverían a dejar fuera exactamente los pares que la exacta
-- acaba de poder ver. El arrastre tiene que llegar entero a las cinco capas.
-- ---------------------------------------------------------------------------
create or replace function public.residuo_internos(p_job_id text)
returns table (
  comprobante_id uuid,
  fecha          date,
  monto          numeric,
  tipo           text,
  referencia     text,
  contraparte    text,
  descripcion    text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job    public.jobs_conciliacion%rowtype;
  v_moneda text;
  v_desde  date;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;

  select cb.moneda into v_moneda
    from public.cuentas_bancarias cb
   where cb.id = v_job.cuenta_id;
  v_moneda := coalesce(v_moneda, 'PEN');

  v_desde := public.arrastre_desde(v_job.empresa_id, v_job.periodo_desde);

  return query
  with casados as materialized (
    select unnest(m.comprobante_ids) as id
      from public.matches_conciliacion m
     where m.job_id = p_job_id
  )
  select
    c.id,
    c.fecha,
    public.importe_pendiente(c.tipo, c.monto, c.saldo),
    c.tipo,
    coalesce(nullif(c.referencia_externa, ''), c.serie_numero, ''),
    coalesce(c.razon_social_contraparte, ''),
    coalesce(c.descripcion, '')
  from public.comprobantes c
  where c.empresa_id = v_job.empresa_id
    and c.fecha between v_desde and v_job.periodo_hasta
    and c.estado not in ('cobrado', 'anulado')
    and c.moneda = v_moneda
    and not exists (select 1 from casados k where k.id = c.id)
  order by c.fecha, c.id;
end;
$$;

revoke all on function public.residuo_internos(text) from public, anon, authenticated;
grant execute on function public.residuo_internos(text) to service_role;


-- ---------------------------------------------------------------------------
-- 6) El recuento del Paso 1 cuenta lo mismo que el motor, y DICE qué arrastró
--
-- ⚠️ Sin la línea que lo nombra, el usuario ve un número que no reconoce —281
-- donde su archivo tiene 233— y lo primero que piensa es que el sistema duplicó
-- algo. Mismo criterio que las exclusiones de la 0053: cada partida nombrada
-- por lo que es.
--
-- `arrastrados` NO es una exclusión: es un SUBCONJUNTO de `registros`. La
-- cuenta que tiene que cerrar sigue siendo
--   total_cargados = registros + ya_cobrados + anulados + otras_monedas
--                    + fuera_periodo
-- ---------------------------------------------------------------------------
-- `create or replace` no puede cambiar la forma de salida (42P13, aprendido
-- aplicando la 0041 a mitad de camino). Se suelta antes.
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
  fuera_periodo  bigint,
  anulados       bigint,
  -- De los `registros`, cuántos vienen de meses anteriores por seguir
  -- pendientes. Cero cuando el arrastre está desactivado.
  arrastrados    bigint
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
  ),
  -- La ventana efectiva. `min` porque en la práctica hay una sola empresa por
  -- usuario; si hubiera varias, la más amplia es la que no deja nada fuera.
  ventana as (
    select coalesce(min(public.arrastre_desde(m.empresa_id, p_desde)), p_desde)
             as desde
      from mias m
  )
  select
    count(*) filter (
      where c.fecha between v.desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and (p_moneda is null or c.moneda = p_moneda)
    ),
    coalesce(sum(
      public.importe_pendiente(c.tipo, c.monto, c.saldo)
    ) filter (
      where c.fecha between v.desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and (p_moneda is null or c.moneda = p_moneda)
    ), 0),
    count(*),
    count(*) filter (
      where c.fecha between v.desde and p_hasta
        and c.estado = 'cobrado'
    ),
    -- Los de la ventana que quedan fuera SOLO por la moneda.
    count(*) filter (
      where c.fecha between v.desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and p_moneda is not null
        and c.moneda <> p_moneda
    ),
    -- ⚠️ `fecha` puede ser nula: un comprobante sin fecha no está «fuera del
    -- período», está sin fechar, y `between` con null no lo cuenta en ningún
    -- lado. Se agrupa aquí porque tampoco entra a conciliar, y es preferible a
    -- que desaparezca de la cuenta.
    count(*) filter (
      where c.fecha is null or c.fecha not between v.desde and p_hasta
    ),
    count(*) filter (
      where c.fecha between v.desde and p_hasta
        and c.estado = 'anulado'
    ),
    count(*) filter (
      where c.fecha between v.desde and p_desde - 1
        and c.estado not in ('cobrado', 'anulado')
        and (p_moneda is null or c.moneda = p_moneda)
    )
  from public.comprobantes c
  cross join ventana v
  where c.empresa_id in (select empresa_id from mias);
$$;

comment on function public.resumen_comprobantes_periodo(date, date, text) is
  'Conteos y suma de comprobantes de un período para el Paso 1 del wizard. '
  'Incluye los pendientes arrastrados de meses anteriores (0054) y cuenta cada '
  'exclusión por su causa real para que la cuenta cierre.';

revoke all on function public.resumen_comprobantes_periodo(date, date, text)
  from public, anon;
grant execute on function public.resumen_comprobantes_periodo(date, date, text)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7) La cascada del origen, con el arrastre dentro
--
-- ⚠️⚠️ Las CARGAS que se miran también se amplían. Sin eso, conciliar julio con
-- arrastre contaría los comprobantes de junio como internos —los cuenta el
-- motor— pero no la carga que los trajo, y la cascada cerraría con una línea
-- «sin explicar» del tamaño del arrastre. La foto tiene que abarcar lo mismo
-- que el motor o deja de ser una explicación.
-- ---------------------------------------------------------------------------
drop function if exists public.origen_partidas(uuid, date, date, text);

create or replace function public.origen_partidas(
  p_empresa_id uuid,
  p_desde      date,
  p_hasta      date,
  p_moneda     text default null
)
returns table (
  alcance            text,
  cargas             bigint,
  archivo_filas      bigint,
  archivo_repetidas  bigint,
  archivo_invalidas  bigint,
  archivo_existentes bigint,
  archivo_insertados bigint,
  cargados           bigint,
  fuera_periodo      bigint,
  ya_cobrados        bigint,
  otra_moneda        bigint,
  internos           bigint,
  -- De los `internos`, cuántos son pendientes de meses anteriores.
  arrastrados        bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lotes  uuid[];
  v_moneda text := coalesce(p_moneda, 'PEN');
  v_desde  date;
begin
  v_desde := public.arrastre_desde(p_empresa_id, p_desde);

  select array_agg(i.lote),
         count(*), coalesce(sum(i.filas_leidas), 0),
         coalesce(sum(i.repetidas_en_archivo), 0), coalesce(sum(i.invalidas), 0),
         coalesce(sum(i.ya_existian), 0), coalesce(sum(i.insertados), 0)
    into v_lotes, cargas, archivo_filas,
         archivo_repetidas, archivo_invalidas, archivo_existentes, archivo_insertados
    from public.importaciones_comprobantes i
   where i.empresa_id = p_empresa_id
     and i.fecha_min <= p_hasta
     and i.fecha_max >= v_desde;

  alcance := case when v_lotes is null then 'empresa' else 'cargas' end;

  select
    count(*),
    count(*) filter (
      where c.fecha is null or c.fecha < v_desde or c.fecha > p_hasta
    ),
    count(*) filter (
      where c.fecha between v_desde and p_hasta
        and c.estado in ('cobrado', 'anulado')
    ),
    count(*) filter (
      where c.fecha between v_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and coalesce(c.moneda, 'PEN') <> v_moneda
    ),
    -- ⚠️ Mismo criterio EXACTO que `pares_exactos` y `residuo_internos`: si esta
    -- cifra no fuera la que el motor recibe, la cascada explicaría una resta que
    -- no ocurrió.
    count(*) filter (
      where c.fecha between v_desde and p_hasta
        and c.estado not in ('cobrado', 'anulado')
        and coalesce(c.moneda, 'PEN') = v_moneda
    ),
    count(*) filter (
      where c.fecha between v_desde and p_desde - 1
        and c.estado not in ('cobrado', 'anulado')
        and coalesce(c.moneda, 'PEN') = v_moneda
    )
    into cargados, fuera_periodo, ya_cobrados, otra_moneda, internos, arrastrados
    from public.comprobantes c
   where c.empresa_id = p_empresa_id
     and (v_lotes is null or c.lote_importacion = any(v_lotes));

  return next;
end;
$$;

revoke all on function public.origen_partidas(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.origen_partidas(uuid, date, date, text)
  to service_role;

comment on function public.origen_partidas(uuid, date, date, text) is
  'Cascada archivo → comprobantes → registros internos de un período. La llama '
  'el backend al iniciar y el resultado se congela en jobs.origen_partidas.';


-- ---------------------------------------------------------------------------
-- 8) La estimación del Paso 3 estima sobre el mismo conjunto
--
-- Es lo que promete «casarían 980 de 1.000» antes de gastar la corrida. Con la
-- ventana vieja diría menos pares de los que el motor va a hacer, y el Paso 3
-- empujaría a revisar un mapeo que está bien.
-- ---------------------------------------------------------------------------
create or replace function public.diagnostico_previo(
  p_lote_id           uuid,
  p_desde             date,
  p_hasta             date,
  p_limite_estimacion integer default 60000
)
returns table (
  internos                 bigint,
  internos_con_ref         bigint,
  internos_ref_repetida    bigint,
  movimientos              bigint,
  movimientos_con_ref      bigint,
  movimientos_ref_repetida bigint,
  movimientos_abono        bigint,
  movimientos_cargo        bigint,
  movimientos_fuera        bigint,
  movimientos_dia_bajo     bigint,
  refs_compartidas         bigint,
  pares_estimados          bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_moneda  text;
  v_desde   date;
  v_int     bigint;
  v_mov     bigint;
  v_pares   bigint := null;
begin
  select ue.empresa_id into v_empresa
    from public.usuarios_empresa ue
   where ue.usuario_id = auth.uid()
   limit 1;
  if v_empresa is null then
    return;
  end if;

  -- La moneda sale de la CUENTA del lote: los movimientos no la llevan propia.
  select cb.moneda into v_moneda
    from public.movimientos_extracto m
    join public.cuentas_bancarias cb on cb.id = m.cuenta_id
   where m.lote_id = p_lote_id
     and m.empresa_id = v_empresa
   limit 1;
  if v_moneda is null then
    return; -- lote de otra empresa, o inexistente
  end if;

  v_desde := public.arrastre_desde(v_empresa, p_desde);

  select count(*) into v_int
    from public.comprobantes c
   where c.empresa_id = v_empresa
     and c.fecha between v_desde and p_hasta
     and c.estado not in ('cobrado', 'anulado')
     and c.moneda = v_moneda;

  select count(*) into v_mov
    from public.movimientos_extracto m
   where m.lote_id = p_lote_id
     and m.empresa_id = v_empresa;

  if v_int <= p_limite_estimacion and v_mov <= p_limite_estimacion then
    select count(*) into v_pares
      from public.pares_exactos(v_empresa, p_lote_id, v_desde, p_hasta, v_moneda);
  end if;

  return query
  with ci as materialized (
    select c.ref_norm as ref
      from public.comprobantes c
     where c.empresa_id = v_empresa
       and c.fecha between v_desde and p_hasta
       and c.estado not in ('cobrado', 'anulado')
       and c.moneda = v_moneda
  ),
  mi as materialized (
    select m.ref_norm as ref, m.monto, m.fecha
      from public.movimientos_extracto m
     where m.lote_id = p_lote_id
       and m.empresa_id = v_empresa
  ),
  ci_refs as materialized (
    select ref, count(*) as k from ci where ref <> '' group by ref
  ),
  mi_refs as materialized (
    select ref, count(*) as k from mi where ref <> '' group by ref
  )
  select
    v_int,
    (select count(*) from ci where ref <> ''),
    (select coalesce(sum(k), 0) from ci_refs where k > 1),
    v_mov,
    (select count(*) from mi where ref <> ''),
    (select coalesce(sum(k), 0) from mi_refs where k > 1),
    (select count(*) from mi where monto > 0),
    (select count(*) from mi where monto < 0),
    -- ⚠️ Esto se sigue midiendo contra el PERÍODO PEDIDO, no contra la ventana:
    -- un movimiento fuera del período es un extracto mal recortado, y el
    -- arrastre no lo vuelve correcto.
    (select count(*) from mi where fecha < p_desde or fecha > p_hasta),
    (select count(*) from mi where extract(day from fecha) <= 12),
    (select count(*) from ci_refs a join mi_refs b on b.ref = a.ref),
    v_pares;
end;
$$;

revoke all on function public.diagnostico_previo(uuid, date, date, integer)
  from public, anon;
grant execute on function public.diagnostico_previo(uuid, date, date, integer)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 9) «De qué es el residuo» mira la misma ventana
--
-- `residuo_explicado` clasifica cada movimiento suelto por si su código existe
-- o no del lado de los libros. Con la ventana vieja, un abono de julio que paga
-- una factura de junio saldría como `sin_rastro` —«su código no aparece en el
-- otro lado»— cuando el código está y lo que pasó es otra cosa. Es justo el
-- hecho consultable que esa función existe para no inventar.
-- ---------------------------------------------------------------------------
create or replace function public.residuo_explicado(p_job_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job     public.jobs_conciliacion%rowtype;
  v_moneda  text;
  v_desde   date;
  v_int_ids uuid[];
  v_mov_ids uuid[];
  v_out     jsonb;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    return null;
  end if;

  -- ⚠️ FRONTERA DE SEGURIDAD: el job tiene que ser de una empresa del usuario.
  perform 1
     from public.usuarios_empresa ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = v_job.empresa_id;
  if not found then
    return null;
  end if;

  if v_job.lote_extracto_id is null or v_job.payload_entrada is null then
    return null;
  end if;

  select cb.moneda into v_moneda
    from public.cuentas_bancarias cb
   where cb.id = v_job.cuenta_id;
  v_moneda := coalesce(v_moneda, 'PEN');

  v_desde := public.arrastre_desde(v_job.empresa_id, v_job.periodo_desde);

  -- Los ids del residuo, a un array: `= any($array)` estima por su longitud y
  -- el planificador elige el índice (0048).
  select array_agg((e ->> 'comprobante_id')::uuid)
    into v_int_ids
    from jsonb_array_elements(v_job.payload_entrada -> 'registros_internos') e
   where e ->> 'comprobante_id' is not null;

  select array_agg((e ->> 'movimiento_id')::uuid)
    into v_mov_ids
    from jsonb_array_elements(v_job.payload_entrada -> 'movimientos_bancarios') e
   where e ->> 'movimiento_id' is not null;

  if v_int_ids is null and v_mov_ids is null then
    return null;
  end if;

  with casados_extra as materialized (
    select m.comprobante_ids, m.movimiento_ids
      from public.matches_conciliacion m
     where m.job_id = p_job_id
       and m.metodo in ('difusa', 'ia', 'manual')
  ),
  extra_c as (select unnest(comprobante_ids) as id from casados_extra),
  extra_m as (select unnest(movimiento_ids) as id from casados_extra),
  int_pend as materialized (
    select c.ref_norm as ref,
           public.importe_pendiente(c.tipo, c.monto, c.saldo) as monto
      from public.comprobantes c
     where c.id = any(coalesce(v_int_ids, '{}'::uuid[]))
       and not exists (select 1 from extra_c k where k.id = c.id)
  ),
  mov_pend as materialized (
    select m.ref_norm as ref, m.monto
      from public.movimientos_extracto m
     where m.id = any(coalesce(v_mov_ids, '{}'::uuid[]))
       and not exists (select 1 from extra_m k where k.id = m.id)
  ),
  int_clas as (
    select
      case
        when p.ref = '' then 'sin_codigo'
        when exists (
          select 1 from public.movimientos_extracto m
           where m.lote_id = v_job.lote_extracto_id
             and m.ref_norm = p.ref
             -- ⚠️ La condición del índice PARCIAL, repetida. Sin ella el
             -- índice no se puede usar y cada sonda recorre la tabla.
             and m.ref_norm <> ''
        ) then 'codigo_en_el_otro_lado'
        else 'sin_rastro'
      end as motivo,
      p.monto
    from int_pend p
  ),
  mov_clas as (
    select
      case
        when p.ref = '' then 'sin_codigo'
        when exists (
          select 1 from public.comprobantes c
           where c.empresa_id = v_job.empresa_id
             and c.ref_norm = p.ref
             -- ⚠️ Ídem: `idx_comprobantes_ref_norm` es parcial.
             and c.ref_norm <> ''
             and c.fecha between v_desde and v_job.periodo_hasta
        ) then 'codigo_en_el_otro_lado'
        else 'sin_rastro'
      end as motivo,
      p.monto
    from mov_pend p
  )
  select jsonb_build_object(
    'moneda', v_moneda,
    'internos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'motivo', motivo, 'partidas', n, 'importe', importe) order by n desc)
        from (select motivo, count(*) as n, sum(monto) as importe
                from int_clas group by motivo) a
    ), '[]'::jsonb),
    'movimientos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'motivo', motivo, 'partidas', n, 'importe', importe) order by n desc)
        from (select motivo, count(*) as n, sum(monto) as importe
                from mov_clas group by motivo) a
    ), '[]'::jsonb),
    'series', '[]'::jsonb
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.residuo_explicado(text) from public, anon;
grant execute on function public.residuo_explicado(text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 10) Las series descompensadas, sobre el mismo conjunto
--
-- «De los códigos S001 el banco trae 559 y los libros 276» solo significa algo
-- si los dos lados se cuentan sobre lo mismo. Con la ventana vieja, el lado de
-- los libros saldría corto y la función anunciaría documentos que faltan donde
-- no falta ninguno — y ese recuadro existe precisamente para cambiar la
-- conversación cuando la diferencia es real.
-- ---------------------------------------------------------------------------
create or replace function public.residuo_series(p_job_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job   public.jobs_conciliacion%rowtype;
  v_desde date;
  v_out   jsonb;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    return '[]'::jsonb;
  end if;

  perform 1
     from public.usuarios_empresa ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = v_job.empresa_id;
  if not found then
    return '[]'::jsonb;
  end if;

  if v_job.lote_extracto_id is null then
    return '[]'::jsonb;
  end if;

  v_desde := public.arrastre_desde(v_job.empresa_id, v_job.periodo_desde);

  with tot_banco as (
    select left(m.ref_norm, 4) as serie, count(distinct m.ref_norm) as n
      from public.movimientos_extracto m
     where m.lote_id = v_job.lote_extracto_id
       and m.ref_norm <> ''
     group by 1
  ),
  tot_libros as (
    select left(c.ref_norm, 4) as serie, count(distinct c.ref_norm) as n
      from public.comprobantes c
     where c.empresa_id = v_job.empresa_id
       and c.ref_norm <> ''
       and c.fecha between v_desde and v_job.periodo_hasta
     group by 1
  ),
  juntas as (
    select coalesce(b.serie, l.serie) as serie,
           coalesce(b.n, 0) as banco,
           coalesce(l.n, 0) as libros
      from tot_banco b
      full join tot_libros l on l.serie = b.serie
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'serie', serie,
           'banco', banco,
           'libros', libros,
           'banco_sin_conciliar', 0,
           'libros_sin_conciliar', 0) order by (banco + libros) desc), '[]'::jsonb)
    into v_out
    from (select * from juntas order by (banco + libros) desc limit 4) s;

  return v_out;
end;
$$;

revoke all on function public.residuo_series(text) from public, anon;
grant execute on function public.residuo_series(text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- ⚠️ La ventana más ancha cambia cuántas filas toca cada consulta, y el
-- planificador decide con estadísticas viejas. Es la lección de la 0029/0030:
-- `residuo_internos` pasó de 1,68 s a superar el `statement_timeout` sin que
-- cambiara una línea de código.
-- ---------------------------------------------------------------------------
analyze public.comprobantes;
