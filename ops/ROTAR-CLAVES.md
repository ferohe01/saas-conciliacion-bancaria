# Rotación de claves de Supabase (fuga del `service_role`)

> **Estado: RESUELTO.** Clave filtrada revocada, rotación completa en los cinco
> destinos, y la revisión de accesos no encontró ningún uso de la clave.
>
> - [x] Paso 1 — `JWT_SECRET` nuevo y claves `anon`/`service_role` regeneradas.
> - [x] Paso 2 — Supabase actualizado y recreado (archivo del VPS + UI de
>       Dokploy). **Verificado:** la clave filtrada devuelve 401; las nuevas,
>       200, y la `anon` respeta RLS. La fuga ya no da acceso.
> - [x] Paso 3 — App en Dokploy: rebuild hecho. **Verificado:** el bundle sirve
>       la `anon` nueva, el login llega a `invalid_credentials` (la cadena
>       completa funciona) y el `service_role` del servidor escribe bien.
> - [x] Paso 4 — n8n: actualizado `workflow_conciliacion_ia` (el que está en
>       uso). `workflow_conciliacion` (heurístico) se dejó con la clave vieja
>       a propósito: está fuera de uso y la clave ya no sirve para nada.
> - [x] Paso 5 — `.env.local` y `.env` actualizados, `.next` borrado.
> - [x] Paso 6 — Cierre: **sin indicios de uso de la clave filtrada.** Ver
>       "Revisión forense" al final.
>
> **Incidente cerrado el 2026-07-31 ~01:15 CEST.**
>
> Dos tropiezos que costaron una hora, por si se repite:
> **(a)** los primeros «Deploy» fueron sobre el servicio *Supabase* y no sobre
> la *Application* — se distinguen porque solo la Application tiene pestaña
> *Build Time Arguments*; **(b)** el editor tenía `.env.local` abierto y al
> guardar pisó las claves nuevas con el buffer viejo. Cerrar el archivo antes
> de tocarlo desde fuera. Además existe un **segundo** archivo `.env` (no solo
> `.env.local`) que también hay que actualizar.
>
> Las claves nuevas se escribieron directo en
> `/etc/dokploy/compose/supabase-supabase-lxnrhm/code/.env` por SSH, y el
> 2026-07-31 se pegaron también en la UI de Dokploy, así que un redespliegue
> del stack ya no las revierte. **Al rotar en el futuro, hacer siempre las dos
> cosas:** Dokploy guarda su propia copia del entorno y sobreescribe el archivo
> al desplegar.
>
> Para comparar una clave sin exponerla, mirar el **final** y la longitud: todas
> empiezan igual (`eyJhbGciOiJI…`, la cabecera JWT). `anon` = 169 caracteres,
> `service_role` = 180.
>
> El archivo temporal `/root/claves-supabase-nuevas.txt` y el respaldo
> `.env.bak-*` del VPS **ya fueron borrados**. Las claves en uso viven ahora
> solo en el `.env` del stack, en la UI de Dokploy, en n8n y en tu `.env.local`.

Lo que sigue es el procedimiento completo, por si hay que repetirlo.

## Qué pasó

`.claude/settings.local.json` (permisos locales de Claude Code) acumulaba
comandos `curl` autorizados con la clave pegada en el header `apikey`. El
archivo estaba **rastreado por git** desde el primer commit.

| Dato | Valor |
|---|---|
| Commits afectados | 3, entre el 2026-07-24 y el 2026-07-25 |
| Rama | `origin/master` — **pusheado** |
| Repo | `github.com/ferohe01/saas-conciliacion-bancaria` — **público** |
| Clave filtrada | `SUPABASE_SERVICE_ROLE_KEY`, **idéntica a la que está en uso** |
| También filtrada | La clave `anon` (pública por diseño; sin impacto propio) |

**Alcance del daño posible:** el `service_role` salta RLS. Quien la tenga puede
leer y escribir cualquier tabla de cualquier empresa (comprobantes, jobs,
conciliaciones) y usar la API de administración de Auth para crear o borrar
usuarios. El endpoint está expuesto en `https://supabase.fernandorh.com`.

Ya se hizo: el archivo se limpió, se añadió al `.gitignore` y se sacó del
índice con `git rm --cached`. **Eso no revoca la clave** — solo evita que se
siga filtrando.

## Antes de empezar: por qué esto no es un botón

En Supabase **self-hosted** no existe "regenerar service_role". Las claves
`anon` y `service_role` son JWT firmados con `JWT_SECRET`. No se pueden revocar
individualmente: hay que **cambiar `JWT_SECRET` y regenerar ambas**.

Consecuencias de cambiar `JWT_SECRET`:

- **Todas las sesiones activas se invalidan.** Los usuarios tendrán que volver
  a iniciar sesión. No se pierde ninguna cuenta ni dato.
- Hay que actualizar la clave `anon` **en todos lados a la vez**, incluida la
  que se incrusta en build-time (ver paso 3). Si se actualiza el servidor pero
  no el build, el login falla en el navegador sin error en el servidor.

Elegir una ventana de baja actividad. El corte total es de pocos minutos.

## Procedimiento

### 1. Generar el nuevo secreto y las claves

En el VPS (`95.111.245.187`):

```bash
# secreto nuevo (mínimo 32 caracteres)
openssl rand -base64 48 | tr -d '\n/+=' | head -c 48; echo
```

Con ese `JWT_SECRET`, generar los dos JWT. Supabase publica un generador en
`https://supabase.com/docs/guides/self-hosting#api-keys` (funciona offline, en
el navegador), o con `node`:

```bash
node -e '
const c=require("crypto");
const S=process.argv[1];
const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt=rol=>{const h=b({alg:"HS256",typ:"JWT"});
  const p=b({iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60*60*24*365*5,role:rol,iss:"supabase"});
  return `${h}.${p}.${c.createHmac("sha256",S).update(`${h}.${p}`).digest("base64url")}`};
console.log("ANON_KEY=",jwt("anon"));
console.log("SERVICE_ROLE_KEY=",jwt("service_role"));
' "EL_SECRETO_NUEVO"
```

Guardarlas en el gestor de contraseñas. **No pegarlas en ningún archivo del
repo, ni en un comando que Claude Code pueda memorizar como permiso.**

### 2. Supabase (VPS, vía Dokploy)

En el Compose de Supabase, reemplazar y redesplegar:

- `JWT_SECRET`
- `ANON_KEY`
- `SERVICE_ROLE_KEY`

Los consumen `kong`, `auth` (GoTrue), `rest` (PostgREST), `realtime` y
`storage`. Reiniciar el stack completo, no un contenedor suelto.

Verificar:

```bash
curl -sS -o /dev/null -w "anon nueva -> %{http_code}\n" \
  -H "apikey: NUEVA_ANON" https://supabase.fernandorh.com/rest/v1/
# esperado 200

curl -sS -o /dev/null -w "service_role VIEJA -> %{http_code}\n" \
  -H "apikey: VIEJA_SERVICE_ROLE" https://supabase.fernandorh.com/rest/v1/
# esperado 401 — si da 200, la rotación NO surtió efecto
```

### 3. App (Dokploy → `conciliacion.fernandorh.com`)

⚠️ Recordar la trampa documentada en `CLAUDE.md`: las `NEXT_PUBLIC_*` se
incrustan en build-time, así que van **dos veces**.

| Variable | Dónde | Valor |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *Environment* **y** *Build Time Arguments* | anon nueva |
| `SUPABASE_SERVICE_ROLE_KEY` | *Environment* **solamente** | service_role nueva |

Nunca poner el `service_role` como build arg: quedaría en las capas de la
imagen. **Rebuild completo**, no solo reinicio — si no, el bundle sigue con la
anon vieja.

Verificar: `curl -sS -w " [%{http_code}]\n" https://conciliacion.fernandorh.com/api/health`
y luego un login real desde el navegador.

### 4. n8n (`n8npucp.fernandorh.com`)

El nodo **"Actualizar Supabase"** de los dos workflows tiene el `service_role`
pegado a mano (ver `CLAUDE.md` → "Workflows n8n"):

- `workflow_conciliacion.json`
- `workflow_conciliacion_ia.json`

Editarlo en la UI de n8n en ambos. Si se reimporta el JSON, recordar que
también hay que reseleccionar la credencial del modelo y la credencial Header
Auth del webhook.

Verificar con una conciliación de prueba de punta a punta: el job debe llegar a
`completado`. Si el `service_role` quedó viejo, el job se queda en `procesando`
para siempre (n8n no puede escribir el resultado).

### 5. Local

En `.env.local`: `SUPABASE_SERVICE_ROLE_KEY` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
Borrar `.next` y levantar de nuevo (`npm run dev`) para que el bundle tome la
anon nueva.

### 6. Cierre

- [ ] Confirmar que la `service_role` vieja devuelve 401 (paso 2).
- [ ] Revisar los logs de Postgres/PostgREST por accesos anómalos desde el
      2026-07-24: conexiones fuera de las IP del VPS, borrados masivos, altas
      de usuarios que nadie hizo.
- [ ] Revisar `auth.users` por cuentas que no reconozcas.

## Sobre reescribir el historial de git

Se puede purgar el archivo del historial (`git filter-repo --path
.claude/settings.local.json --invert-paths`, o BFG) y forzar el push.

**No sustituye a la rotación y no deshace la exposición:** el repo es público,
así que GitHub conserva los objetos accesibles por SHA un tiempo, los forks
mantienen su copia, y los bots que rastrean GitHub buscando claves ya tuvieron
seis días para encontrarla. Rotar es lo que corta el acceso; reescribir es
higiene posterior y opcional.

Si se hace, reescribe todos los SHA a partir del primer commit afectado
(localizarlo con `git log -S` sobre la clave) — coordinarlo si hay
más de un clon del repo.

## Revisión forense (paso 6, hecha el 2026-07-31)

**Conclusión: no hay indicio alguno de que la clave filtrada se llegara a usar.**

### Cobertura

El stack de analítica de Supabase (Logflare, tablas `_analytics.log_events_*`
en la base `_supabase`) conservó los logs de Kong y GoTrue desde el
**2026-07-24 20:39 UTC**. El commit que publicó la clave es de las **21:08 UTC**
de ese mismo día. Hay registro desde media hora antes de que la clave
existiera: **la ventana está cubierta entera, sin punto ciego.**

Los logs sobreviven a los reinicios porque viven en Postgres, no en el
contenedor. Traefik **no tiene access log habilitado** y Kong perdió los suyos
al recrearse, así que esta es la única fuente — conviene no perderla de vista
en futuras investigaciones. Ojo: la IP de cliente que registra Kong
(`cf_connecting_ip`) es siempre la de Traefik (`172.22.0.15`), así que **no hay
atribución por IP**; el user-agent es lo único que discrimina.

### Hallazgos

Durante la ventana sí hubo escaneo automatizado contra el dominio de Supabase:

| Agente | Peticiones | Resultado |
|---|---|---|
| `TLM-Audit-Scanner/1.0` | 1272 | **401 en todas** |
| `pathscan/1.0` | 45 | 401 en todas |
| `recon-engine/0.1` (passive-recon) | 48 | 401 / 404 |
| `l9scan` (leakix.net) | 31 | 401 en todas |
| `Go-http-client/1.1` | 34 | 401 en todas |

**Ninguno autenticó jamás.** Las únicas peticiones con 2xx contra
`/rest/v1/*` y `/auth/v1/admin/*` vienen de `curl/8.19.0` y son, una por una,
trabajo propio de desarrollo: `Empresa Smoke SAC`, el job
`rec-2026-07-2fbe04`, los borrados de usuarios de prueba — las mismas rutas que
estaban en el allowlist de `.claude/settings.local.json`.

### Estado de los datos

- `auth.users`: **1 usuario**, el legítimo (`ferohe@hotmail.com`, alta 2026-07-29).
- Altas desde el 24 de julio: 1 usuario, 1 empresa, 1 membresía — todas del 29
  y todas esperadas.
- Sin cuentas, empresas ni registros que nadie reconozca.

### Límite honesto de esta conclusión

Los logs demuestran que **nadie autenticó** con la clave filtrada. Lo que no
puede demostrarse por definición es que nadie *copiara* el repositorio público
mientras estuvo expuesto. Como la clave ya está revocada, eso no da acceso a
nada; el riesgo residual es cero salvo por lo que se hubiera leído en ese
momento, y los logs dicen que no se leyó nada.
