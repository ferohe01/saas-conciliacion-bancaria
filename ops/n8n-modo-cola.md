# n8n en modo cola (Redis + workers)

Pasa n8n de **un solo proceso que hace todo** a **un recepcionista + varios
workers**. El VPS tiene 6 núcleos y hoy n8n usa efectivamente uno.

> **Estado:** propuesto, no aplicado. n8n vive en el compose de Dokploy
> `pucp-curso-4-n8nwithpostgres-gykdmw`, fuera de este repo.

## El fallo que hay que evitar

Los workers deben compartir con el n8n principal **exactamente la misma**
`N8N_ENCRYPTION_KEY`. Si difiere en un carácter, los workers no pueden
descifrar las credenciales y **todas las ejecuciones fallan** — con un error
que no menciona la clave por ningún lado.

Por eso la propuesta usa un **ancla de YAML** (`&n8n-env`): las variables se
escriben **una sola vez** y los dos servicios apuntan a ellas. Así es
imposible que se desincronicen.

## Cambios en el docker-compose.yml

### 1. Añadir Redis

Es donde vive la lista de tareas. Pequeño y rápido; su único trabajo es
sostener la cola.

```yaml
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    # appendonly: si Redis se reinicia, la cola no se pierde.
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - pucp-curso-4-n8nwithpostgres-gykdmw
```

Y en el bloque `volumes:` del final del fichero:

```yaml
  redis_data:
```

### 2. Extraer las variables comunes a un ancla

Arriba del todo, **antes** de `services:`:

```yaml
x-n8n-env: &n8n-env
  # ↓↓↓ PEGA AQUÍ, SIN CAMBIARLAS, las líneas de `environment:` que ya
  #     tiene hoy tu servicio n8n (DB_*, N8N_ENCRYPTION_KEY, N8N_SMTP_*,
  #     GENERIC_TIMEZONE, WEBHOOK_URL, etc.)
  #
  # ↓↓↓ y añade estas tres, que son las que activan el modo cola:
  EXECUTIONS_MODE: queue
  QUEUE_BULL_REDIS_HOST: redis
  QUEUE_BULL_REDIS_PORT: 6379
```

**Ojo al formato:** dentro del ancla las variables van como `CLAVE: valor`
(dos puntos), no como `- CLAVE=valor` (guion). Es la diferencia entre un mapa
y una lista de YAML, y el ancla necesita un mapa.

### 3. El servicio n8n usa el ancla

```yaml
  n8n:
    image: n8nio/n8n:2.29.2
    restart: unless-stopped
    environment:
      <<: *n8n-env
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
    # ... el resto (ports, volumes, networks, labels) se queda igual
```

### 4. Añadir los workers

```yaml
  n8n-worker:
    image: n8nio/n8n:2.29.2
    restart: unless-stopped
    command: worker --concurrency=3
    environment:
      <<: *n8n-env
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
    deploy:
      replicas: 2
    volumes:
      - n8n_data:/home/node/.n8n   # el mismo volumen que usa el principal
    networks:
      - pucp-curso-4-n8nwithpostgres-gykdmw
```

## Por qué 2 workers con concurrencia 3

`--concurrency` permite varias ejecuciones **dentro de un mismo proceso**. Para
el trabajo pesado de CPU (subset-sum, matching difuso) eso **no ayuda**: sigue
siendo un único bucle de eventos, el mismo problema de origen.

Lo que da paralelismo real son **más procesos worker**. La concurrencia dentro
de cada uno sí sirve para los ratos en que el worker está esperando sin hacer
nada: las llamadas al LLM y las escrituras a Supabase.

De ahí la mezcla: **2 procesos × concurrencia 3 = hasta 6 ejecuciones a la vez**,
ocupando ~800 MB. Quedan núcleos y memoria para Postgres, Supabase y la app,
que comparten la misma máquina.

Para subir después: `replicas: 3` o `4`. No pases de 4 mientras Supabase viva
en el mismo VPS — ahogarías la base de datos, y entonces todo va peor.

## Después de desplegar

1. **Los flujos y credenciales siguen igual.** No hay que reimportar nada.
2. **Los webhooks los sigue atendiendo el principal**, que responde al instante
   y delega la ejecución a un worker. Es justo lo que queremos.
3. Comprobar que los workers arrancaron y tomaron la cola:

```bash
docker compose -p pucp-curso-4-n8nwithpostgres-gykdmw ps
docker compose -p pucp-curso-4-n8nwithpostgres-gykdmw logs --tail=30 n8n-worker
```

En el log de un worker sano se ve que se conecta a Redis y queda esperando
trabajo.

4. **La prueba real:** dispara dos conciliaciones seguidas desde la app y mira
   en n8n que se ejecutan **a la vez**, no una tras otra.

## Si algo va mal

| Síntoma | Causa casi segura |
|---|---|
| Las ejecuciones fallan al usar credenciales | `N8N_ENCRYPTION_KEY` distinta entre principal y workers |
| Los trabajos se encolan y nadie los toma | Los workers no ven Redis (`QUEUE_BULL_REDIS_HOST`) |
| El webhook responde pero nunca termina nada | No hay ningún worker corriendo |

Volver atrás es quitar `EXECUTIONS_MODE: queue` y redesplegar: n8n vuelve al
modo de un solo proceso. Los flujos y los datos no se tocan.
