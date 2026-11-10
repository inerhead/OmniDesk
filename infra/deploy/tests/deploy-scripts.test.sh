#!/usr/bin/env bash
# Pruebas de omnidesk-autodeploy y del cerrojo de omnidesk-deploy (SPEC 28), con `docker` y
# `omnidesk-deploy` simulados: no toca Docker ni la red. Necesita bash, flock (util-linux) y GNU
# coreutils, así que en macOS se ejecuta en un contenedor:
#
#   docker run --rm -v "$PWD/infra/deploy:/deploy:ro" debian:bookworm-slim bash /deploy/tests/deploy-scripts.test.sh
set -uo pipefail

DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
AUTODEPLOY=$DEPLOY_DIR/omnidesk-autodeploy
REAL_DEPLOY=$DEPLOY_DIR/omnidesk-deploy
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAILURES=0
CASE=

ok() { echo "  ✓ $*"; }
ko() {
  echo "  ✗ $*" >&2
  FAILURES=$((FAILURES + 1))
}
check() {
  local desc=$1
  shift
  if "$@"; then ok "$desc"; else ko "$desc"; fi
}

# Simulaciones. Estado en $FAKE_STATE: <servicio> = "<imagen> <salud>", fail_<tag> = before|after.
make_fakes() {
  mkdir -p "$WORK/fakebin"
  cat >"$WORK/fakebin/docker" <<'EOF'
#!/usr/bin/env bash
case $1 in
  ps)
    for a in "$@"; do
      case $a in label=com.docker.compose.service=*) svc=${a##*=} ;; esac
    done
    [[ -f $FAKE_STATE/$svc ]] && echo "$svc"
    exit 0 ;;
  inspect) cat "$FAKE_STATE/${!#}" ;;
  compose)
    echo "$*" >>"$FAKE_STATE/compose_calls"
    [[ -f $FAKE_STATE/backup_fails ]] && { echo "backup simulado: falla" >&2; exit 1; }
    sleep 1
    echo dump >"$FAKE_BACKUP_DIR/omnidesk-prod-$(date +%Y%m%d).dump"
    echo "backup simulado: ok" ;;
  pull) exit 1 ;;
  *) exit 0 ;;
esac
EOF
  cat >"$WORK/fakebin/omnidesk-deploy" <<'EOF'
#!/usr/bin/env bash
tag=$1
echo "$tag ${OMNIDESK_DEPLOY_LOCK_HELD:-sin_cerrojo}" >>"$FAKE_STATE/deploy_calls"
[[ -n ${FAKE_DEPLOY_SLEEP:-} ]] && sleep "$FAKE_DEPLOY_SLEEP"
case $(cat "$FAKE_STATE/fail_$tag" 2>/dev/null) in
  before) echo "despliegue simulado: falla antes de up" >&2; exit 1 ;;
  after)
    echo "ghcr.io/inerhead/omnidesk-api:$tag unhealthy" >"$FAKE_STATE/api"
    echo "ghcr.io/inerhead/omnidesk-gateway:$tag none" >"$FAKE_STATE/gateway"
    echo "despliegue simulado: healthcheck falla" >&2; exit 1 ;;
esac
echo "ghcr.io/inerhead/omnidesk-api:$tag healthy" >"$FAKE_STATE/api"
echo "ghcr.io/inerhead/omnidesk-gateway:$tag none" >"$FAKE_STATE/gateway"
mkdir -p "$OMNIDESK_HOME/releases/$tag"
touch "$OMNIDESK_HOME/releases/$tag/docker-compose.prod.yml"
ln -sfn "$OMNIDESK_HOME/releases/$tag" "$OMNIDESK_HOME/current"
echo "✅ desplegado $tag"
EOF
  chmod +x "$WORK/fakebin/docker" "$WORK/fakebin/omnidesk-deploy"
}

# Un VPS simulado vacío con la versión $1 en uso (o ninguna si $1 está vacío).
setup() {
  CASE=$1
  echo "▶ $CASE"
  export OMNIDESK_HOME=$WORK/$CASE/srv FAKE_STATE=$WORK/$CASE/state
  export FAKE_BACKUP_DIR=$OMNIDESK_HOME/backups/prod OMNIDESK_DEPLOY=$WORK/fakebin/omnidesk-deploy
  export PATH=$WORK/fakebin:$ORIGINAL_PATH
  unset FAKE_DEPLOY_SLEEP OMNIDESK_DEPLOY_LOCK_HELD
  mkdir -p "$OMNIDESK_HOME/releases" "$FAKE_STATE" "$FAKE_BACKUP_DIR"
  printf 'BACKUP_DIR=%s\nOMNIDESK_ENV=prod\n' "$FAKE_BACKUP_DIR" >"$OMNIDESK_HOME/.env.prod"
  if [[ -n ${2:-} ]]; then
    "$OMNIDESK_DEPLOY" "$2" >/dev/null
    : >"$FAKE_STATE/deploy_calls"
  fi
}

run_autodeploy() {
  OUT=$("$AUTODEPLOY" "$@" 2>&1)
  CODE=$?
}

last_log() { tail -n 1 "$OMNIDESK_HOME/autodeploy.log" 2>/dev/null; }
log_lines() { [[ -f $OMNIDESK_HOME/autodeploy.log ]] && wc -l <"$OMNIDESK_HOME/autodeploy.log" || echo 0; }
in_use() { basename "$(readlink -f "$OMNIDESK_HOME/current")"; }
result_line() { [[ $(tail -n 1 <<<"$OUT") == "OMNIDESK_RESULTADO=$1 en_uso=$2" ]]; }
log_has() { [[ $(last_log | cut -f2,3,4) == "$1" ]]; }
calls() { [[ $(tr '\n' '|' <"$FAKE_STATE/deploy_calls" 2>/dev/null) == "$1" ]]; }

ORIGINAL_PATH=$PATH
make_fakes

# --- omnidesk-autodeploy ---------------------------------------------------------------------

setup despliegue_correcto v0.1.5
run_autodeploy v0.1.6
check "código 0" test "$CODE" -eq 0
check "última línea: desplegado" result_line desplegado v0.1.6
check "log: desplegado" log_has $'v0.1.6\tdesplegado\ten_uso=v0.1.6'
check "en uso v0.1.6" test "$(in_use)" = v0.1.6
check "omnidesk-deploy recibe el cerrojo" calls 'v0.1.6 1|'
check "backup con el compose de v0.1.5" grep -q "releases/v0.1.5/docker-compose.prod.yml run --rm backup now" "$FAKE_STATE/compose_calls"
check "copia en pre-deploy" test -f "$FAKE_BACKUP_DIR/pre-deploy/omnidesk-prod-pre-v0.1.6.dump"
check "salida en autodeploy/v0.1.6.out" grep -q "OMNIDESK_RESULTADO=desplegado" "$OMNIDESK_HOME/autodeploy/v0.1.6.out"

setup tags_invalidos v0.1.5
for bad in 'v0.1.6; id' 'v0.1' 'main' '../v0.1.6' 'v0.1.6 v0.1.7' ''; do
  # shellcheck disable=SC2086
  run_autodeploy $bad
  check "rechaza «$bad»" test "$CODE" -eq 2
done
run_autodeploy 'v0.1.6; id'
check "con «v0.1.6; id» no ejecuta nada" test ! -s "$FAKE_STATE/deploy_calls"
check "no escribe log con un tag inválido" test "$(log_lines)" -eq 0

setup pausa v0.1.5
touch "$OMNIDESK_HOME/autodeploy.paused"
run_autodeploy v0.1.6
check "código 0" test "$CODE" -eq 0
check "log: pausado" log_has $'v0.1.6\tpausado\ten_uso=v0.1.5'
check "no despliega" test ! -s "$FAKE_STATE/deploy_calls"

setup no_avanza v0.1.5
run_autodeploy v0.1.4
check "menor: código 0" test "$CODE" -eq 0
check "menor: log omitido" log_has $'v0.1.4\tomitido\ten_uso=v0.1.5'
run_autodeploy v0.1.5
check "igual: omitido" result_line omitido v0.1.5
check "no despliega" test ! -s "$FAKE_STATE/deploy_calls"
check "motivo no_avanza" grep -q $'motivo=no_avanza' "$OMNIDESK_HOME/autodeploy.log"

setup comparacion_de_versiones v0.1.9
run_autodeploy v0.1.10
check "v0.1.10 es posterior a v0.1.9" result_line desplegado v0.1.10

setup cerrojo_ocupado v0.1.5
flock "$OMNIDESK_HOME/deploy.lock" sleep 3 &
LOCKER=$!
sleep 0.5
run_autodeploy v0.1.6
check "código distinto de 0" test "$CODE" -ne 0
check "log: ocupado" log_has $'v0.1.6\tocupado\ten_uso=v0.1.5'
check "no despliega ni hace backup" test ! -s "$FAKE_STATE/deploy_calls" -a ! -f "$FAKE_STATE/compose_calls"
wait "$LOCKER"

setup fallo_backup v0.1.5
touch "$FAKE_STATE/backup_fails"
run_autodeploy v0.1.6
check "código distinto de 0" test "$CODE" -ne 0
check "log: fallo_backup" log_has $'v0.1.6\tfallo_backup\ten_uso=v0.1.5'
check "no despliega" test ! -s "$FAKE_STATE/deploy_calls"

setup fallo_antes_de_up v0.1.5
echo before >"$FAKE_STATE/fail_v0.1.6"
run_autodeploy v0.1.6
check "código distinto de 0" test "$CODE" -ne 0
check "log: fallo_sin_cambios" log_has $'v0.1.6\tfallo_sin_cambios\ten_uso=v0.1.5'
check "sin rollback" calls 'v0.1.6 1|'
check "sin pausa" test ! -e "$OMNIDESK_HOME/autodeploy.paused"

setup rollback_correcto v0.1.5
echo after >"$FAKE_STATE/fail_v0.1.6"
run_autodeploy v0.1.6
check "código distinto de 0" test "$CODE" -ne 0
check "log: rollback" log_has $'v0.1.6\trollback\ten_uso=v0.1.5'
check "despliega v0.1.6 y vuelve a v0.1.5" calls 'v0.1.6 1|v0.1.5 1|'
check "en uso v0.1.5" test "$(in_use)" = v0.1.5
check "sin pausa" test ! -e "$OMNIDESK_HOME/autodeploy.paused"

setup fallo_sin_rollback v0.1.5
echo after >"$FAKE_STATE/fail_v0.1.6"
echo after >"$FAKE_STATE/fail_v0.1.5"
run_autodeploy v0.1.6
check "código distinto de 0" test "$CODE" -ne 0
check "log: fallo_sin_rollback" log_has $'v0.1.6\tfallo_sin_rollback\ten_uso=v0.1.5'
check "crea la pausa" test -e "$OMNIDESK_HOME/autodeploy.paused"
check "el mensaje indica restaurar el backup" grep -q "Restaura el backup previo" <<<"$OUT"
rm -f "$FAKE_STATE/fail_v0.1.5" "$FAKE_STATE/fail_v0.1.6"
run_autodeploy v0.1.7
check "la siguiente versión queda pausada" log_has $'v0.1.7\tpausado\ten_uso=v0.1.5'

setup retencion_pre_deploy v0.1.5
for v in 6 7 8 9; do
  run_autodeploy "v0.1.$v"
  sleep 1
done
check "conserva 3 copias previas" test "$(ls "$FAKE_BACKUP_DIR/pre-deploy" | wc -l)" -eq 3
check "borra la más antigua" test ! -f "$FAKE_BACKUP_DIR/pre-deploy/omnidesk-prod-pre-v0.1.6.dump"
check "una línea por ejecución" test "$(log_lines)" -eq 4

setup conexion_cortada v0.1.5
export FAKE_DEPLOY_SLEEP=2
mkfifo "$WORK/pipe"
"$AUTODEPLOY" v0.1.6 >"$WORK/pipe" 2>&1 &
PID=$!
head -c 1 <"$WORK/pipe" >/dev/null # lee un byte y cierra: el «SSH» se corta
sleep 0.5
kill -HUP "$PID" 2>/dev/null
wait "$PID"
check "termina el despliegue pese a SIGHUP y la salida cerrada" log_has $'v0.1.6\tdesplegado\ten_uso=v0.1.6'
check "la salida completa queda en el .out" grep -q "OMNIDESK_RESULTADO=desplegado" "$OMNIDESK_HOME/autodeploy/v0.1.6.out"
unset FAKE_DEPLOY_SLEEP

# --- cerrojo de omnidesk-deploy --------------------------------------------------------------

setup cerrojo_manual
flock "$OMNIDESK_HOME/deploy.lock" sleep 3 &
LOCKER=$!
sleep 0.5
OUT=$("$REAL_DEPLOY" v0.1.6 2>&1)
check "un segundo despliegue manual falla sin esperar" test $? -ne 0
check "dice que hay otro en curso" grep -q "otro despliegue en curso" <<<"$OUT"
OUT=$(OMNIDESK_DEPLOY_LOCK_HELD=1 "$REAL_DEPLOY" v0.1.6 2>&1)
check "con OMNIDESK_DEPLOY_LOCK_HELD=1 no espera el cerrojo (sigue hasta el pull)" grep -q "No se pudo descargar el bundle\|No hay sesión en ghcr.io" <<<"$OUT"
wait "$LOCKER"
OUT=$("$REAL_DEPLOY" v0.1.6 2>&1)
check "libre el cerrojo, avanza hasta el pull" grep -q "No se pudo descargar el bundle\|No hay sesión en ghcr.io" <<<"$OUT"

echo
if ((FAILURES > 0)); then
  echo "❌ $FAILURES comprobaciones fallaron"
  exit 1
fi
echo "✅ todas las comprobaciones pasaron"
