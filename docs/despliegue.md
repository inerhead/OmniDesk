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
   - `PLATFORM_ADMIN_EMAILS`: los emails de Google, separados por comas, que aprueban, rechazan y suspenden empresas en `/platform` (SPEC 18). Vacía, el API arranca con un aviso en el log y las empresas nuevas se quedan en revisión.
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

El servicio `backup` ejecuta `pg_dump -Fc` cada día a las 03:00, hora del servidor (monta `/etc/localtime`). Guarda en `BACKUP_DIR` y conserva los 7 más recientes por entorno. El mismo paso archiva el volumen de MinIO (`omnidesk-<env>-media-YYYYMMDD.tar.gz`); la restauración de esos archivos está en [Adjuntos y MinIO](#adjuntos-y-minio-spec-14).

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

# 1b. Solo en un servidor nuevo: los roles de SPEC 12 son del clúster y el dump no los trae.
#     Sin ellos, pg_restore no puede crear las políticas de RLS ni los permisos. El API fija la
#     contraseña de omnidesk_app_login al arrancar (paso 3).
$C exec postgres sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \"DO \\\$\\\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='omnidesk_app') THEN CREATE ROLE omnidesk_app NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='omnidesk_app_login') THEN CREATE ROLE omnidesk_app_login LOGIN IN ROLE omnidesk_app; END IF; END \\\$\\\$\""

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

Todos los servicios tienen `restart: unless-stopped`: vuelven solos tras reiniciar el VPS. Si un servicio sigue vivo pero deja de responder, lo reinicia `autoheal` (ver [Autorreparación](#autorreparación-spec-19)).

## 7. Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| `502` en `/omnidesk/` | El gateway no está arriba (`$C ps`) o el puerto del `proxy_pass` no es el del entorno. |
| El badge no pasa a **En vivo** (se queda en reconectando) | Nginx no reenvía el upgrade: faltan `Upgrade`/`Connection` o el `map`. La app sigue usable con el polling de respaldo de 15 s. |
| Tras el login de Google se vuelve a `/login` | La cookie no se guarda. Revisa que `SESSION_COOKIE_SECURE=true` y `TRUST_PROXY=2`, que Nginx envía `X-Forwarded-Proto` y que `APP_URL` y `PUBLIC_BASE_PATH` terminan en `/omnidesk`. |
| Google responde `redirect_uri_mismatch` | Falta la URI de §1.2 en la credencial, o `GOOGLE_CALLBACK_URL` no coincide con ella. |
| `403 Origen no permitido` al enviar | `CORS_ORIGINS` no es exactamente `https://<dominio>` (sin `/omnidesk` ni barra final). |
| El API no arranca tras un despliegue | Una migración falló: `$C logs api`. Corrige en el repo y vuelve a desplegar, o haz rollback (§4). |
| Las empresas nuevas se quedan en **Solicitud en revisión** y nadie ve **Plataforma** | `PLATFORM_ADMIN_EMAILS` está vacía o no tiene el email exacto de tu cuenta de Google (SPEC 18). Al arrancar, el API lo avisa en `$C logs api`. Corrige el `.env` y vuelve a desplegar. |
| Cloudflare responde **error 1033** en `/omnidesk/` | El túnel no tiene ninguna conexión: `cloudflared` sigue "Up" pero se quedó colgado (típico tras una suspensión del host o un corte de red). `autoheal` lo reinicia solo en unos 4 min desde el corte. Para no esperar: `$C restart cloudflared`. Ver [Autorreparación](#autorreparación-spec-19). |
| `413` al adjuntar | Falta `client_max_body_size 20m` en el `location /omnidesk/` de Nginx. Sin esa línea, Nginx corta a partir de 1 MB. |

## 8. Evolución (fuera de SPEC 08)

- **Copias de los backups fuera del VPS** (S3 u otro): hoy los backups están en el mismo disco que la base, un riesgo aceptado en este spec.
- CI/CD con registro de imágenes y despliegue automático.
- Despliegue sin caída (blue/green).
- Varias instancias del API, que requieren el adapter Redis de Socket.IO.
- Monitoreo y alertas (SPEC 11).


## Secretos de canales y WhatsApp (SPEC 09)

`CHANNEL_SECRETS_KEY` cifra HMAC, access tokens y app secrets de Meta. Guarda una copia segura de la clave de cada entorno separada del backup de PostgreSQL. Las claves `VAPID_*` (Web Push) van en el mismo sitio: regenerarlas invalida las suscripciones y cada dispositivo debe volver a activarlas. Restaurar solo la base sin la misma clave deja los secretos ilegibles. Si se pierde la clave, configura una nueva, vuelve a introducir los secretos Meta desde Settings y rota las credenciales de integración; actualiza n8n con el nuevo HMAC.

Las imágenes del API aplican las migraciones al arrancar. La migración de WhatsApp añade `WHATSAPP_CLOUD` y sus campos de configuración sin modificar los canales N8N existentes. `WHATSAPP_GRAPH_VERSION` se pasa al API desde Compose de producción; por defecto usa `v25.0`. `APP_URL` debe coincidir con el dominio y subruta públicos: de él sale el callback que se muestra en Settings.

Mantén el reloj del servidor sincronizado (NTP) para la tolerancia HMAC de ±300 segundos. La conexión de WhatsApp y n8n se configura por empresa siguiendo [la guía de integración](integracion-n8n.md).

## Adjuntos y MinIO (SPEC 14)

El API de producción exige `ATTACHMENT_STORAGE_DRIVER=s3`. Compose lo fija y apunta a MinIO del mismo proyecto (`http://minio:9000`, bucket `omnidesk-attachments`). En el `.env` del entorno hay que rellenar:

| Variable | Uso |
| --- | --- |
| `MINIO_ROOT_USER` | Usuario raíz de MinIO y `S3_ACCESS_KEY_ID` del API. |
| `MINIO_ROOT_PASSWORD` | Contraseña (`openssl rand -hex 24`, solo letras y números) y `S3_SECRET_ACCESS_KEY`. |
| `MINIO_HOST_PORT` | Puerto S3 publicado solo en `127.0.0.1`. Dev `9050`, prod `9060`. No pueden coincidir en el mismo VPS. |
| `S3_BUCKET` | Opcional. Por defecto `omnidesk-attachments`. |
| `ATTACHMENT_INBOUND_MAX_BYTES` | Opcional. Tope de un adjunto entrante; por defecto 25 MB (`26214400`). |

Fuera de producción, si no se define el driver, el API usa `memory` (los archivos se pierden al reiniciar). `.env.example` de desarrollo local pone `s3` para usar el MinIO de `docker-compose.yml`. La consola de ese MinIO local está en <http://localhost:9051>.

`client_max_body_size 20m` en el `location /omnidesk/` de Nginx es obligatorio. El API admite 16 MB por archivo saliente; sin esa directiva Nginx responde `413` a partir de 1 MB.

MinIO no publica consola en el VPS. Para administrarlo, abre un túnel SSH al puerto `MINIO_HOST_PORT`.

Si `docker pull minio/minio:RELEASE.2025-09-07T16-13-09Z` falla (el tag no siempre está en Docker Hub), carga la imagen desde una máquina que ya la tenga:

```bash
docker save minio/minio:RELEASE.2025-09-07T16-13-09Z | ssh vps docker load
```

El volumen se llama `<proyecto>_miniodata` (`omnidesk-dev_miniodata` o `omnidesk-prod_miniodata`). El `backup now` escribe `omnidesk-<env>-media-YYYYMMDD.tar.gz` junto al dump de Postgres y conserva los 7 más recientes. Un `tar` en caliente puede no incluir un objeto que se está escribiendo en ese momento.

Restaurar los adjuntos de dev (en prod, cambia el proyecto, el `.env` y el nombre del archivo):

```bash
cd /srv/omnidesk/repo
C="docker compose -p omnidesk-dev --env-file /srv/omnidesk/.env.dev -f infra/deploy/docker-compose.prod.yml"
$C stop api minio
docker run --rm -v omnidesk-dev_miniodata:/data -v /srv/omnidesk/backups/dev:/b alpine \
  sh -c 'rm -rf /data/* && tar -xzf /b/omnidesk-dev-media-YYYYMMDD.tar.gz -C /data'
$C up -d
```

El envío de adjuntos no tiene rate limit: SPEC 10 no está en el repositorio. Cuando exista, debe cubrir `POST /api/v1/conversations/:id/messages/attachments`.

## Retención y Row Level Security (SPEC 12)

**Antes de desplegar SPEC 12 por primera vez en un entorno:**

1. Añade al `.env` del entorno `DATABASE_APP_PASSWORD` (`openssl rand -hex 24`: va dentro de una URL, solo letras y números). Compose arma con ella `DATABASE_APP_URL`. Sin esa variable, Compose no levanta el API.
2. Haz un **backup manual** (§5). La migración de RLS no toca datos, pero cambia quién puede leerlos.
3. Despliega primero en **dev** y recorre la app (login, bandejas, asignar, responder, ticks, un mensaje de WhatsApp). Después, prod.

Al arrancar, el API aplica las migraciones `…_retention`, `…_app_role` y `…_rls`, y después `scripts/ensure-app-role.mjs` fija la contraseña de `omnidesk_app_login` con `DATABASE_APP_PASSWORD`. Si cambias la variable, basta con reiniciar el API.

**Dos roles de base de datos:**

| Rol | Variable | Para qué |
| --- | --- | --- |
| `omnidesk` (`POSTGRES_USER`, superusuario) | `DATABASE_URL` | Migraciones y caminos de sistema: resolver sesión y credencial, dispatcher del Outbox, job de retención, semilla demo, alta de empresa e invitaciones. Salta RLS. |
| `omnidesk_app_login` (hereda de `omnidesk_app`) | `DATABASE_APP_URL` | Todo lo que se atiende en nombre de una empresa: peticiones con sesión, integraciones y el webhook de WhatsApp. Sin `BYPASSRLS` y sin tablas propias. |

La migración de RLS falla a propósito si el rol que migra no es superusuario ni tiene `BYPASSRLS`: con `FORCE ROW LEVEL SECURITY`, el dueño se quedaría sin acceso.

**Job de retención.** Corre a las 03:30, hora del servidor (después del backup de las 03:00), con un advisory lock: aunque haya varias instancias, se ejecuta una sola vez. Lo que borra sigue en los backups durante 7 días. Qué se borra y qué no: [datos.md](datos.md).

**Restaurar en un servidor nuevo:** crea antes los roles (paso 1b de §5, *Restaurar un backup*).

## Autorreparación (SPEC 19)

Docker solo reinicia un contenedor cuando su proceso termina. Uno que sigue vivo pero ya no sirve (por ejemplo, el túnel sin conexiones con Cloudflare) se queda así hasta que alguien lo reinicia. El contenedor **`autoheal`** reinicia los que su healthcheck marca `unhealthy`, pero solo si llevan la etiqueta `autoheal=true`:

| Servicio | Healthcheck | Reinicio tras el fallo |
| --- | --- | --- |
| `cloudflared` (prod, dev y local) | `cloudflared tunnel ready`: falla con 0 conexiones activas | 3 fallos × 30 s + hasta 10 s: unos 100 s |
| `gateway` (prod y dev) | `wget` a `${BASE_PATH}/` | unos 100 s |
| `api` (prod y dev) | `GET /api/v1/health/live`: liveness, **no** mira la base | 5 fallos × 10 s + hasta 10 s: unos 60 s |

- **El API no se reinicia por la base.** Con Postgres caído, `/api/v1/health` responde `503` (es el que deben usar los monitores externos), pero `/health/live` sigue en `200`. Reiniciar el API no arreglaría la base.
- **Detección del túnel.** Tras un corte de red, `cloudflared` tarda unos 2–3 min en dar por perdidas sus conexiones. Después, autoheal lo reinicia en unos 70 s: unos 4 min desde el corte. Si el túnel ya está sin conexiones (como al despertar el host), basta con esos 70 s.
- **Reiniciar el gateway reinicia también el túnel**, que comparte su red (`network_mode: service:gateway`): se queda sin red, pasa a `unhealthy` y autoheal lo reinicia unos 100 s después.
- **Sin backoff.** Un servicio que falla siempre (por ejemplo, el API con una migración rota) se reinicia sin fin. Se ve en el log de autoheal.
- **`postgres`, `minio` y `backup` no llevan la etiqueta**: autoheal nunca los toca.
- **Seguridad.** autoheal monta `/var/run/docker.sock`, que da control total de Docker en el host. El `:ro` no limita esa API. La imagen va fijada (`willfarrell/autoheal:1.2.0`), sin puertos ni red publicada.

```bash
$C ps                                                         # columna STATUS: (healthy) / (unhealthy)
docker inspect --format '{{.State.Health.Status}}' omnidesk-prod-cloudflared
docker logs omnidesk-prod-autoheal                            # una línea por cada reinicio
```

**Si el servidor es un Mac** (por ejemplo, prod en un portátil): la causa más común de un túnel colgado es la suspensión. Déjalo con el cargador y desactiva la suspensión con corriente:

```bash
sudo pmset -c sleep 0 disksleep 0
pmset -g | grep -E ' sleep|disksleep'   # comprueba: sleep 0
```

Con la tapa cerrada se suspende igual, salvo con pantalla externa y cargador conectados.

