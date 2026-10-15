#!/usr/bin/env bash
# Despliegue manual de OmniDesk. Se ejecuta EN EL VPS, desde el clon del repo:
#
#   infra/deploy/deploy.sh dev main       # dev se despliega desde main
#   infra/deploy/deploy.sh prod v0.1.0    # prod, desde una etiqueta vX.Y.Z
#
# Rollback = desplegar el ref anterior. Guía completa: docs/despliegue.md.
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

# Todo va dentro de `main`: bash lee el archivo entero antes de ejecutarlo, y el `git checkout` de
# abajo puede cambiar este mismo script a mitad de ejecución.
main() {
  [[ $# -eq 2 ]] || usage
  ENV_NAME=$1
  REF=$2
  [[ $ENV_NAME == dev || $ENV_NAME == prod ]] || usage
  if [[ $ENV_NAME == prod && ! $REF =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "prod solo se despliega desde una etiqueta vX.Y.Z (recibido: $REF)"
  fi

  ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
  ENV_FILE="${OMNIDESK_ENV_DIR:-/srv/omnidesk}/.env.$ENV_NAME"
  HEALTH_TIMEOUT_S=${HEALTH_TIMEOUT_S:-180}
  [[ -f $ENV_FILE ]] || fail "No existe $ENV_FILE (copia infra/deploy/.env.$ENV_NAME.example)"
  grep -Eq '^[A-Z_]+=.*<' "$ENV_FILE" && fail "$ENV_FILE todavía tiene valores <…> sin rellenar"

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
  git checkout -q --detach "$TARGET"

  if git rev-parse -q --verify "refs/tags/$REF" >/dev/null; then
    APP_VERSION=$REF
  else
    APP_VERSION=$(git rev-parse --short HEAD)
  fi
  export APP_VERSION
  echo "▶ omnidesk-$ENV_NAME ← $REF ($(git rev-parse --short HEAD)), versión $APP_VERSION"

  compose=(docker compose -p "omnidesk-$ENV_NAME" --env-file "$ENV_FILE" -f infra/deploy/docker-compose.prod.yml)

  # Una imagen a la vez: el build comparte CPU y RAM con el sitio existente.
  echo "▶ build"
  "${compose[@]}" build api
  "${compose[@]}" build gateway

  echo "▶ up"
  "${compose[@]}" up -d --remove-orphans

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
  echo "✅ omnidesk-$ENV_NAME desplegado: $deployed"
}

main "$@"
