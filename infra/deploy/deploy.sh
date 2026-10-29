#!/usr/bin/env bash
# Despliegue de prod de OmniDesk (SPEC 27). En el VPS no hay código fuente: este script viaja en el
# bundle ghcr.io/inerhead/omnidesk-deploy:<tag> junto a su docker-compose.prod.yml y backup.sh, y
# lo lanza omnidesk-deploy desde la carpeta del release:
#
#   /srv/omnidesk/bin/omnidesk-deploy v0.1.2      # → /srv/omnidesk/releases/v0.1.2/deploy.sh v0.1.2
#
# Las etiquetas y las imágenes las publica el pipeline de GitHub (.github/workflows/release.yml),
# solo sobre commits verdes de main: un tag con bundle viene siempre de main. Este script descarga
# las imágenes de ese tag (necesita `docker login ghcr.io`) y no compila nada.
# Rollback = desplegar la etiqueta anterior. Guía completa: docs/despliegue.md.
# Variables opcionales: OMNIDESK_ENV_DIR (por defecto /srv/omnidesk, donde está .env.prod),
# HEALTH_TIMEOUT_S (por defecto 180).
set -euo pipefail

usage() {
  echo "Uso: $0 <vX.Y.Z>" >&2
  exit 2
}

fail() {
  echo "❌ $*" >&2
  exit 1
}

# Último valor de una clave del .env, sin comillas.
env_value() {
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n 1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//"
}

main() {
  [[ $# -eq 1 ]] || usage
  REF=$1
  [[ $REF =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    fail "prod solo se despliega desde una etiqueta vX.Y.Z publicada por el pipeline (recibido: $REF)"

  # La carpeta del release: el compose y backup.sh de esta versión están junto a este script.
  DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  [[ -f $DIR/docker-compose.prod.yml ]] || fail "No hay docker-compose.prod.yml junto a $0 (¿se extrajo el bundle completo?)"
  if [[ -f $DIR/VERSION && $(cat "$DIR/VERSION") != "$REF" ]]; then
    fail "Esta carpeta es del bundle $(cat "$DIR/VERSION"), no de $REF: usa /srv/omnidesk/bin/omnidesk-deploy $REF"
  fi

  ENV_FILE="${OMNIDESK_ENV_DIR:-/srv/omnidesk}/.env.prod"
  HEALTH_TIMEOUT_S=${HEALTH_TIMEOUT_S:-180}
  [[ -f $ENV_FILE ]] || fail "No existe $ENV_FILE (parte de $DIR/.env.prod.example)"
  grep -Eq '^[A-Z_]+=.*<' "$ENV_FILE" && fail "$ENV_FILE todavía tiene valores <…> sin rellenar"

  # Con una clave repetida, el valor que gana depende de cómo la lea Compose.
  duplicated=$(grep -E '^[A-Z_][A-Z0-9_]*=' "$ENV_FILE" | cut -d= -f1 | sort | uniq -d | tr '\n' ' ')
  [[ -z $duplicated ]] || fail "$ENV_FILE repite estas claves: ${duplicated}(deja una sola de cada una)"

  # Sin esta carpeta, el servicio backup no tiene dónde escribir y falla sin avisar.
  backup_dir=$(env_value BACKUP_DIR)
  [[ -d $backup_dir ]] || fail "BACKUP_DIR='$backup_dir' no existe en este servidor (créala con mkdir -p)"

  case $(env_value CORS_ORIGINS) in
    *localhost* | *127.0.0.1*) fail "CORS_ORIGINS de prod no puede incluir localhost (solo el origen público, sin /omnidesk)" ;;
  esac
  # La imagen del gateway se construye en el pipeline (SPEC 26) con estos valores fijados en la web;
  # un .env distinto no cambiaría la imagen y rompería las rutas.
  [[ $(env_value BASE_PATH) == /omnidesk ]] ||
    fail "BASE_PATH de prod debe ser /omnidesk: la imagen del gateway se construyó con esa base (recibido: '$(env_value BASE_PATH)')"
  [[ -z $(env_value VITE_API_URL) ]] ||
    fail "VITE_API_URL de prod debe estar vacía: la imagen del gateway se construyó con la API en el mismo origen"

  # La versión es el tag: la imagen del API la lleva dentro (APP_VERSION) y /health la devuelve.
  export APP_VERSION=$REF OMNIDESK_IMAGE_TAG=$REF
  echo "▶ omnidesk-prod ← $REF ($DIR)"

  compose=(docker compose -p omnidesk-prod --env-file "$ENV_FILE" -f "$DIR/docker-compose.prod.yml")

  # Prod no compila: descarga las imágenes que el pipeline publicó para este tag en ghcr.io (SPEC 26).
  echo "▶ pull de ghcr.io/inerhead/omnidesk-{api,gateway}:$REF"
  if ! "${compose[@]}" pull api gateway; then
    docker_config="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
    if ! grep -q 'ghcr.io' "$docker_config" 2>/dev/null; then
      fail "No hay sesión en ghcr.io. Inicia sesión con un token de solo lectura (read:packages): docker login ghcr.io -u <usuario-de-github>"
    fi
    fail "No se pudieron descargar las imágenes de $REF. O no existen (espera a que termine el job «images» en GitHub → Actions → release), o el token no es válido (docker login ghcr.io)"
  fi

  echo "▶ up"
  "${compose[@]}" up -d --no-build --remove-orphans

  echo "▶ Esperando el healthcheck del API (máx. ${HEALTH_TIMEOUT_S}s)"
  api=$("${compose[@]}" ps -q api)
  [[ -n $api ]] || fail "El contenedor api no existe"
  deadline=$((SECONDS + HEALTH_TIMEOUT_S))
  while :; do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$api" 2>/dev/null || echo missing)
    [[ $status == healthy ]] && break
    if [[ $status == unhealthy || $SECONDS -ge $deadline ]]; then
      "${compose[@]}" logs --tail 50 api >&2 || true
      fail "El API no quedó sano (estado: $status)"
    fi
    sleep 3
  done

  deployed=$("${compose[@]}" exec -T api node -e \
    "fetch('http://127.0.0.1:' + process.env.API_PORT + '/api/v1/health').then((r) => r.json()).then((b) => console.log(b.version))")
  [[ $deployed == "$APP_VERSION" ]] || fail "El API responde la versión '$deployed', se esperaba '$APP_VERSION'"

  "${compose[@]}" ps

  # La caché de build y las imágenes huérfanas se acumulan y llenarían un disco de 40 GB (SPEC 25).
  # Solo borra caché e imágenes sin uso, nunca contenedores ni volúmenes. Actúa sobre todo el host,
  # también sobre la caché de otras apps. Un fallo aquí no tumba el despliegue.
  echo "▶ limpieza de imágenes"
  docker builder prune -f --filter until=168h >/dev/null || echo "⚠ no se pudo limpiar la caché de build" >&2
  docker image prune -f >/dev/null || echo "⚠ no se pudieron limpiar las imágenes huérfanas" >&2
  # Cada despliegue descarga ~1 GB de imágenes con tag nuevo; las de versiones anteriores quedarían
  # en disco. Borra las de OmniDesk que ningún contenedor usa (se identifican por la etiqueta
  # `source` que pone el pipeline); las de otras apps y las que están en uso no se tocan.
  docker image prune -a -f --filter "label=org.opencontainers.image.source=https://github.com/inerhead/OmniDesk" >/dev/null ||
    echo "⚠ no se pudieron limpiar las imágenes de versiones anteriores" >&2

  echo "✅ omnidesk-prod desplegado: $deployed"
}

main "$@"
