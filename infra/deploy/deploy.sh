#!/usr/bin/env bash
# Despliegue manual de OmniDesk. Se ejecuta EN EL VPS, desde el clon del repo:
#
#   infra/deploy/deploy.sh dev main       # dev se despliega desde main
#   infra/deploy/deploy.sh prod v0.1.0    # prod, desde una etiqueta vX.Y.Z de main
#
# Las etiquetas las crea el pipeline de GitHub (.github/workflows/release.yml) sobre commits de main
# que pasan los checks y las migraciones. En prod, el tag debe estar contenido en origin/main.
# El pipeline también publica las imágenes de cada tag en ghcr.io (SPEC 26): prod las descarga
# (necesita `docker login ghcr.io`), no compila. Dev sí construye en el VPS, con cualquier ref.
# Rollback = desplegar la etiqueta anterior. Guía completa: docs/despliegue.md.
# Variables opcionales: OMNIDESK_ENV_DIR (por defecto /srv/omnidesk, donde están .env.dev y .env.prod),
# HEALTH_TIMEOUT_S (por defecto 180).
set -euo pipefail

usage() {
  echo "Uso: $0 <dev|prod> <git-ref>" >&2
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

# Todo va dentro de `main`: bash lee el archivo entero antes de ejecutarlo, y el `git checkout` de
# abajo puede cambiar este mismo script a mitad de ejecución.
main() {
  [[ $# -eq 2 ]] || usage
  ENV_NAME=$1
  REF=$2
  [[ $ENV_NAME == dev || $ENV_NAME == prod ]] || usage
  if [[ $ENV_NAME == prod && ! $REF =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "prod solo se despliega desde una etiqueta vX.Y.Z creada por el pipeline desde main (recibido: $REF)"
  fi

  ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
  ENV_FILE="${OMNIDESK_ENV_DIR:-/srv/omnidesk}/.env.$ENV_NAME"
  HEALTH_TIMEOUT_S=${HEALTH_TIMEOUT_S:-180}
  [[ -f $ENV_FILE ]] || fail "No existe $ENV_FILE (copia infra/deploy/.env.$ENV_NAME.example)"
  grep -Eq '^[A-Z_]+=.*<' "$ENV_FILE" && fail "$ENV_FILE todavía tiene valores <…> sin rellenar"

  # Con una clave repetida, el valor que gana depende de cómo la lea Compose.
  duplicated=$(grep -E '^[A-Z_][A-Z0-9_]*=' "$ENV_FILE" | cut -d= -f1 | sort | uniq -d | tr '\n' ' ')
  [[ -z $duplicated ]] || fail "$ENV_FILE repite estas claves: ${duplicated}(deja una sola de cada una)"

  # Sin esta carpeta, el servicio backup no tiene dónde escribir y falla sin avisar.
  backup_dir=$(env_value BACKUP_DIR)
  [[ -d $backup_dir ]] || fail "BACKUP_DIR='$backup_dir' no existe en este servidor (créala con mkdir -p)"

  if [[ $ENV_NAME == prod ]]; then
    case $(env_value CORS_ORIGINS) in
      *localhost* | *127.0.0.1*) fail "CORS_ORIGINS de prod no puede incluir localhost (solo el origen público, sin /omnidesk)" ;;
    esac
    # La imagen del gateway se construye en el pipeline (SPEC 26) con estos valores fijados en la web;
    # un .env distinto no cambiaría la imagen y rompería las rutas.
    [[ $(env_value BASE_PATH) == /omnidesk ]] ||
      fail "BASE_PATH de prod debe ser /omnidesk: la imagen del gateway se construyó con esa base (recibido: '$(env_value BASE_PATH)')"
    [[ -z $(env_value VITE_API_URL) ]] ||
      fail "VITE_API_URL de prod debe estar vacía: la imagen del gateway se construyó con la API en el mismo origen"
  fi

  cd "$ROOT"
  [[ -z $(git status --porcelain --untracked-files=no) ]] ||
    fail "El clon tiene cambios locales. Lo que falte se corrige en el repo, no a mano en el servidor."

  echo "▶ git fetch"
  git fetch --tags --prune --force origin
  # Una rama se despliega como está en origin; una etiqueta o un commit, tal cual.
  if git rev-parse -q --verify "refs/remotes/origin/$REF^{commit}" >/dev/null; then
    TARGET="origin/$REF"
  elif git rev-parse -q --verify "$REF^{commit}" >/dev/null; then
    TARGET=$REF
  else
    fail "El ref '$REF' no existe"
  fi
  # Un tag puesto a mano sobre una rama sin revisar no llega a prod.
  if [[ $ENV_NAME == prod ]]; then
    git rev-parse -q --verify refs/remotes/origin/main >/dev/null || fail "No existe origin/main"
    git merge-base --is-ancestor "$TARGET" origin/main ||
      fail "La etiqueta $REF no está contenida en origin/main: prod solo se despliega desde main"
  fi
  git checkout -q --detach "$TARGET"

  if git rev-parse -q --verify "refs/tags/$REF" >/dev/null; then
    APP_VERSION=$REF
  else
    APP_VERSION=$(git rev-parse --short HEAD)
  fi
  export APP_VERSION
  echo "▶ omnidesk-$ENV_NAME ← $REF ($(git rev-parse --short HEAD)), versión $APP_VERSION"

  compose=(docker compose -p "omnidesk-$ENV_NAME" --env-file "$ENV_FILE" -f infra/deploy/docker-compose.prod.yml)

  if [[ $ENV_NAME == prod ]]; then
    # Prod no compila: descarga las imágenes que el pipeline publicó para este tag en ghcr.io (SPEC 26).
    export OMNIDESK_IMAGE_TAG=$REF
    echo "▶ pull de ghcr.io/inerhead/omnidesk-{api,gateway}:$REF"
    if ! "${compose[@]}" pull api gateway; then
      docker_config="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
      if ! grep -q 'ghcr.io' "$docker_config" 2>/dev/null; then
        fail "No hay sesión en ghcr.io. Inicia sesión con un token de solo lectura (read:packages): docker login ghcr.io -u <usuario-de-github>"
      fi
      fail "No se pudieron descargar las imágenes de $REF. O no existen (espera a que termine el job «images» en GitHub → Actions → release; los tags anteriores a SPEC 26 no tienen imagen), o el token no es válido (docker login ghcr.io)"
    fi

    echo "▶ up"
    "${compose[@]}" up -d --no-build --remove-orphans
  else
    # Una imagen a la vez: el build comparte CPU y RAM con el sitio existente.
    echo "▶ build"
    "${compose[@]}" build api
    "${compose[@]}" build gateway

    echo "▶ up"
    "${compose[@]}" up -d --remove-orphans
  fi

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

  # La caché de build y las imágenes huérfanas se acumulan en cada despliegue y llenarían un disco
  # de 40 GB en pocos (SPEC 25). Solo borra caché e imágenes sin uso, nunca contenedores ni volúmenes.
  # Actúa sobre todo el host, también sobre la caché de otras apps. Un fallo aquí no tumba el despliegue.
  echo "▶ limpieza de caché de build"
  docker builder prune -f --filter until=168h >/dev/null || echo "⚠ no se pudo limpiar la caché de build" >&2
  docker image prune -f >/dev/null || echo "⚠ no se pudieron limpiar las imágenes huérfanas" >&2
  if [[ $ENV_NAME == prod ]]; then
    # Cada despliegue descarga ~1 GB de imágenes con tag nuevo; las de versiones anteriores quedarían
    # en disco. Borra las de OmniDesk que ningún contenedor usa (se identifican por la etiqueta
    # `source` que pone el pipeline); las de otras apps y las que están en uso no se tocan.
    docker image prune -a -f --filter "label=org.opencontainers.image.source=https://github.com/inerhead/OmniDesk" >/dev/null ||
      echo "⚠ no se pudieron limpiar las imágenes de versiones anteriores" >&2
  fi

  echo "✅ omnidesk-$ENV_NAME desplegado: $deployed"
}

main "$@"
