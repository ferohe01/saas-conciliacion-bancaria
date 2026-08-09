-- ============================================================================
-- 0037_diagnostico_previo.sql — Comprobar la conciliación ANTES de correrla
--
-- Una conciliación de 450.999 movimientos terminó en 0 % porque la columna
-- "Recibos" del extracto no se mapeó a *referencia*. Nada lo dijo hasta ver el
-- resultado, media hora después. Hay un aviso ámbar en el Paso 2, pero avisa de
-- una CAUSA sin medir su CONSECUENCIA — y un aviso que no se sabe ponderar se
-- despacha sin leer, sobre todo cuando dice, con razón, que se puede conciliar
-- igual.
--
-- Al llegar al Paso 3 los dos lados ya están en la base (el Paso 2 importa el
-- extracto y devuelve `lote_id`) y el motor todavía no ha corrido. Ahí cabe una
-- comprobación real en vez de una heurística sobre lo que se ve en pantalla.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) La regla de emparejamiento exacto, extraída a UNA función
--
-- Estaba dentro de `conciliar_exacta`. Si el diagnóstico la copiara, tendríamos
-- dos definiciones del mismo emparejamiento y nada que impidiera que
-- divergieran: el Paso 3 prometería una cobertura que el motor luego no da, o
-- al revés. Es el mismo riesgo que documenta la 0029 con `ref_norm` (tiene que
-- ser EXACTAMENTE `normRef` de n8n/01_exacta.js), y aquí se puede evitar del
-- todo porque las dos consultas viven en Postgres.
--
-- ⚠️ Deliberadamente SIN `security definer` y SIN `set search_path`: las dos
-- cosas impiden que el planificador la incruste (inline) en la consulta que la
-- llama, y esta función está en el camino caliente que empareja 450.000 filas.
-- Todo va calificado con `public.` para que el search_path no importe, y el
-- acceso queda cerrado con el `revoke` del final: solo se invoca desde las dos
-- funciones `definer` de abajo.
--
-- ⚠️ Al desplegar sobre el cliente grande, VOLVER A MEDIR `conciliar_exacta`.
-- Si el tiempo empeorase, la definición anterior (con el cuerpo en línea) está
-- en 0029 y se puede restaurar sin tocar nada más.
-- ---------------------------------------------------------------------------
create or replace function public.pares_exactos(
  p_empresa_id uuid,
  p_lote_id    uuid,
  p_desde      date,
  p_hasta      date,
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
      -- Céntimos CON SIGNO, igual que `01_exacta.js`: en valor absoluto un
      -- cobro casaría con un pago del mismo importe.
      round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100)::bigint as cent,
      c.ref_norm as ref,
      -- row_number() en los dos lados, casando por número: con cientos de
      -- recibos del mismo importe y la misma referencia, un join a secas da el
      -- producto cartesiano (300 x 300 = 90.000 pares en vez de 300).
      row_number() over (
        partition by round((case when c.tipo = 'pago' then -abs(c.monto) else abs(c.monto) end) * 100), c.ref_norm
        order by c.id
      ) as n
    from public.comprobantes c
    where c.empresa_id = p_empresa_id
      and c.fecha between p_desde and p_hasta
      and c.estado not in ('cobrado', 'anulado')
      and c.ref_norm <> ''
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

revoke all on function public.pares_exactos(uuid, uuid, date, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.pares_exactos(uuid, uuid, date, date, integer, integer)
  to service_role;


-- ---------------------------------------------------------------------------
-- 2) La capa exacta, ahora sobre la función compartida
--
-- Mismo comportamiento que en 0029; lo único que cambia es de dónde sale el
-- conjunto de pares.
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
  v_job public.jobs_conciliacion%rowtype;
  v_pares bigint;
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
      v_job.periodo_desde, v_job.periodo_hasta,
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
-- 3) El diagnóstico previo
--
-- Devuelve CONTADORES, no prosa: qué hacer con ellos lo decide
-- `src/lib/diagnosticoPrevio.ts`, que es puro y tiene tests. Aquí solo se
-- cuenta, que es lo que Postgres hace bien y lo que a esta escala no se puede
-- hacer en Node.
--
-- ⚠️ `security definer` con la empresa resuelta desde `auth.uid()`, NUNCA por
-- parámetro: un `empresa_id` recibido de fuera sería un `?empresa_id=` en manos
-- de cualquiera. Mismo patrón que `resumen_saldos` (0021).
--
-- ⚠️ `pares_estimados` puede salir NULL, y eso no es un fallo: emparejar medio
-- millón contra medio millón tarda más que el `statement_timeout` de 8 s, así
-- que por encima de `p_limite_estimacion` no se intenta. La señal que de
-- verdad diagnostica el caso del 0 % es `refs_compartidas` —cuántos códigos de
-- operación aparecen en LOS DOS lados—, que es un join sobre columnas indexadas
-- y cuesta casi nada. Devolver null y decirlo es mejor que colgar la pantalla o
-- que inventar un número.
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
  v_int bigint;
  v_mov bigint;
  v_pares bigint := null;
begin
  select ue.empresa_id into v_empresa
    from public.usuarios_empresa ue
   where ue.usuario_id = auth.uid()
   limit 1;
  if v_empresa is null then
    return; -- sin sesión no hay empresa, y por tanto no hay nada que contar
  end if;

  -- El lote tiene que ser de ESTA empresa. Sin esta línea, un uuid ajeno
  -- devolvería el diagnóstico del extracto de otro cliente. Se devuelve vacío
  -- en vez de error: tampoco se confirma que el lote exista.
  perform 1
     from public.movimientos_extracto m
    where m.lote_id = p_lote_id
      and m.empresa_id = v_empresa
    limit 1;
  if not found then
    return;
  end if;

  select count(*) into v_int
    from public.comprobantes c
   where c.empresa_id = v_empresa
     and c.fecha between p_desde and p_hasta
     and c.estado not in ('cobrado', 'anulado');

  select count(*) into v_mov
    from public.movimientos_extracto m
   where m.lote_id = p_lote_id
     and m.empresa_id = v_empresa;

  -- La estimación va en un IF y no en un CASE dentro del select: así queda
  -- fuera de toda duda que la consulta cara NO se evalúa cuando se decide
  -- saltarla. Un CASE se lo dejaría a criterio del planificador.
  if v_int <= p_limite_estimacion and v_mov <= p_limite_estimacion then
    select count(*) into v_pares
      from public.pares_exactos(v_empresa, p_lote_id, p_desde, p_hasta);
  end if;

  return query
  with ci as materialized (
    select c.ref_norm as ref
      from public.comprobantes c
     where c.empresa_id = v_empresa
       and c.fecha between p_desde and p_hasta
       and c.estado not in ('cobrado', 'anulado')
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

comment on function public.diagnostico_previo(uuid, date, date, integer) is
  'Contadores para revisar una conciliación antes de dispararla (Paso 3). '
  'La empresa sale de auth.uid(); nunca por parámetro. Ver '
  'src/lib/diagnosticoPrevio.ts para la interpretación.';
