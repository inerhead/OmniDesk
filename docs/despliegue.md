# Despliegue en el VPS

OmniDesk corre en un VPS propio con Docker Compose, en dos entornos aislados y bajo la subruta `/omnidesk` (SPEC 08):

| Entorno | Proyecto Compose | `.env` | Gateway en el host | URL pública | Se despliega desde |
| --- | --- | --- | --- | --- | --- |
| dev | `omnidesk-dev` | `/srv/omnidesk/.env.dev` | `127.0.0.1:8081` | <https://dev.gastromesa.com/omnidesk> | `main` |
| prod | `omnidesk-prod` | `/srv/omnidesk/.env.prod` | `127.0.0.1:8082` | <https://gastromesa.com/omnidesk> | una etiqueta `vX.Y.Z` |

```text
Internet ──HTTPS──▶ Nginx existente (TLS) ──/omnidesk/*──▶ gateway (Caddy, 127.0.0.1:808x)
                                                              ├─ /omnidesk/*      → build de la web (PWA)
                                                              └─ /omnidesk/api/*  → api:5001 (/api/*)  ──▶ postgres
                                                           backup ──pg_dump 03:00──▶ /srv/omnidesk/backups/<env>/
```

Cada proyecto tiene su red, su volumen `pgdata` y su carpeta de backups. Solo el gateway publica un puerto, y solo en `127.0.0.1`. Postgres no publica ninguno.

Archivos:

| Archivo | Qué es |
| --- | --- |
| `infra/deploy/docker-compose.prod.yml` | Servicios `postgres`, `api`, `gateway` y `backup` |
| `infra/deploy/.env.dev.example`, `.env.prod.example` | Plantillas de entorno (sin secretos) |
| `infra/deploy/deploy.sh` | Despliegue manual: `deploy.sh <dev\|prod> <git-ref>` |
| `infra/deploy/backup.sh` | `pg_dump` diario + rotación de 7 (lo ejecuta el servicio `backup`) |
| `infra/deploy/nginx-omnidesk.conf.example` | Fragmento para el Nginx existente |
| `apps/api/Dockerfile` (etapa `prod`) | API: usuario no root; `prisma migrate deploy` y después `node dist/main.js` |
| `infra/gateway/Dockerfile` + `Caddyfile.prod` | Build de la web servido por Caddy, proxy al API, caché y CSP |

## 1. Preparar el VPS (una vez)

Requisitos: Docker Engine con el plugin Compose v2, git y el Nginx que ya sirve `gastromesa.com` con TLS.

1. **Usuario y carpetas.** Despliega con un usuario del grupo `docker` (no root):

   ```bash
   sudo mkdir -p /srv/omnidesk/backups/dev /srv/omnidesk/backups/prod
   sudo chown -R "$USER": /srv/omnidesk
   git clone <url-del-repo> /srv/omnidesk/repo
   ```

   El clon de `/srv/omnidesk/repo` es solo para desplegar: nunca se edita a mano. Lo que falte se corrige en el repo y se vuelve a desplegar.

2. **Google OAuth (antes del primer despliegue).** En [Google Cloud Console](https://console.cloud.google.com/apis/credentials), en la credencial **ID de cliente de OAuth → Aplicación web** de cada entorno (pueden ser la misma o dos distintas):

   | Entorno | Orígenes autorizados de JavaScript | URI de redirección autorizados |
   | --- | --- | --- |
   | dev | `https://dev.gastromesa.com` | `https://dev.gastromesa.com/omnidesk/api/v1/auth/google/callback` |
   | prod | `https://gastromesa.com` | `https://gastromesa.com/omnidesk/api/v1/auth/google/callback` |

   Si la pantalla de consentimiento está en modo _Testing_, solo entran los usuarios de prueba que añadas.

3. **Archivos de entorno.** Copia las plantillas y rellena los valores marcados con `<…>`:

   ```bash
   cd /srv/omnidesk/repo
   cp infra/deploy/.env.dev.example  /srv/omnidesk/.env.dev
   cp infra/deploy/.env.prod.example /srv/omnidesk/.env.prod
   chmod 600 /srv/omnidesk/.env.*
   openssl rand -hex 24   # una POSTGRES_PASSWORD distinta por entorno
   ```

   - `POSTGRES_PASSWORD`: solo letras y números, porque va dentro de `DATABASE_URL`.
   - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`: los de la credencial del paso 2.
   - Ya vienen fijados: `NODE_ENV=production`, `DEMO_MODE=false`, `SESSION_COOKIE_SECURE=true` y `TRUST_PROXY=2` (Nginx + Caddy).
   - `APP_VERSION` se deja vacía: la rellena `deploy.sh`.

   `deploy.sh` se niega a desplegar si queda algún `<…>` sin rellenar.

4. **Nginx.** Añade el fragmento de `infra/deploy/nginx-omnidesk.conf.example` dentro del `server` HTTPS de cada dominio, con el puerto del entorno (8081 en `dev.gastromesa.com`, 8082 en `gastromesa.com`). Incluye el `map $http_upgrade $connection_upgrade` si tu `http {}` no lo tiene. El fragmento solo añade `location`s bajo `/omnidesk`: el sitio de la raíz sigue igual.

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

   Hasta el primer despliegue, `/omnidesk/` responde `502`. Es lo esperado.

## 2. Primer despliegue

```bash
cd /srv/omnidesk/repo
infra/deploy/deploy.sh dev main
```

`deploy.sh` hace lo siguiente:

1. Valida los argumentos y el `.env`.
2. Hace `git fetch` y el checkout del ref. Una rama se toma de `origin`; una etiqueta o un commit, tal cual.
3. Construye primero la imagen del API y después la del gateway, una a la vez para no quitarle CPU ni RAM al sitio existente.
4. Ejecuta `up -d`.
5. Espera a que el healthcheck del API esté sano.
6. Comprueba que `/health` responde la versión desplegada e imprime `✅ omnidesk-dev desplegado: <versión>`.

Si algo falla, muestra los logs del API y termina con un código distinto de 0. Al arrancar, el API aplica las migraciones pendientes (`prisma migrate deploy`) antes de aceptar peticiones. Si una migración falla, el API no arranca y el healthcheck no pasa.

Comprobaciones:

```bash
curl -s https://dev.gastromesa.com/omnidesk/api/v1/health      # {"status":"ok","checks":{"database":"up"},"version":"<commit>"}
docker compose -p omnidesk-dev --env-file /srv/omnidesk/.env.dev -f infra/deploy/docker-compose.prod.yml ps
```

En `ps`, los 4 servicios deben aparecer en marcha y solo `gateway` con un puerto (`127.0.0.1:8081->80/tcp`). Abre <https://dev.gastromesa.com/omnidesk> y entra con Google. El primer login lleva a **Crea tu empresa**. El punto de conexión debe mostrar **En vivo**: es el WebSocket por `wss://…/omnidesk/api/realtime` a través de Nginx.

**Prod**, con la etiqueta:

```bash
git tag v0.1.0 && git push origin v0.1.0     # desde tu máquina
infra/deploy/deploy.sh prod v0.1.0           # en el VPS
```

La página **Estado** muestra `v0.1.0`. Las bases de dev y prod son independientes: un usuario creado en dev no existe en prod.

### Instalar la PWA en el celular

- **Android (Chrome):** abre `https://dev.gastromesa.com/omnidesk` y pulsa **Instalar app**.
- **iPhone (Safari):** Compartir → **Añadir a pantalla de inicio**. Haz el login con Google **dentro** de la app instalada: en modo standalone, iOS guarda cookies separadas de Safari.

## 3. Actualizar

```bash
cd /srv/omnidesk/repo
infra/deploy/deploy.sh dev main          # dev: lo último de main
```

Para prod:

1. Haz un **backup manual** (ver §5).
2. Crea y sube la etiqueta nueva (`vX.Y.Z`).
3. Ejecuta `infra/deploy/deploy.sh prod vX.Y.Z`.

`deploy.sh` rechaza en prod cualquier ref que no sea una etiqueta `vX.Y.Z`.

El despliegue tiene una caída breve mientras se recrean los contenedores (no hay blue/green). La PWA instalada muestra **Nueva versión disponible** y no se recarga sola.

**Si el build en el VPS molesta al sitio existente**, construye en tu máquina y copia las imágenes:

```bash
# En tu máquina, en el mismo commit y con el mismo .env (los nombres de imagen salen del proyecto Compose)
APP_VERSION=v0.1.0 docker compose -p omnidesk-prod --env-file .env.prod -f infra/deploy/docker-compose.prod.yml build
docker save omnidesk-prod-api omnidesk-prod-gateway | gzip | ssh vps 'gunzip | docker load'
# En el VPS: checkout del mismo ref y
APP_VERSION=v0.1.0 docker compose -p omnidesk-prod --env-file /srv/omnidesk/.env.prod -f infra/deploy/docker-compose.prod.yml up -d --no-build
```

## 4. Rollback

Para volver atrás, despliega el ref anterior:

```bash
infra/deploy/deploy.sh prod v0.1.0       # la etiqueta anterior
infra/deploy/deploy.sh dev <commit>      # dev acepta cualquier commit
```

Las migraciones solo avanzan. Si la versión nueva aplicó una migración que la anterior no tolera (por ejemplo, borró o renombró una columna), hay dos pasos: restaura el backup previo al despliegue (§5) y después despliega el ref anterior.

## 5. Backups

El servicio `backup` ejecuta `pg_dump -Fc` cada día a las 03:00, hora del servidor (monta `/etc/localtime`). Guarda en `BACKUP_DIR` y conserva los 7 más recientes por entorno:

```text
/srv/omnidesk/backups/dev/omnidesk-dev-20261012.dump
/srv/omnidesk/backups/prod/omnidesk-prod-20261012.dump
```

Un dump se escribe primero a `*.partial` y solo se renombra cuando termina bien. El log está en `docker compose … logs backup`.

**Backup manual** (antes de cada despliegue a prod):

```bash
docker compose -p omnidesk-prod --env-file /srv/omnidesk/.env.prod -f infra/deploy/docker-compose.prod.yml run --rm backup now
```

Si hay más de un backup el mismo día, el último reemplaza al anterior, porque el nombre lleva la fecha.

### Restaurar un backup

Ejemplo en dev. Para prod, cambia `dev` por `prod` en el proyecto, el `.env` y el archivo.

```bash
cd /srv/omnidesk/repo
C="docker compose -p omnidesk-dev --env-file /srv/omnidesk/.env.dev -f infra/deploy/docker-compose.prod.yml"
DUMP=omnidesk-dev-20261012.dump

# 1. Para el API y el gateway (nadie escribe durante la restauración)
$C stop gateway api

# 2. Restaura sobre la base (el contenedor backup ve el dump en /backups)
$C run --rm --entrypoint sh backup -c \
  "pg_restore -U \$POSTGRES_USER -d \$POSTGRES_DB --clean --if-exists --no-owner /backups/$DUMP"

# 3. Vuelve a arrancar
$C up -d
```

Para comprobar un dump sin tocar la base, restáuralo en una base vacía y compara los conteos:

```bash
$C exec postgres sh -c 'createdb -U $POSTGRES_USER restore_check'
$C run --rm --entrypoint sh backup -c \
  "pg_restore -U \$POSTGRES_USER -d restore_check --clean --if-exists --no-owner /backups/$DUMP"
Q='select (select count(*) from conversations), (select count(*) from messages)'
$C exec postgres sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -Atc '$Q'; psql -U \$POSTGRES_USER -d restore_check -Atc '$Q'"
$C exec postgres sh -c 'dropdb -U $POSTGRES_USER restore_check'
```

Los conteos coinciden si nadie escribió después del dump.

## 6. Operación diaria

```bash
C="docker compose -p omnidesk-dev --env-file /srv/omnidesk/.env.dev -f infra/deploy/docker-compose.prod.yml"
$C ps                       # estado y healthchecks
$C logs -f --tail 100 api   # logs JSON (pino) con x-request-id
$C restart api
```

Todos los servicios tienen `restart: unless-stopped`: vuelven solos tras reiniciar el VPS.

## 7. Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| `502` en `/omnidesk/` | El gateway no está arriba (`$C ps`) o el puerto del `proxy_pass` no es el del entorno. |
| El badge no pasa a **En vivo** (se queda en reconectando) | Nginx no reenvía el upgrade: faltan `Upgrade`/`Connection` o el `map`. La app sigue usable con el polling de respaldo de 15 s. |
| Tras el login de Google se vuelve a `/login` | La cookie no se guarda. Revisa que `SESSION_COOKIE_SECURE=true` y `TRUST_PROXY=2`, que Nginx envía `X-Forwarded-Proto` y que `APP_URL` y `PUBLIC_BASE_PATH` terminan en `/omnidesk`. |
| Google responde `redirect_uri_mismatch` | Falta la URI de §1.2 en la credencial, o `GOOGLE_CALLBACK_URL` no coincide con ella. |
| `403 Origen no permitido` al enviar | `CORS_ORIGINS` no es exactamente `https://<dominio>` (sin `/omnidesk` ni barra final). |
| El API no arranca tras un despliegue | Una migración falló: `$C logs api`. Corrige en el repo y vuelve a desplegar, o haz rollback (§4). |

## 8. Evolución (fuera de SPEC 08)

- **Copias de los backups fuera del VPS** (S3 u otro): hoy los backups están en el mismo disco que la base, un riesgo aceptado en este spec.
- CI/CD con registro de imágenes y despliegue automático.
- Despliegue sin caída (blue/green).
- Varias instancias del API, que requieren el adapter Redis de Socket.IO.
- Monitoreo y alertas (SPEC 11).
