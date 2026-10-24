# Despliegue en el VPS

OmniDesk corre en un VPS propio con Docker Compose, en dos entornos aislados y bajo la subruta `/omnidesk` (SPEC 08):

| Entorno | Proyecto Compose | `.env` | Gateway en el host | URL pública | Se despliega desde |
| --- | --- | --- | --- | --- | --- |
| dev | `omnidesk-dev` | `/srv/omnidesk/.env.dev` | `127.0.0.1:8081` | <https://dev.gastromesa.com/omnidesk> | `main` |
| prod | `omnidesk-prod` | `/srv/omnidesk/.env.prod` | `127.0.0.1:8082` | <https://channel.gastromesa.com/omnidesk> (túnel de Cloudflare) | una etiqueta `vX.Y.Z` que crea el pipeline desde `main` |

> **Prod en OVHcloud (SPEC 25).** Prod llega por un túnel de Cloudflare, no por el Nginx que describen los pasos 1.4 y los diagramas de dev. Para prod sigue la sección [Prod en OVHcloud con Cloudflare Tunnel](#prod-en-ovhcloud-con-cloudflare-tunnel-spec-25); el resto de la guía aplica igual (migraciones, backups, restauración, rollback).

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
| `infra/deploy/docker-compose.prod.yml` | Servicios `postgres`, `api`, `gateway`, `backup`, `minio`, `cloudflared` y `autoheal` |
| `infra/deploy/.env.dev.example`, `.env.prod.example` | Plantillas de entorno (sin secretos) |
| `infra/deploy/deploy.sh` | Despliegue manual: `deploy.sh <dev\|prod> <git-ref>`. En prod solo acepta un tag `vX.Y.Z` contenido en `origin/main` |
| `.github/workflows/release.yml` | Pipeline de GitHub: en cada push a `main` comprueba el código y las migraciones, crea el siguiente tag `vX.Y.Z` (SPEC 25) y publica las imágenes de ese tag en `ghcr.io` (SPEC 26) |
| `.github/scripts/next-version.sh` | Calcula el siguiente tag a partir de los existentes |
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

4. **Nginx (solo dev, o prod con Nginx).** Con el túnel de Cloudflare de prod (SPEC 25) este paso **no aplica**: no hay Nginx delante, y el fragmento ni la ruta de `gastromesa.com` se usan. Añade el fragmento de `infra/deploy/nginx-omnidesk.conf.example` dentro del `server` HTTPS de cada dominio, con el puerto del entorno (8081 en `dev.gastromesa.com`, 8082 en `gastromesa.com`). Incluye el `map $http_upgrade $connection_upgrade` si tu `http {}` no lo tiene. El fragmento solo añade `location`s bajo `/omnidesk`: el sitio de la raíz sigue igual.

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

**Prod**, con la etiqueta que crea el pipeline (nadie la crea a mano):

```bash
cd /srv/omnidesk/repo
git fetch --tags && git tag --sort=-v:refname | head -3   # el primero es el último tag
infra/deploy/deploy.sh prod v0.1.0                       # en el VPS: descarga las imágenes de ese tag
```

Prod no compila: descarga de `ghcr.io` las imágenes que publicó el pipeline para ese tag, así que antes hay que iniciar sesión una vez en el VPS (ver [Imágenes en ghcr.io](#imágenes-en-ghcrio-spec-26)). La página **Estado** muestra `v0.1.0`. Las bases de dev y prod son independientes: un usuario creado en dev no existe en prod.

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
2. Espera a que el pipeline termine en verde: en GitHub, pestaña **Actions → release**. Si pasa, crea el tag nuevo sobre ese commit de `main` (`v0.1.1`, `v0.1.2`, …) y el job `images` publica sus imágenes en `ghcr.io`. Si falla, ese commit no tiene tag y no se puede desplegar: corrige `main` y espera al siguiente. Si el tag existe pero `images` falló, tampoco se puede desplegar (no hay imagen).
3. Mira el tag nuevo y despliégalo:

   ```bash
   cd /srv/omnidesk/repo
   git fetch --tags && git tag --sort=-v:refname | head -3
   infra/deploy/deploy.sh prod vX.Y.Z
   ```

`deploy.sh` rechaza en prod cualquier ref que no sea una etiqueta `vX.Y.Z`, y también una etiqueta que no esté contenida en `origin/main` (por ejemplo, una puesta a mano sobre otra rama).

**Subir el menor o el mayor.** El pipeline solo sube el parche (`v0.1.4` → `v0.1.5`). Para pasar a `v0.2.0` o `v1.0.0`, crea el tag a mano sobre un commit de `main` ya verificado y súbelo (`git tag v0.2.0 <commit> && git push origin v0.2.0`); el siguiente push a `main` sigue desde él (`v0.2.1`).

El despliegue tiene una caída breve mientras se recrean los contenedores (no hay blue/green). La PWA instalada muestra **Nueva versión disponible** y no se recarga sola.

**Prod no compila en el VPS** (desde SPEC 26): el pipeline construye las imágenes una vez y `deploy.sh prod` las descarga de `ghcr.io`. Por eso el despliegue de prod ya no tiene el pico de CPU y memoria del build, ni hace falta la alternativa de construir en tu máquina y copiar con `docker save`. **Dev** sí sigue construyendo en el VPS, con cualquier ref.

Al terminar, `deploy.sh prod` borra las imágenes de OmniDesk de versiones anteriores que ningún contenedor usa (las identifica por la etiqueta `org.opencontainers.image.source`; no toca imágenes de otras apps ni las que están en uso). Volver a una versión anterior las descarga otra vez.

## 4. Rollback

Para volver atrás, despliega el ref anterior. En prod es una etiqueta anterior:

```bash
git fetch --tags && git tag --sort=-v:refname | head -5   # busca la anterior a la desplegada
infra/deploy/deploy.sh prod v0.1.0                       # la etiqueta anterior
infra/deploy/deploy.sh dev <commit>                      # dev acepta cualquier commit
```

Volver a una etiqueta antigua es válido siempre que siga contenida en `origin/main` **y su imagen siga en `ghcr.io`**: el pipeline conserva solo las 10 versiones más recientes de cada imagen, y los tags anteriores a SPEC 26 (`v0.1.0`, `v0.1.1`) no tienen imagen. `deploy.sh` descarga la imagen del tag anterior, sin compilar. La página **Estado** (y `/health`) muestran la versión que corre.

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
| `deploy.sh` dice «prod solo se despliega desde una etiqueta vX.Y.Z…» | Pasaste `main`, una rama o un commit. Usa el último tag (`git fetch --tags && git tag --sort=-v:refname \| head -3`). |
| `deploy.sh` dice «La etiqueta … no está contenida en origin/main» | El tag está sobre otra rama. Despliega uno que haya creado el pipeline desde `main`. |
| `deploy.sh` dice «repite estas claves» o «BACKUP_DIR … no existe» o «CORS_ORIGINS de prod no puede incluir localhost» | Corrige `/srv/omnidesk/.env.prod`: una sola línea por clave, `BACKUP_DIR=/srv/omnidesk/backups/prod` (créala) y `CORS_ORIGINS=https://channel.gastromesa.com`. |
| `deploy.sh` dice "No hay sesión en ghcr.io" | Falta iniciar sesión en el VPS: `docker login ghcr.io -u <usuario-de-github>` con un token clásico con `read:packages` (ver [Imágenes en ghcr.io](#imágenes-en-ghcrio-spec-26)). |
| `deploy.sh` dice "No se pudieron descargar las imágenes de vX.Y.Z" | La imagen de ese tag no existe (el job `images` falló o aún corre, el tag es anterior a SPEC 26 o es de más de 10 versiones atrás) o el token caducó. Mira **Actions → release** y los paquetes en GitHub. |
| `deploy.sh` dice «BASE_PATH de prod debe ser /omnidesk» o «VITE_API_URL de prod debe estar vacía» | La imagen del gateway se construyó con esos valores. Cámbialos en `/srv/omnidesk/.env.prod`; cambiarlos de verdad exige modificar el workflow y publicar un tag nuevo. |
| Hay commits en `main` sin tag nuevo | El pipeline falló en ese commit (lint, tests, build o migraciones). Mira **Actions → release**. |
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

La imagen es `pgsty/minio`, un fork comunitario mantenido por Pigsty: MinIO dejó de publicar imágenes y el repositorio `minio/minio` ya no existe en Docker Hub ni en quay.io. Usa el mismo `server /data`, las mismas variables `MINIO_ROOT_*` e incluye `mc` para el healthcheck.

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


## Prod en OVHcloud con Cloudflare Tunnel (SPEC 25)

Prod corre en un VPS de OVHcloud y se publica en <https://channel.gastromesa.com/omnidesk> a través de un túnel de Cloudflare. No hay Nginx ni certificados en el VPS: `cloudflared` abre una conexión **saliente** hacia Cloudflare, que termina el TLS.

```text
Internet ──HTTPS──▶ Cloudflare ◀──túnel (saliente, 443)── cloudflared ──http://localhost:80──▶ gateway (Caddy)
                                                          (comparte la red del gateway)           ├─ /omnidesk/*      → web (PWA)
                                                                                                  └─ /omnidesk/api/*  → api:5001 ──▶ postgres
```

Consecuencias:

- El firewall del VPS solo deja entrar **SSH**. No se abren 80 ni 443.
- El gateway publica `127.0.0.1:8082` y MinIO `127.0.0.1:${MINIO_HOST_PORT}`, solo en el propio servidor.
- Los pasos 1.4 (Nginx) y el sitio raíz de `gastromesa.com` no se usan en prod.
- Las versiones son tags `vX.Y.Z` que crea el pipeline de GitHub (ver más abajo). El despliegue sigue siendo manual con `deploy.sh`.

### Valores del `.env.prod`

El `.env.prod` se prepara en tu máquina y se copia al VPS. **Nunca va a git** (`.env.*` está ignorado). Un archivo armado para correr en un portátil necesita estos cambios antes de subirlo:

| Variable | Valor en el VPS |
| --- | --- |
| `BACKUP_DIR` | `/srv/omnidesk/backups/prod` (en un portátil apunta a una ruta local; en el VPS debe existir) |
| `CORS_ORIGINS` | `https://channel.gastromesa.com`, **una sola línea**, sin `/omnidesk`, sin barra final y sin `localhost` |
| `APP_URL` | `https://channel.gastromesa.com/omnidesk` |
| `GOOGLE_CALLBACK_URL` | `https://channel.gastromesa.com/omnidesk/api/v1/auth/google/callback` |
| `BASE_PATH`, `PUBLIC_BASE_PATH` | `/omnidesk` |
| `GATEWAY_HOST_PORT` | `8082` |
| `MINIO_HOST_PORT` | el del archivo (`9150`) |
| `CLOUDFLARE_TUNNEL_TOKEN` | el token del túnel de Cloudflare (ver paso 4) |
| `NODE_ENV`, `DEMO_MODE`, `SESSION_COOKIE_SECURE`, `TRUST_PROXY`, `OMNIDESK_ENV` | `production`, `false`, `true`, `2`, `prod` |

Comprobaciones, sin arrancar nada:

```bash
# Ninguna clave repetida (no debe imprimir nada)
grep -E '^[A-Z_][A-Z0-9_]*=' .env.prod | cut -d= -f1 | sort | uniq -d

# Compose acepta el archivo
docker compose -p omnidesk-prod --env-file .env.prod -f infra/deploy/docker-compose.prod.yml config > /dev/null && echo ok
```

`deploy.sh prod` repite estas comprobaciones en el VPS: se niega a desplegar con claves repetidas, con un `BACKUP_DIR` que no existe o con `localhost` en `CORS_ORIGINS`.

### Pipeline de versiones

`.github/workflows/release.yml` se ejecuta en cada push a `main` (no en ramas ni en pull requests) con tres jobs:

| Job | Qué comprueba |
| --- | --- |
| `verify` | `pnpm lint`, `typecheck`, `test` y `build` |
| `migrations` | Aplica **todas** las migraciones sobre un Postgres 18 vacío con un superusuario (como el API al arrancar en prod), corre `db:app-role` y falla si `schema.prisma` tiene cambios sin migración |
| `tag` | Solo si los dos anteriores pasan: crea el siguiente tag `vX.Y.Z` sobre ese commit |

- El primer tag, sin tags previos, es `v0.1.0`; después sube el parche (`v0.1.1`, `v0.1.2`, …). Si el commit ya tiene un tag, no crea otro.
- Un `main` roto no recibe tag, así que **no se puede desplegar** en prod.
- Dos pushes seguidos esperan en cola. Si llegan varios mientras uno corre, los intermedios pueden saltarse; el último siempre se ejecuta.
- El job `tag` necesita permiso de escritura. Si el push del tag falla por permisos: **Settings → Actions → General → Workflow permissions → Read and write permissions**.
- El pipeline solo crea el tag. El despliegue automático desde GitHub no existe todavía.

### Runbook: primer despliegue de prod

1. **Cloudflare.** En el panel de Cloudflare (Zero Trust, sección de túneles), el túnel de OmniDesk debe tener el hostname público `channel.gastromesa.com` con servicio `http://localhost:80` (el `cloudflared` del compose comparte la red del gateway, así que `localhost:80` es el gateway). Copia el token del túnel al `.env.prod`.

2. **Google OAuth.** En la credencial **ID de cliente de OAuth → Aplicación web**, comprueba que existen:

   | Orígenes autorizados de JavaScript | URI de redirección autorizados |
   | --- | --- |
   | `https://channel.gastromesa.com` | `https://channel.gastromesa.com/omnidesk/api/v1/auth/google/callback` |

   Una URI que no coincida con `GOOGLE_CALLBACK_URL` termina en `redirect_uri_mismatch` al iniciar sesión.

3. **Preparar el VPS (una vez).** Con un usuario con `sudo`:

   - **Docker.** Docker Engine con el plugin Compose v2 (`docker compose version`) y `git`. Crea el usuario de despliegue, no root, y añádelo al grupo `docker`.
   - **Firewall.** Solo SSH entrante. Puedes usar el firewall de red de OVHcloud, `ufw` o ambos:

     ```bash
     sudo ufw default deny incoming && sudo ufw default allow outgoing
     sudo ufw allow OpenSSH && sudo ufw enable
     ```

     Salida libre: `cloudflared` necesita llegar a Cloudflare por 443.
   - **Reloj.** La verificación HMAC de WhatsApp tolera ±300 s (SPEC 09): `timedatectl` debe mostrar `System clock synchronized: yes`.
   - **Swap de 2 GB.** Colchón para el pico del build; ver [Swap](#swap-de-2-gb).
   - **Carpetas.**

     ```bash
     sudo mkdir -p /srv/omnidesk/backups/prod
     sudo chown -R "$USER": /srv/omnidesk
     ```

   - **Deploy key de solo lectura.** El repo es privado. Genera una clave en el VPS y regístrala en GitHub (**Settings → Deploy keys → Add deploy key**, **sin** marcar *Allow write access*):

     ```bash
     ssh-keygen -t ed25519 -f ~/.ssh/omnidesk_deploy -N "" -C "omnidesk-vps"
     cat ~/.ssh/omnidesk_deploy.pub    # pega esta línea en GitHub
     printf 'Host github-omnidesk\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/omnidesk_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
     git clone git@github-omnidesk:inerhead/OmniDesk.git /srv/omnidesk/repo
     git -C /srv/omnidesk/repo ls-remote origin    # debe listar las ramas y los tags
     ```

     El clon es solo para desplegar: no se edita a mano.

   - **Sesión en `ghcr.io`.** Prod descarga las imágenes de un registro privado. Crea un token personal de solo lectura e inicia sesión una vez; los pasos están en [Imágenes en ghcr.io](#imágenes-en-ghcrio-spec-26).

4. **Llevar el `.env.prod` al VPS.** Desde tu máquina, con el archivo ya corregido (tabla anterior):

   ```bash
   scp .env.prod usuario@vps:/srv/omnidesk/.env.prod
   ssh usuario@vps 'chmod 600 /srv/omnidesk/.env.prod'
   ```

5. **Traspaso del túnel.** Si prod corre hoy en otro equipo (por ejemplo, un portátil) con el **mismo** token de túnel, apágalo **antes** de arrancar el VPS: dos conectores del mismo túnel se reparten el tráfico, y parte de los usuarios llegaría a una instancia con otra base de datos.

   ```bash
   # en el equipo que corre prod hoy; sin -v, para no borrar sus volúmenes
   docker compose -p omnidesk-prod --env-file .env.prod -f infra/deploy/docker-compose.prod.yml down
   ```

   La base de datos del VPS arranca **vacía**: los datos del otro equipo no se migran.

6. **Esperar el tag y las imágenes.** Tras fusionar en `main`, comprueba en GitHub (**Actions → release**) que el pipeline terminó en verde (incluido el job `images`) y que los dos paquetes existen (ver [Ver las imágenes en GitHub](#ver-las-imágenes-en-github)). En el VPS:

   ```bash
   cd /srv/omnidesk/repo
   git fetch --tags && git tag --sort=-v:refname | head -3
   ```

7. **Desplegar.**

   ```bash
   infra/deploy/deploy.sh prod v0.1.0
   ```

   Descarga las dos imágenes del tag, levanta los servicios y termina con `✅ omnidesk-prod desplegado: v0.1.0`. No compila nada.

8. **Verificar.**

   ```bash
   C="docker compose -p omnidesk-prod --env-file /srv/omnidesk/.env.prod -f infra/deploy/docker-compose.prod.yml"
   $C ps    # los 7 servicios en marcha; los que tienen healthcheck, (healthy)
   curl -s https://channel.gastromesa.com/omnidesk/api/v1/health    # status ok, database up, version v0.1.0
   curl -s -o /dev/null -w '%{http_code}\n' https://channel.gastromesa.com/omnidesk/api/docs   # 404
   ss -ltn | grep -E ':(8082|9150)\b'    # solo en 127.0.0.1
   ```

   - Abre <https://channel.gastromesa.com/omnidesk> e inicia sesión con Google. La cookie `omnidesk_session` debe ser `Secure`, `HttpOnly`, `SameSite=Lax` y `Path=/omnidesk`. El primer login lleva a **Crea tu empresa**; un email de `PLATFORM_ADMIN_EMAILS` ve **Plataforma** y puede aprobarla.
   - El punto de conexión debe mostrar **En vivo** (WebSocket por el túnel).
   - Adjunta un archivo en una conversación: se guarda en MinIO del VPS y se vuelve a descargar.
   - En Cloudflare, el túnel muestra una sola conexión de conector (el VPS).
   - Desde fuera del VPS, los puertos 80, 443, 8082 y el de MinIO no responden.
   - Al día siguiente, tras las 03:00, existe `/srv/omnidesk/backups/prod/omnidesk-prod-<fecha>.dump`.

9. **WhatsApp y n8n.** Esta URL pública es nueva para ellos. Cuando la app responda, actualiza lo que apunte a la anterior: el webhook de Meta y el de n8n. La URL del webhook que muestra **Settings** del canal se arma con `APP_URL`; copia esa. Detalle en [integracion-n8n.md](integracion-n8n.md). Nada de esto bloquea el despliegue de la app.

### Dimensionamiento: ¿cabe en el VPS mínimo?

Plan mínimo de referencia: **VPS-1** de OVHcloud, 2 vCores, 4 GB de RAM y 40 GB NVMe (según su [web](https://us.ovhcloud.com/vps/compare/); confirma las cifras y el precio de tu región en el configurador antes de contratar). El siguiente, **VPS-2**, tiene 4 vCores, 8 GB y 75 GB.

Presupuesto de OmniDesk en VPS-1, dejando espacio a otra app en el mismo servidor:

| Recurso | VPS-1 | SO, Docker y swap | Máximo para OmniDesk | Resto para otra app |
| --- | --- | --- | --- | --- |
| RAM | 4 GB | 0,5 GB | 2 GB (los 7 servicios en uso normal) | ≥ 1,5 GB |
| Disco | 40 GB | 8 GB | 20 GB (imágenes, volúmenes, 7 backups y caché de build) | ≥ 12 GB |
| CPU | 2 vCores | — | Sin tope; los picos son los builds | — |

**Mediciones en local (2026-10-24)**, en Docker Desktop (VM de 10 CPUs), con la base casi vacía. Son una primera estimación, no sustituyen la medición en el VPS:

| Servicio | Reposo | Pico con carga HTTP, sin límites | Pico con carga HTTP, con `mem_limit` | Imagen |
| --- | --- | --- | --- | --- |
| `api` | 133 MiB | 414 MiB | 187 MiB | 907 MB |
| `minio` | 108 MiB | 110 MiB | 99 MiB | 199 MB |
| `postgres` | 37 MiB | 54 MiB | 48 MiB | 672 MB |
| `gateway` (Caddy) | 15 MiB | 45 MiB | 33 MiB | 91 MB |
| `cloudflared` | 19 MiB | 27 MiB | — | 104 MB |
| `autoheal`, `backup` | < 1 MiB | 2 MiB | — | 14 MB, `postgres:18` |
| **Suma** | **313 MiB** | **653 MiB** | | **~2 GB** |

- **Carga:** `ab`, 50 conexiones simultáneas, 40.000 peticiones a `GET /omnidesk/api/v1/health` (consulta la base): ~4.700 a 5.000 peticiones por segundo, 0 fallidas, p95 de 15 a 17 ms.
- **Con límite, el API usa menos:** Node ajusta su heap al tope del contenedor, así que con `mem_limit: 768m` el pico del API fue de 187 MiB frente a los 414 MiB que retenía sin límite. Ningún servicio fue matado por falta de memoria (`OOMKilled=false`, 0 reinicios).
- **Build en frío** (API y después gateway, sin caché, como `deploy.sh`): 60 s en 10 CPUs; la memoria usada de la VM subió ~944 MiB sobre el nivel base. Con el stack ya levantado, OmniDesk durante un build llega a ~1,25 GiB. En 2 vCores será bastante más lento (no medido).
- **Sin medir:** carga con mensajes reales (el simulador necesita `DEMO_CHANNEL_API_KEY`, que no existe con `DEMO_MODE=false`), crecimiento de `postgres` y MinIO con datos reales y el build en 2 vCores.

**Veredicto provisional: cabe en VPS-1** en reposo y con carga HTTP ligera (0,3 a 0,65 GB de los 2 GB del presupuesto, ~1,25 GB durante un build). Se confirma, o se cambia a «necesita VPS-2», con la medición en el VPS (abajo). Si OmniDesk supera 2 GB en uso normal, o el kernel mata un contenedor durante un build, la conclusión es VPS-2.

**Límites en el compose** (`infra/deploy/docker-compose.prod.yml`): un servicio descontrolado no debe quitarle la RAM a otra app del servidor.

| Servicio | `mem_limit` | Pico medido con carga |
| --- | --- | --- |
| `api` | 768m | 187 MiB |
| `postgres` | 512m | 48 MiB |
| `minio` | 384m | 99 MiB |
| `gateway` | 128m | 33 MiB |

`cloudflared`, `autoheal` y `backup` no llevan límite: consumen poco y un tope justo podría matarlos en el pico del backup. Todos los servicios rotan sus logs (`json-file`, 10 MB × 3 archivos); sin eso los logs de Docker crecen sin tope. Los valores se ajustan en el repo (nunca en el servidor) si la medición en el VPS lo pide.

**Medir en el VPS**, tras el primer despliegue:

```bash
C="docker compose -p omnidesk-prod --env-file /srv/omnidesk/.env.prod -f infra/deploy/docker-compose.prod.yml"
docker stats --no-stream                       # memoria de cada servicio (suma ≤ 2 GB)
free -m && swapon --show                       # memoria disponible y uso de swap
df -h /  && docker system df                   # disco (≤ 60 % con 7 backups)
dmesg | grep -i 'out of memory'                # no debe imprimir nada
```

Mide también **durante** un despliegue: lanza `infra/deploy/deploy.sh prod <tag>` y, en otra sesión SSH, `watch -n2 free -m`. Desde SPEC 26 prod descarga las imágenes en lugar de compilarlas, así que el pico de ~1 GB del build (medido en local) ya no ocurre en el VPS de prod; el swap sigue siendo un seguro para los builds de dev. La memoria disponible (RAM + swap) no debe llegar a 0, y el swap no debe usarse de forma sostenida: si lo hace, el VPS se queda corto y la conclusión es VPS-2.

`deploy.sh` limpia al terminar bien la caché de build de más de 7 días y las imágenes huérfanas (`docker builder prune` e `image prune`). Actúa sobre todo el host, incluida la caché de otras apps; solo borra caché e imágenes sin uso, que se reconstruyen.

### Swap de 2 GB

El build del API y del gateway (`pnpm install`, `tsc`, `vite build`) es el pico de memoria. Un swap de 2 GB evita que el kernel mate un contenedor en ese momento. Es un seguro, no una forma de que quepa. Comprueba primero si el VPS ya tiene:

```bash
swapon --show        # vacío = sin swap
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -m              # Swap: 2047
```

### Convivir con otras apps en el mismo VPS

OmniDesk no asume que está solo en el servidor. Si despliegas otra app (por ejemplo, la del restaurante) en el mismo VPS:

| Tema | Regla |
| --- | --- |
| **Túnel** | El `cloudflared` de OmniDesk comparte la red de su gateway y su servicio es `http://localhost:80`: solo sirve a OmniDesk. La otra app usa **su propio túnel** (token y hostname distintos), no el de OmniDesk. |
| **Proyecto Compose** | OmniDesk es `omnidesk-prod`. La otra app usa otro nombre de proyecto, para que no compartan red ni volúmenes. |
| **Puertos** | OmniDesk usa `127.0.0.1:8082` (gateway) y `127.0.0.1:9150` (MinIO). La otra app, otros. Todo se publica solo en `127.0.0.1`. |
| **`autoheal`** | El `autoheal` de OmniDesk reinicia **cualquier** contenedor `unhealthy` del servidor que lleve la etiqueta `autoheal=true`. La otra app **no debe usar esa etiqueta**, o le reiniciará contenedores. Comprueba el log: `docker logs omnidesk-prod-autoheal` solo debe mencionar contenedores `omnidesk-prod-*`. |
| **Horarios** | El backup de OmniDesk corre a las 03:00 y la retención a las 03:30 (hora del servidor). La otra app no programa tareas pesadas a esas horas. |
| **Builds** | Despliega una app a la vez. `deploy.sh` ya construye una imagen cada vez. |
| **Firewall y usuario** | Compartidos: solo SSH entrante. |
| **Recursos** | Presupuesto de OmniDesk: 2 GB de RAM y 20 GB de disco (ver arriba). Lo demás es de la otra app. |

## Imágenes en ghcr.io (SPEC 26)

Prod no compila en el VPS: el pipeline construye las imágenes una vez y `deploy.sh prod <tag>` las descarga. Se publican en GitHub Container Registry, como paquetes **privados** enlazados al repo.

| Paquete | Referencia | Origen |
| --- | --- | --- |
| `omnidesk-api` | `ghcr.io/inerhead/omnidesk-api:vX.Y.Z` | `apps/api/Dockerfile`, etapa `prod`, con `APP_VERSION` = el tag |
| `omnidesk-gateway` | `ghcr.io/inerhead/omnidesk-gateway:vX.Y.Z` | `infra/gateway/Dockerfile`, con `BASE_PATH=/omnidesk` y `VITE_API_URL` vacía |

- Una etiqueta por imagen, igual que el tag de git y que la versión de `/health`. No hay `latest`.
- Plataforma `linux/amd64` (el VPS de OVHcloud es x86: comprueba con `uname -m`).
- El job `images` de `release.yml` las publica tras crear el tag, con `GITHUB_TOKEN`. **Una versión publicada es inmutable**: si la imagen de un tag ya existe, el pipeline no la reconstruye.
- El job `prune` conserva las **10 versiones más recientes** de cada paquete (cada una pesa cerca de 1 GB).
- Los tags anteriores a SPEC 26 (`v0.1.0`, `v0.1.1`) **no tienen imagen** y no se pueden desplegar en prod. El primer tag desplegable es el siguiente que crea el pipeline.
- `dev` no usa estas imágenes: construye en el VPS con cualquier ref.

### ¿Es gratis?

Hoy sí. La [documentación de GitHub Packages](https://docs.github.com/en/billing/concepts/product-billing/github-packages) dice que el almacenamiento y el ancho de banda del Container registry son actualmente gratuitos, y que avisarán con al menos un mes de antelación de cualquier cambio. Tenlo presente:

- Es una política vigente, no una garantía. Si cambia, las opciones son pagar, hacer los paquetes públicos o usar otro registro.
- La misma página lista cuotas para paquetes privados (cuenta Free: 500 MB de almacenamiento y 1 GB de transferencia al mes) y no aclara si la exención del registro de contenedores las anula. La retención de 10 versiones acota el uso.
- La descarga desde Actions con `GITHUB_TOKEN` es gratis; la del VPS usa tu token personal.

Revisa **Settings → Billing and plans → Usage** de tu cuenta de vez en cuando para ver si el registro empieza a contar.

### Ver las imágenes en GitHub

**En la web** (los nombres de los menús pueden variar un poco):

1. **Desde el repo.** En `https://github.com/inerhead/OmniDesk`, barra lateral derecha, apartado **Packages**: lista los dos paquetes enlazados al repo. Cada uno abre `https://github.com/inerhead/OmniDesk/pkgs/container/omnidesk-api` (o `omnidesk-gateway`).
2. **Desde tu perfil.** `https://github.com/inerhead?tab=packages` lista todos tus paquetes. La página de cada uno es `https://github.com/users/inerhead/packages/container/package/omnidesk-api`.
3. **En la página del paquete**, la lista de versiones muestra las etiquetas (`v0.1.2`, …), la fecha y el tamaño. Al abrir una versión ves el **digest** (`sha256:…`) y el comando `docker pull ghcr.io/inerhead/omnidesk-api:vX.Y.Z`.
4. **Ajustes del paquete** (**Package settings**, en la página del paquete): comprueba que la visibilidad es **Private**, que el repo `OmniDesk` figura como enlazado y quién tiene acceso (**Manage Actions access**).
5. **En Actions.** En **Actions → release**, abre un run: su **resumen** lista las dos imágenes publicadas con su digest.

**Desde el terminal:**

```bash
# Listar las versiones de un paquete (necesita el permiso read:packages en gh)
gh auth refresh -h github.com -s read:packages
gh api /user/packages/container/omnidesk-api/versions \
  --jq '.[] | {id, etiquetas: .metadata.container.tags, creada: .created_at}'

# Comprobar que una etiqueta existe, sin descargarla (necesita docker login ghcr.io)
docker manifest inspect ghcr.io/inerhead/omnidesk-api:v0.1.2 > /dev/null && echo existe

# Digest y arquitectura de una imagen descargada
docker image inspect ghcr.io/inerhead/omnidesk-api:v0.1.2 --format '{{index .RepoDigests 0}} {{.Os}}/{{.Architecture}}'
```

Sin sesión, `docker manifest inspect` y `docker pull` responden `denied` o `unauthorized`: el paquete es privado.

### Primera publicación: qué comprobar

Tras el primer push a `main` con este pipeline, en GitHub:

1. **Actions → release**: los jobs `images` y `prune` terminaron (el segundo puede mostrar un aviso, ver abajo).
2. Los dos paquetes existen, son **Private** y están **enlazados al repo**. Si un paquete no estuviera enlazado, Actions no podría publicar versiones nuevas: en **Package settings → Manage Actions access**, añade el repo `OmniDesk` con rol **Write**.
3. **Para que `prune` pueda borrar versiones antiguas**, el repo necesita el rol **Admin** en ese mismo apartado (con **Write** puede publicar pero no borrar). Hazlo una vez por paquete. Mientras no lo hagas, `prune` termina con un aviso («No se pudieron borrar versiones antiguas…») y el release sigue en verde; las versiones se acumulan.

### Token y sesión en el VPS (una vez)

El VPS necesita descargar paquetes privados. Se usa un token personal **clásico** de solo lectura (los tokens de granularidad fina no admiten paquetes de `ghcr.io`):

1. En GitHub: **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**. Nombre `omnidesk-vps`, **caducidad** (por ejemplo 90 días) y un único permiso: **`read:packages`**.
2. Copia el token (solo se muestra una vez) e inicia sesión en el VPS:

   ```bash
   echo '<el-token>' | docker login ghcr.io -u inerhead --password-stdin
   ```

   Docker guarda la credencial en `~/.docker/config.json` (en base64, no cifrada): el archivo es del usuario de despliegue. Borra el token de tu portapapeles y del historial del shell.
3. Comprueba que funciona (con el tag que exista):

   ```bash
   docker manifest inspect ghcr.io/inerhead/omnidesk-api:v0.1.2 > /dev/null && echo ok
   ```

**Caducidad y rotación.** Cuando el token caduca, `deploy.sh` falla con «No se pudieron descargar las imágenes…». Genera uno nuevo y repite `docker login`. Para **revocarlo** (por ejemplo, si se filtra): Developer settings → Tokens (classic) → **Delete**. Cierra la sesión del VPS con `docker logout ghcr.io`.

### Flujo completo

```text
push a main ─▶ verify + migrations ─▶ tag vX.Y.Z ─▶ images (ghcr.io) ─▶ prune (10 versiones)
                                                            │
VPS:  deploy.sh prod vX.Y.Z ◀── docker pull api + gateway ◀─┘   (sin compilar)
```
