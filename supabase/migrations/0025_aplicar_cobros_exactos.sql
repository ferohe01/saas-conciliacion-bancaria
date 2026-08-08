-- ============================================================================
-- 0025_aplicar_cobros_exactos.sql — El reparto de cobros de la capa exacta,
-- en SQL (parte B, cierre)
--
-- Aprobar una conciliación descuenta el saldo de cada comprobante cobrado. Eso
-- se calculaba en Node y se escribía por lotes: con 32.170 cobros ya tardaba
-- ~90 segundos, y con los 447.795 de un mes completo serían ~900 peticiones y
-- un cuarto de hora. Inviable, y por eso el modo tabla no movía saldo.
--
-- ── Por qué SOLO las exactas ───────────────────────────────────────────────
--
-- El reparto general no es trivial: hay pagos parciales, agrupaciones 1:N donde
-- un depósito se prorratea entre varias facturas, y diferencias absorbidas
-- (comisión, redondeo) que dan la factura por cobrada entera. Esa lógica vive
-- en `src/lib/cobranzas.ts`, es pura, tiene tests y **no conviene duplicarla**:
-- es la que decide cuánto dinero se le descuenta a quién.
--
-- Pero las de la capa exacta no tienen nada de eso. Son 1:1 y con el MISMO
-- importe en los dos lados por construcción (`conciliar_exacta` casa por
-- céntimos con signo), así que el factor de reparto es exactamente 1 y lo único
-- que queda es el tope por saldo disponible.
--
-- O sea: SQL donde el volumen es enorme y la aritmética trivial; Node donde la
-- aritmética es sutil y el volumen son unos miles. El residuo sigue pasando por
-- `calcularAplicaciones` como siempre.
-- ============================================================================

-- La version de un solo argumento existio brevemente durante el desarrollo.
-- `create or replace` con otra firma NO la sustituye: crea una funcion nueva y
-- deja la anterior viva, y con el parametro por defecto la llamada de un
-- argumento queda ambigua entre las dos.
drop function if exists public.aplicar_cobros_exactos(text);

-- ⚠️ POR LOTES, y no por gusto. Escribir las 447.795 de una vez tarda 2 min 24 s
-- —cada fila dispara el trigger que recalcula el saldo del comprobante (0008)—
-- y el `statement_timeout` del rol con el que se conecta PostgREST es de 8 s:
-- la llamada se cancelaria entera. Quien llama repite hasta que devuelva 0.
create or replace function public.aplicar_cobros_exactos(
  p_job_id text,
  p_limite integer default 20000
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs_conciliacion%rowtype;
  v_n bigint;
begin
  select * into v_job from public.jobs_conciliacion where id = p_job_id;
  if not found then
    raise exception 'Conciliación no encontrada: %', p_job_id
      using errcode = 'no_data_found';
  end if;

  with pares as (
    select
      m.comprobante_ids[1] as comp,
      m.movimiento_ids[1]  as mov
    from public.matches_conciliacion m
    where m.job_id = p_job_id
      and m.metodo = 'exacta'
      -- Mismos estados que `ESTADOS_CONFIRMADOS` en src/lib/cobranzas.ts.
      -- `auto` CUENTA: es lo que emite el motor, y exigir un clic humano en
      -- cada match exacto vaciaría de sentido el producto.
      and m.estado_revision in ('auto', 'aceptado', 'modificado')
      and array_length(m.comprobante_ids, 1) = 1
      and array_length(m.movimiento_ids, 1) = 1
      -- Lo ya aplicado no se vuelve a mirar: es lo que hace que repetir la
      -- llamada avance en vez de rehacer el mismo trabajo.
      and not exists (
        select 1 from public.aplicaciones_cobro a
         where a.job_id = p_job_id
           and a.comprobante_id = m.comprobante_ids[1]
      )
    limit p_limite
  ),
  -- Lo que aplicaron OTROS jobs. El propio no cuenta: sus aplicaciones se
  -- borran y se rehacen en cada resincronización, así que incluirlas dejaría
  -- la segunda pasada sin nada que aplicar.
  otros as (
    select a.comprobante_id, sum(a.monto_aplicado) as aplicado
      from public.aplicaciones_cobro a
      join pares p on p.comp = a.comprobante_id
     where a.job_id <> p_job_id
     group by a.comprobante_id
  ),
  -- Un cobro que el banco revirtió deja de ocupar sitio: la factura vuelve a
  -- estar disponible.
  revertidos as (
    select r.comprobante_id, sum(r.monto_revertido) as revertido
      from public.reversiones_cobro r
      join pares p on p.comp = r.comprobante_id
     where r.job_id <> p_job_id
     group by r.comprobante_id
  ),
  calculo as (
    select
      p.comp,
      p.mov,
      abs(c.monto) as importe,
      -- Tope por saldo disponible. Sin él, la misma factura conciliada desde
      -- dos cuentas bancarias en el mismo período —que el sistema permite a
      -- propósito, son extractos distintos— descontaría su importe COMPLETO
      -- dos veces. La 0015 aborta si aun así se pasara.
      greatest(
        0,
        abs(c.monto)
          - coalesce(o.aplicado, 0)
          + coalesce(rv.revertido, 0)
      ) as disponible
    from pares p
    join public.comprobantes c on c.id = p.comp
    left join otros o       on o.comprobante_id = p.comp
    left join revertidos rv on rv.comprobante_id = p.comp
  )
  insert into public.aplicaciones_cobro
    (job_id, empresa_id, usuario_id, comprobante_id, id_movimiento, monto_aplicado)
  select
    p_job_id,
    v_job.empresa_id,
    v_job.usuario_id,
    k.comp,
    k.mov::text,
    least(k.importe, k.disponible)
  from calculo k
  -- Por debajo de medio céntimo no hay cobro que registrar, y una fila de 0
  -- solo ensucia el historial del comprobante.
  where least(k.importe, k.disponible) > 0.005
  -- Reentrante: si por lo que sea ya existía esa aplicación, no se duplica.
  on conflict (comprobante_id, job_id, id_movimiento) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.aplicar_cobros_exactos(text, integer) is
  'Escribe las aplicaciones de cobro de los pares EXACTOS de un job. Son 1:1 y '
  'con el mismo importe, así que el factor de reparto es 1: solo queda topar '
  'por saldo disponible. El resto lo calcula src/lib/cobranzas.ts.';

revoke all on function public.aplicar_cobros_exactos(text, integer) from public, anon, authenticated;
grant execute on function public.aplicar_cobros_exactos(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- ⚠️ Índice imprescindible para que los lotes NO se degraden.
--
-- El filtro "lo ya aplicado no se vuelve a mirar" busca por (job_id,
-- comprobante_id). El índice que existía (`idx_aplicaciones_job`) es solo por
-- `job_id`, así que cada lote recorría TODAS las aplicaciones ya escritas de
-- ese job: el primer lote de 20.000 tardó 10 s y el segundo 60 s, con el mismo
-- trabajo por delante. La única pista de que algo iba mal era que empeoraba.
--
-- La clave única (comprobante_id, job_id, id_movimiento) no sirve: su columna
-- principal es la equivocada para esta pregunta.
-- ---------------------------------------------------------------------------
create index if not exists idx_aplicaciones_job_comprobante
  on public.aplicaciones_cobro (job_id, comprobante_id);

-- ---------------------------------------------------------------------------
-- limpiar_cobros_desconfirmados(job)
--
-- Quita las aplicaciones de este job cuyo par ya no está confirmado: alguien
-- rechazó un match o lo devolvió a revisión, y su cobro tiene que desaparecer
-- para que el saldo vuelva.
--
-- Sustituye al "borrar todo y rehacer" que hace la versión en Node. Con 447.795
-- aplicaciones ese borrado tarda **90 segundos** —cada fila dispara el trigger
-- de saldo— y encima obliga a reescribirlas todas después. Aquí se toca solo lo
-- que cambió, que en régimen normal es nada.
--
-- ⚠️ El conjunto de comprobantes confirmados se despliega UNA vez con `unnest`.
-- Con `comprobante_id = any(m.comprobante_ids)` Postgres recorrería todos los
-- matches por cada aplicación, que es el mismo error que dejó `residuo_internos`
-- sin terminar en diez minutos.
-- ---------------------------------------------------------------------------
create or replace function public.limpiar_cobros_desconfirmados(p_job_id text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  with confirmados as materialized (
    select unnest(m.comprobante_ids) as comprobante_id
      from public.matches_conciliacion m
     where m.job_id = p_job_id
       and m.estado_revision in ('auto', 'aceptado', 'modificado')
  )
  delete from public.aplicaciones_cobro a
   where a.job_id = p_job_id
     and not exists (
       select 1 from confirmados c where c.comprobante_id = a.comprobante_id
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.limpiar_cobros_desconfirmados(text) is
  'Retira los cobros de los pares que dejaron de estar confirmados. Toca solo '
  'lo que cambió: borrar y rehacer 447.795 aplicaciones tarda 90 s.';

revoke all on function public.limpiar_cobros_desconfirmados(text) from public, anon, authenticated;
grant execute on function public.limpiar_cobros_desconfirmados(text) to service_role;
