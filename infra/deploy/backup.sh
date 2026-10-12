#!/bin/sh
# Backup de Postgres del servicio `backup` (docker-compose.prod.yml).
#   omnidesk-backup.sh       → bucle: un pg_dump -Fc cada día a las 03:00 (hora del servidor)
#   omnidesk-backup.sh now   → un backup inmediato y termina
# Archivo: /backups/omnidesk-<env>-YYYYMMDD.dump (BACKUP_DIR en el host). Conserva los BACKUP_KEEP más recientes.
# Restauración: docs/despliegue.md → "Restaurar un backup".
set -eu

: "${OMNIDESK_ENV:?falta OMNIDESK_ENV}"
: "${POSTGRES_USER:?falta POSTGRES_USER}"
: "${POSTGRES_DB:?falta POSTGRES_DB}"
KEEP="${BACKUP_KEEP:-7}"
DIR=/backups
PREFIX="omnidesk-${OMNIDESK_ENV}-"

log() {
  echo "[backup $(date '+%Y-%m-%d %H:%M:%S')] $*"
}

backup_once() {
  file="${DIR}/${PREFIX}$(date +%Y%m%d).dump"
  # Se escribe a un temporal: un dump a medias nunca reemplaza al bueno ni cuenta en la rotación.
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "${file}.partial"
  mv "${file}.partial" "$file"
  log "OK $(basename "$file") ($(du -h "$file" | cut -f1))"
  # Rotación por nombre (la fecha va en el nombre): se borran todos menos los KEEP más recientes.
  ls -1 "$DIR" | grep -E "^${PREFIX}[0-9]{8}\.dump$" | sort -r | tail -n +"$((KEEP + 1))" |
    while read -r old; do
      rm -f "${DIR}/${old}"
      log "Rotado ${old}"
    done
}

seconds_until_next_run() {
  now=$(date +%s)
  next=$(date -d 'today 03:00' +%s)
  [ "$next" -gt "$now" ] || next=$(date -d 'tomorrow 03:00' +%s)
  echo $((next - now))
}

if [ "${1:-}" = "now" ]; then
  backup_once
  exit 0
fi

# `docker compose stop` manda SIGTERM: se sale sin esperar al timeout.
trap 'log "Detenido"; exit 0' TERM INT
log "Programado a las 03:00 (${PREFIX}*.dump, se conservan ${KEEP})"
while true; do
  wait_s=$(seconds_until_next_run)
  sleep "$wait_s" &
  wait $!
  # Un fallo (p. ej. Postgres reiniciando) no detiene el servicio: se reintenta al día siguiente.
  backup_once || log "ERROR: el backup falló"
done
