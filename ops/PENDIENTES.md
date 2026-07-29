# Pendientes y umbrales de escalado

Estado a **29/07/2026**. Nada de esto bloquea la operación actual; son mejoras
con su momento. Ordenado por lo que dolería si pasa.

---

## 1. Copia de seguridad fuera del proveedor · **el único hueco real**

**Hoy:** dumps diarios a las 3:00 en `/opt/backups/supabase` (14 días) más el
Auto Backup de instancia de Contabo.

**El hueco:** ambos viven en la misma cuenta de Contabo. Un impago, una
suspensión o unas credenciales comprometidas se llevan servidor **y** copias a
la vez.

**Qué falta:** un bucket externo (Backblaze B2, ~céntimos al mes para este
volumen). El script ya está preparado — es una línea:

```bash
sed -i 's|^RCLONE_REMOTE=.*|RCLONE_REMOTE="b2:tu-bucket/supabase"|' /usr/local/bin/backup-supabase.sh
```

Antes hay que crear la cuenta y correr `rclone config` en el VPS. Mientras
tanto, `ops/descargar-backup.ps1` baja copias al PC a mano.

**Cuándo:** antes del primer cliente que pague. Es el único punto de esta lista
que, si falla, no tiene arreglo posterior.

---

## 2. Escalar n8n · **por medición, no por número de clientes**

**Hoy:** modo cola con Redis y **2 workers × concurrencia 3** = hasta 6
ejecuciones simultáneas (antes: 1).

### Referencias medidas

| Fecha | Partidas | Comparaciones | Duración | Contexto |
|---|---|---|---|---|
| 27/07 | 200 × 205 | 41 000 | **33 s** | n8n 2.29.2, proceso único |
| 29/07 | 200 × 205 | 41 000 | **45 s** | n8n 2.31.7, modo cola |

**Una sola conciliación es algo MÁS LENTA en modo cola** — el trabajo pasa por
Redis y lo recoge un worker. No es un defecto: se cambia latencia de un trabajo
por capacidad de varios a la vez. Parte de la diferencia es también
variabilidad del LLM.

### El tiempo no crece parejo

El matching compara cada interno contra cada movimiento: **al doblar las
partidas, el trabajo se cuadruplica**.

| Partidas | Comparaciones | Estimado |
|---|---|---|
| 200 × 205 | 41 000 | 45 s (medido) |
| 500 × 500 | 250 000 | ~4 min |
| 1000 × 1000 | 1 000 000 | ~18 min |

`PRODUCT.md` dice 500–2000+ movimientos por conciliación: un cliente grande
puede ser de **quince o veinte minutos**.

### La consulta que avisa

```sql
select date_trunc('month', created_at) mes,
       count(*) jobs,
       round(avg(extract(epoch from completed_at - created_at))) seg_promedio,
       round(percentile_cont(0.95) within group (
         order by extract(epoch from completed_at - created_at))) p95
  from public.jobs_conciliacion
 where estado = 'completado'
 group by 1 order by 1;
```

### Umbrales

| Señal | Acción |
|---|---|
| p95 supera ~3 min con volúmenes parecidos | `replicas: 3` o `4` en el compose |
| Errores 429 del LLM | Agrupar adjudicaciones o limitar concurrencia en el flujo |
| Postgres sostenido >60 % en el pico | Separar Supabase a su propio VPS |
| Nada de lo anterior | **No tocar nada** |

**No fragmentar por clientes** (una instancia cada N empresas): multiplica la
operación por el número de cajas y exige un enrutador que hoy no existe. Separar
por **rol** (Supabase / n8n) escala lo que de verdad se satura. La excepción es
un cliente que exija aislamiento por contrato — decisión comercial, no técnica.

---

## 3. Realtime devuelve 403

Preexistente al despliegue; ocurría igual con el host anterior. Kong autentica
bien y es el servicio Realtime quien rechaza el handshake WebSocket.

**Impacto real: bajo.** `ProgresoConciliacion.tsx` tiene un polling de respaldo
escrito para esto. Cuesta unos segundos de latencia en la pantalla de progreso.

**Para diagnosticar:** logs del contenedor `supabase-supabase-lxnrhm-realtime-1`.

---

## 4. Health check y rollback en Dokploy

`/api/health` ya existe y está probado. Falta declararlo en **Advanced → Swarm
Settings** para que un despliegue roto revierta solo:

```json
{
  "Test": ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"],
  "Interval": 30000000000,
  "Timeout": 10000000000,
  "StartPeriod": 40000000000,
  "Retries": 3
}
```

(Docker cuenta en nanosegundos.)

---

## 5. Actualizar Next.js

Tres vulnerabilidades *high* de build-time (`next`/`postcss`/`sharp`), aceptadas
desde la Fase 7. No exponen la app en runtime.

**Cuándo:** en su propia sesión, con los tests delante y capacidad de revertir.
Nunca pegado a otro cambio.

---

## 6. Cabos sueltos de interfaz

- **Logo del BCP** — hoy hay un identificador de texto en su naranja, no el
  logotipo oficial. Guardar el SVG en `public/` (la carpeta no existe aún) y
  sustituir el bloque `MarcaBanco` en `ModalPago.tsx` por el `<img>` que está
  comentado encima.
- **Verificar el CCI dígito por dígito** en el modal de pago, con una prueba
  vencida. Ningún test detecta un dígito equivocado: la transferencia
  simplemente no llega.
- **`CONTACTO_SUSCRIPCION`** en `lib/suscripcion.ts` sigue siendo un
  placeholder (`mailto:ferohe22@gmail.com`). Cambiar por el canal comercial
  real.

---

## 7. Notas de operación aprendidas

- **Las migraciones se aplican como `supabase_admin`, no como `postgres`.** El
  propietario de las tablas en este Supabase self-hosted no es `postgres`, y el
  editor SQL corre todo en una transacción: un solo error revierte el bloque
  entero en silencio. Ver `ops/RESTAURAR.md`.
- **Dokploy reescribe `code/` en cada despliegue.** Editar un compose en disco
  no sirve: la copia autoritativa vive en su base de datos. Todo cambio va por
  su editor.
- **En un servicio Compose de Dokploy**, lo que se escribe en el panel
  *Environment* solo alimenta las sustituciones `${...}`. Si la variable no
  está listada en el `environment:` del compose, nunca llega al contenedor.
- **Tras vaciar la base, el pool de aprendizaje arranca de cero.** Las primeras
  conciliaciones van sin `ejemplos_aprendizaje`; la IA recupera criterio a
  medida que se acumulan decisiones humanas.
