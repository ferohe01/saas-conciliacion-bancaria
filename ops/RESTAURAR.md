# Restaurar un backup de Supabase

Procedimiento **verificado en el VPS** (27/07/2026) contra un dump real de
`ops/backup-supabase.sh`.

## La trampa: restaurar sobre un Supabase recién desplegado NO funciona

La imagen `supabase/postgres` crea en su arranque un esquema `auth` con una
versión **anterior** del esquema de GoTrue. Si restauras el dump encima:

- `CREATE TABLE auth.users` → *relation already exists* (se ignora)
- `COPY auth.users (…, is_sso_user, reauthentication_token, …)` → **falla**:
  esas columnas no existen en la tabla preexistente

Resultado: `public.*` se restaura entero y `auth.users` queda **vacío**. Los
datos vuelven pero **nadie puede iniciar sesión**, y nada en la salida lo grita
— hay que contar filas para descubrirlo.

Medido en la prueba:

| | `auth.users` | `empresas` | `jobs` | `cuentas` |
|---|---|---|---|---|
| Producción | 1 | 1 | 4 | 1 |
| Restaurado **sin** soltar esquemas | **0** ❌ | 1 | 4 | 1 |
| Restaurado **soltando** esquemas | 1 ✅ | 1 | 4 | 1 |

## Procedimiento correcto

```bash
# 1. Levantar/desplegar la instancia destino y ESPERAR a que termine su init.
#    (con docker: hasta que el healthcheck diga "healthy", + unos segundos)
docker inspect --format '{{.State.Health.Status}}' <contenedor-db>

# 2. Soltar los esquemas que crea su propio arranque.
docker exec <contenedor-db> psql -U supabase_admin -d postgres \
  -c 'drop schema if exists auth cascade;' \
  -c 'drop schema if exists storage cascade;'

# 3. Restaurar como supabase_admin (NO como postgres: los objetos pertenecen a
#    supabase_admin y los SET ROLE fallarian, arrastrando los CREATE TABLE).
gunzip -c supabase-AAAA-MM-DD-HHMM.sql.gz \
  | docker exec -i <contenedor-db> psql -U supabase_admin -d postgres

# 4. VERIFICAR contando filas. Es el unico paso que demuestra algo.
docker exec <contenedor-db> psql -U postgres -tAc \
  "select (select count(*) from auth.users), (select count(*) from public.empresas),
          (select count(*) from public.jobs_conciliacion);"
```

Son normales ~40 errores de roles y extensiones que ya existen (`role X already
exists`, `schema X already exists`). Lo que importa son los conteos del paso 4.

## Comprobar solo que el fichero sirve

Si únicamente quieres validar un backup sin montar Supabase, restaura sobre un
Postgres genérico de la misma versión mayor: ahí no preexiste nada y los datos
entran limpios (~43 errores por extensiones que faltan, irrelevantes).

```bash
docker run -d --name pg-prueba -e POSTGRES_PASSWORD=prueba postgres:17
sleep 10
gunzip -c supabase-*.sql.gz | docker exec -i pg-prueba psql -U postgres
docker exec pg-prueba psql -U postgres -tAc "select count(*) from auth.users;"
docker rm -f pg-prueba
```

## Instalación del script en el VPS

```bash
cp ops/backup-supabase.sh /usr/local/bin/ && chmod +x /usr/local/bin/backup-supabase.sh
mkdir -p /opt/backups/supabase
crontab -e     # 0 3 * * * /usr/local/bin/backup-supabase.sh
```

`PATRON_CONTENEDOR` debe casar con **exactamente un** contenedor. En el VPS
conviven cinco Postgres (Supabase, Dokploy, n8n, typebot), asi que un patron
como `db` mezclaria bases distintas. Comprobar siempre:

```bash
docker ps --format '{{.Names}}' | grep -- "<patron>"   # debe devolver 1 linea
```
