#!/usr/bin/env bash
# ============================================================================
# backup-supabase.sh — dump logico de Supabase + rotacion + copia fuera del VPS
#
# Se instala en el VPS (no lo usa la app):
#   cp ops/backup-supabase.sh /usr/local/bin/ && chmod +x /usr/local/bin/backup-supabase.sh
#   crontab -e  ->  0 3 * * * /usr/local/bin/backup-supabase.sh
#
# Complementa (no sustituye) al Auto Backup de instancia de Contabo: aquel
# cubre la perdida total del VPS incluyendo n8n/Dokploy/Traefik; este cubre la
# recuperacion granular y vive fuera de la cuenta del proveedor.
# ============================================================================
set -euo pipefail

# ─── Configuracion ──────────────────────────────────────────────────────────
DIR=/opt/backups/supabase                        # dumps locales
DIAS_LOCAL=14                                    # retencion en el VPS
RCLONE_REMOTE="b2:conciliacion-backups/supabase" # destino remoto ("" = no subir)
DIAS_REMOTO=90                                   # retencion en el remoto
PATRON_CONTENEDOR="supabase-db"                  # trozo del nombre del contenedor
LOG=/var/log/backup-supabase.log

exec >> "$LOG" 2>&1
trap 'echo "$(date "+%F %T") FALLO en la linea $LINENO (codigo $?)"' ERR
echo "═════ $(date '+%F %T') inicio"

# ─── 1. Localizar el contenedor de Postgres ─────────────────────────────────
# Se exige exactamente UNO: si el patron casa con varios (o con ninguno)
# preferimos fallar a volcar la base equivocada en silencio. Dokploy corre
# sobre Swarm, asi que los nombres llevan sufijos de tarea.
mapfile -t CANDIDATOS < <(docker ps --format '{{.Names}}' | grep -- "$PATRON_CONTENEDOR" || true)
if [ "${#CANDIDATOS[@]}" -ne 1 ]; then
  echo "ERROR: se esperaba 1 contenedor que case con '$PATRON_CONTENEDOR';"
  echo "       encontrados ${#CANDIDATOS[@]}: ${CANDIDATOS[*]:-ninguno}"
  echo "       ajusta PATRON_CONTENEDOR (mira 'docker ps --format {{.Names}}')"
  exit 1
fi
CONTENEDOR="${CANDIDATOS[0]}"
echo "contenedor: $CONTENEDOR"

# ─── 2. Dump ────────────────────────────────────────────────────────────────
mkdir -p "$DIR"
DESTINO="$DIR/supabase-$(date +%F-%H%M).sql.gz"
TMP="$DESTINO.parcial"

# pg_dumpall, NO pg_dump: se lleva los roles (anon, authenticated,
# service_role) y TODAS las bases, incluido el esquema auth. Con un pg_dump
# del esquema public se restauran los datos pero se pierde auth.users y
# ningun usuario puede volver a iniciar sesion.
#
# La contrasena se toma del entorno del propio contenedor: no queda escrita
# en este fichero ni en la tabla de cron.
docker exec "$CONTENEDOR" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dumpall -U postgres --clean --if-exists' \
  | gzip -9 > "$TMP"

# ─── 3. Validar antes de dar el backup por bueno ────────────────────────────
TAM=$(stat -c%s "$TMP")
if [ "$TAM" -lt 100000 ]; then
  echo "ERROR: el dump pesa $TAM bytes, demasiado poco. Se descarta."
  rm -f "$TMP"
  exit 1
fi

# grep -c (no -q) a proposito: -q corta la tuberia en cuanto encuentra la
# primera coincidencia, gunzip recibe SIGPIPE y con 'set -o pipefail' un
# backup correcto se marcaria como fallido (comprobado: estado 141). -c
# consume todo el flujo y devuelve 0.
if [ "$(gunzip -c "$TMP" | grep -c 'auth\.users' || true)" -eq 0 ]; then
  echo "ERROR: el dump no menciona auth.users — restaurarlo dejaria a todos"
  echo "       los usuarios sin poder iniciar sesion. Se descarta."
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$DESTINO"
echo "dump OK: $DESTINO ($(numfmt --to=iec "$TAM"))"

# ─── 4. Subir fuera del VPS ─────────────────────────────────────────────────
# Un backup en el mismo servidor no protege del escenario que importa: que el
# servidor (o la cuenta del proveedor) desaparezca.
if [ -n "$RCLONE_REMOTE" ]; then
  rclone copy "$DESTINO" "$RCLONE_REMOTE" --no-traverse
  echo "subido a $RCLONE_REMOTE"
  rclone delete "$RCLONE_REMOTE" --min-age "${DIAS_REMOTO}d" || true
else
  echo "AVISO: RCLONE_REMOTE vacio — el backup solo existe en este VPS"
fi

# ─── 5. Rotacion local ──────────────────────────────────────────────────────
find "$DIR" -name 'supabase-*.sql.gz' -mtime "+$DIAS_LOCAL" -delete
echo "copias locales: $(find "$DIR" -name 'supabase-*.sql.gz' | wc -l)"
echo "───── $(date '+%F %T') fin OK"
