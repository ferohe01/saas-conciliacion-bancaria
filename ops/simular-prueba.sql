-- ============================================================================
-- simular-prueba.sql — Mover a mano el período de prueba de una empresa
--
-- Para qué: enseñar en vivo qué le pasa a un cliente cuando se le acaban los
-- 30 días (o cuando le quedan tres). No hay pantalla para esto a propósito —
-- `plan` y `prueba_hasta` NO son escribibles por el usuario (migración 0005:
-- `revoke update ... grant update (nombre, ruc, config_conciliacion)`), porque
-- si lo fueran cualquiera se auto-activaría con la key `anon`.
--
-- Dónde se ejecuta: **SQL Editor de Supabase Studio**
-- (https://supabase.fernandorh.com → SQL Editor), que corre como superusuario.
-- También sirve `psql` contra la base. Desde la app NO se puede, y está bien.
--
-- Cómo se usa: cambia el correo de la línea `:demo` de cada consulta por el de
-- la cuenta con la que vas a hacer la demostración, y ejecuta el bloque que
-- necesites. El efecto es **inmediato**: basta con recargar la página en el
-- navegador (las pantallas se calculan en cada carga, no hay caché que vaciar).
--
-- ⚠️ Hazlo sobre una cuenta de demostración, no sobre la de un cliente real:
-- mientras la prueba esté vencida, esa empresa no puede iniciar conciliaciones.
-- Todo lo demás lo sigue viendo, y volver atrás es el bloque 3.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0) ¿Cómo está ahora? Ejecuta esto antes y después de cada cambio.
-- ---------------------------------------------------------------------------
select e.nombre,
       u.email,
       e.plan,
       e.prueba_hasta,
       case
         when e.plan = 'activo'            then 'cliente de pago (sin límite)'
         when e.prueba_hasta is null       then 'sin fecha → NO bloquea'
         when e.prueba_hasta <= now()      then 'PRUEBA VENCIDA'
         else 'quedan ' || ceil(extract(epoch from (e.prueba_hasta - now())) / 86400)::int || ' días'
       end as estado
  from public.empresas e
  join public.usuarios_empresa ue on ue.empresa_id = e.id
  join auth.users u               on u.id = ue.usuario_id
 order by e.created_at;


-- ---------------------------------------------------------------------------
-- 1) VENCER la prueba (el estado que quieres enseñar)
--
-- Se pone la fecha en el pasado; `plan` sigue en 'prueba'. Qué se ve entonces
-- (buen orden para enseñarlo):
--   · /dashboard     → tarjeta ámbar "Tu período de prueba terminó" con el
--                      botón de activar (datos de transferencia BCP), y
--                      desaparece "Conciliar un período" de la cabecera.
--   · Barra lateral  → "Nueva conciliación" deja de ser el botón negro y
--                      aparece "Prueba vencida" debajo.
--   · /wizard        → no carga el flujo: explica que la prueba terminó y
--                      ofrece ir al historial o a los reportes.
--   · /cobranzas     → "Tu período de prueba terminó" (no "no contratado": la
--                      estuvo usando durante la prueba), con el botón de
--                      activar la CUENTA, no de comprar ese módulo.
--   · /pagos         → igual.
--   · /configuracion → "Qué incluye tu cuenta" pasa a "No disponible".
--   · Panel, historial, resultados, reportes, aprendizaje, resumen, comprobantes
--                    → SE SIGUEN VIENDO. Al vencer no se pierde el acceso de
--                      lectura, solo la capacidad de conciliar de nuevo. Es el
--                      argumento de venta: no se le secuestra nada.
--   · Y el control real: POST /api/conciliacion/iniciar responde 403
--     `prueba_vencida` aunque alguien llame al endpoint a mano.
-- ---------------------------------------------------------------------------
update public.empresas
   set prueba_hasta = now() - interval '1 day'
 where id in (
   select ue.empresa_id
     from public.usuarios_empresa ue
     join auth.users u on u.id = ue.usuario_id
    where u.email = 'demo@ejemplo.com'   -- ← cambia esto
 );


-- ---------------------------------------------------------------------------
-- 2) POR VENCER — el otro estado que vale la pena enseñar
--
-- Con 7 días o menos aparece el aviso ("Tu prueba termina en 3 días") y, en
-- /configuracion, el módulo de cobranzas dice "Tu prueba termina en 3 días" en
-- vez de "Vence en 3 días": lo que se acaba es la prueba entera, no ese módulo.
-- ---------------------------------------------------------------------------
update public.empresas
   set prueba_hasta = now() + interval '3 days'
 where id in (
   select ue.empresa_id
     from public.usuarios_empresa ue
     join auth.users u on u.id = ue.usuario_id
    where u.email = 'demo@ejemplo.com'   -- ← cambia esto
 );


-- ---------------------------------------------------------------------------
-- 3) RESTAURAR la prueba (deshacer la demostración)
--
-- Devuelve 30 días contados desde hoy. No hay nada que reparar: el vencimiento
-- no destruye datos, solo bloquea iniciar conciliaciones nuevas.
-- ---------------------------------------------------------------------------
update public.empresas
   set plan = 'prueba',
       prueba_hasta = now() + interval '30 days'
 where id in (
   select ue.empresa_id
     from public.usuarios_empresa ue
     join auth.users u on u.id = ue.usuario_id
    where u.email = 'demo@ejemplo.com'   -- ← cambia esto
 );


-- ---------------------------------------------------------------------------
-- 4) CONVERTIR A CLIENTE DE PAGO — el "después" de la historia
--
-- `plan = 'activo'` ignora `prueba_hasta` por completo: vuelve a poder
-- conciliar y desaparecen todos los avisos de prueba. Es lo que harías de
-- verdad al recibir una transferencia.
--
-- **Incluye TODO**, cuentas por cobrar y por pagar entre ellas. El sistema se
-- vende entero: no hay nada que contratar aparte, ni antes ni después de pagar.
-- Quien paga y quien está en prueba ven exactamente las mismas pantallas.
-- ---------------------------------------------------------------------------
update public.empresas
   set plan = 'activo'
 where id in (
   select ue.empresa_id
     from public.usuarios_empresa ue
     join auth.users u on u.id = ue.usuario_id
    where u.email = 'demo@ejemplo.com'   -- ← cambia esto
 );


-- ---------------------------------------------------------------------------
-- 5) (RARO) Abrir un módulo a una empresa SIN cuenta al día
--
-- `suscripciones_modulo` sobrevive solo para concesiones sueltas: una cortesía,
-- un acuerdo puntual, dar acceso a algo sin activar la cuenta entera. **No es
-- el camino normal** — el plan y la prueba ya abren todo — y en condiciones
-- normales esta tabla está vacía.
--
-- `activo_hasta = null` sería sin vencimiento; aquí se da un mes.
-- Para revocarlo: delete de la misma fila (ver el pie de 0009_modulos.sql).
-- ---------------------------------------------------------------------------
insert into public.suscripciones_modulo (empresa_id, modulo, activo_hasta, nota)
select ue.empresa_id, 'cobranzas', now() + interval '1 month', 'cortesía'
  from public.usuarios_empresa ue
  join auth.users u on u.id = ue.usuario_id
 where u.email = 'demo@ejemplo.com'      -- ← cambia esto
on conflict (empresa_id, modulo) do update
   set activo_hasta = excluded.activo_hasta,
       nota         = excluded.nota,
       updated_at   = now();
