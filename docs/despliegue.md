# Despliegue en el VPS

Prod corre en un VPS de OVHcloud con Docker Compose, bajo la subruta `/omnidesk` (SPEC 08), y se publica en <https://channel.gastromesa.com/omnidesk> por un túnel de Cloudflare (SPEC 25).

**En el VPS no hay código fuente** (SPEC 27). El pipeline de GitHub construye y publica en `ghcr.io`, para cada tag `vX.Y.Z`, las imágenes de la app y un **bundle** con los archivos de despliegue. El VPS solo los descarga: no tiene clon del repo, ni `git`, ni deploy key, y no compila nada.

| Proyecto Compose | `.env` | Gateway en el host | URL pública | Se despliega desde |
| --- | --- | --- | --- | --- |
| `omnidesk-prod` | `/srv/omnidesk/.env.prod` | `127.0.0.1:8082` | <https://channel.gastromesa.com/omnidesk> | un tag `vX.Y.Z` que el pipeline crea y publica desde `main` |

Dev ya no vive en el VPS (SPEC 27): se trabaja en local con `docker-compose.yml` (ver el README).

```text
                     GitHub Actions (release.yml)                          ghcr.io (privado)
push a main ─▶ verify + migrations ─▶ tag vX.Y.Z ─▶ images ─▶ prune  ─▶  omnidesk-api:vX.Y.Z
                                                                          omnidesk-gateway:vX.Y.Z
                                                                          omnidesk-deploy:vX.Y.Z (bundle)
                                                                                   │ docker pull
VPS:  /srv/omnidesk/bin/omnidesk-deploy vX.Y.Z ◀───────────────────────────────────┘
        └─ extrae el bundle en /srv/omnidesk/releases/vX.Y.Z/ y ejecuta su deploy.sh

Internet ──HTTPS──▶ Cloudflare ◀──túnel (saliente, 443)── cloudflared ──http://localhost:80──▶ gateway (Caddy)
                                                         (comparte la red del gateway)         ├─ /omnidesk/*      → web (PWA)
                                                                                               └─ /omnidesk/api/*  → api:5001 ──▶ postgres
                                                          backup ──pg_dump 03:00──▶ /srv/omnidesk/backups/prod/
```

- El firewall del VPS solo deja entrar **SSH**. `cloudflared` sale hacia Cloudflare, que termina el TLS: no se abren 80 ni 443 y no hay Nginx ni certificados en el servidor.
- Solo el gateway (`127.0.0.1:8082`) y MinIO (`127.0.0.1:${MINIO_HOST_PORT}`) publican puertos, y solo en el propio servidor. Postgres no publica ninguno.

**En el repo:**

| Archivo | Qué es |
| --- | --- |
| `.github/workflows/release.yml` | Pipeline: comprueba el código y las migraciones, crea el tag y publica las tres imágenes (SPEC 25, 26 y 27) |
| `.github/scripts/next-version.sh` | Calcula el siguiente tag a partir de los existentes |
| `apps/api/Dockerfile` (etapa `prod`) | Imagen `omnidesk-api`: usuario no root; `prisma migrate deploy` y después `node dist/main.js` |
| `infra/gateway/Dockerfile` + `Caddyfile.prod` | Imagen `omnidesk-gateway`: la web servida por Caddy, proxy al API, caché y CSP |
| `infra/deploy/Dockerfile.bundle` | Imagen `omnidesk-deploy`: solo los archivos de abajo, sin código de la app |
| `infra/deploy/omnidesk-deploy` | Script fijo del VPS: descarga el bundle de un tag y lo despliega |
| `infra/deploy/deploy.sh` | Despliegue de un tag: valida el `.env.prod`, descarga las imágenes, levanta y comprueba |
| `infra/deploy/docker-compose.prod.yml` | Servicios `postgres`, `api`, `gateway`, `backup`, `minio`, `cloudflared` y `autoheal` |
| `infra/deploy/backup.sh` | `pg_dump` diario + rotación de 7 (lo ejecuta el servicio `backup`) |
| `infra/deploy/.env.prod.example` | Plantilla del `.env.prod` (sin secretos) |
| `infra/deploy/nginx-omnidesk.conf.example` | Fragmento de Nginx de SPEC 08. No se usa con el túnel de Cloudflare |

**En el VPS:**

```text
/srv/omnidesk/
├── bin/omnidesk-deploy          # instalado una vez desde un bundle (§2.4)
├── .env.prod                    # chmod 600
├── backups/prod/                # dumps y archivos de media
├── current -> releases/vX.Y.Z   # la versión en uso (la fija omnidesk-deploy)
└── releases/
    ├── v0.1.3/                  # bundle extraído: VERSION, deploy.sh, docker-compose.prod.yml,
    └── v0.1.4/                  #   backup.sh, .env.prod.example, omnidesk-deploy (se conservan 5)
```

## 1. Cómo se publica una versión

`.github/workflows/release.yml` se ejecuta en cada push a `main` (no en ramas ni en pull requests):

| Job | Qué hace |
| --- | --- |
| `verify` | `pnpm lint`, `typecheck`, `test` y `build` |
| `migrations` | Aplica **todas** las migraciones sobre un Postgres 18 vacío con un superusuario (como el API al arrancar en prod), corre `db:app-role` y falla si `schema.prisma` tiene cambios sin migración |
| `tag` | Solo si los dos anteriores pasan: crea el siguiente tag `vX.Y.Z` sobre ese commit |
| `images` | Construye y publica en `ghcr.io` `omnidesk-api`, `omnidesk-gateway` y el bundle `omnidesk-deploy` de ese tag. Si ya existen, no los reconstruye |
| `prune` | Conserva las 10 versiones más recientes de cada paquete |

- El primer tag, sin tags previos, es `v0.1.0`; después sube el parche (`v0.1.1`, `v0.1.2`, …). Si el commit ya tiene un tag, no crea otro.
- Un `main` roto no recibe tag ni imágenes, así que **no se puede desplegar**.
- **Solo se despliegan tags de `main`**: únicamente este workflow publica bundles, y solo corre en push a `main`. Un tag puesto a mano no tiene bundle.
- Dos pushes seguidos esperan en cola. Si llegan varios mientras uno corre, los intermedios pueden saltarse; el último siempre se ejecuta.
- Si el push del tag falla por permisos: **Settings → Actions → General → Workflow permissions → Read and write permissions**.
- El despliegue sigue siendo manual (§3). El despliegue automático desde GitHub no existe todavía.

**Subir el menor o el mayor.** El pipeline solo sube el parche (`v0.1.4` → `v0.1.5`). Para pasar a `v0.2.0`, crea y sube ese tag a mano sobre un commit de `main` verificado (`git tag v0.2.0 <commit> && git push origin v0.2.0`). Ese tag **no** tiene bundle ni imágenes; el siguiente push a `main` publica `v0.2.1`, que sí se despliega.

## 2. Primera instalación en el VPS

Se hace una vez, en un VPS vacío. En ningún paso se clona el repo.

### 2.1 Cloudflare y Google (antes de empezar)

1. **Cloudflare.** En el panel de Cloudflare (Zero Trust, sección de túneles), el túnel de OmniDesk debe tener el hostname público `channel.gastromesa.com` con servicio `http://localhost:80` (el `cloudflared` del compose comparte la red del gateway, así que `localhost:80` es el gateway). El token del túnel va en el `.env.prod`.
2. **Google OAuth.** En [Google Cloud Console](https://console.cloud.google.com/apis/credentials), credencial **ID de cliente de OAuth → Aplicación web**:

   | Orígenes autorizados de JavaScript | URI de redirección autorizados |
   | --- | --- |
   | `https://channel.gastromesa.com` | `https://channel.gastromesa.com/omnidesk/api/v1/auth/google/callback` |

   Una URI que no coincida con `GOOGLE_CALLBACK_URL` termina en `redirect_uri_mismatch`. Si la pantalla de consentimiento está en modo _Testing_, solo entran los usuarios de prueba que añadas.

### 2.2 Preparar el servidor

Con un usuario con `sudo`:

- **Docker.** Docker Engine con el plugin Compose v2 (`docker compose version`). No hace falta `git`. Crea el usuario de despliegue, no root, y añádelo al grupo `docker` (`sudo usermod -aG docker <usuario>` y vuelve a entrar).
- **Firewall.** Solo SSH entrante. Puedes usar el firewall de red de OVHcloud, `ufw` o ambos:

  ```bash
  sudo ufw default deny incoming && sudo ufw default allow outgoing
  sudo ufw allow OpenSSH && sudo ufw enable
  ```

  Salida libre: `cloudflared` necesita llegar a Cloudflare por 443, y Docker a `ghcr.io`.
- **Reloj.** La verificación HMAC de WhatsApp tolera ±300 s (SPEC 09): `timedatectl` debe mostrar `System clock synchronized: yes`.
- **Swap de 2 GB**, como colchón (ver [Swap](#swap-de-2-gb)).
- **Arquitectura.** `uname -m` debe devolver `x86_64`: las imágenes se publican para `linux/amd64`.
- **Carpetas.**

  ```bash
  sudo mkdir -p /srv/omnidesk/bin /srv/omnidesk/releases /srv/omnidesk/backups/prod
  sudo chown -R "$USER": /srv/omnidesk
  ```

### 2.3 Sesión en `ghcr.io`

Los paquetes son privados. Crea un token y inicia sesión, como se explica en [Token y sesión en el VPS](#token-y-sesión-en-el-vps-una-vez). Es la única credencial de GitHub que tiene el servidor.

### 2.4 Instalar `omnidesk-deploy`

Con el tag más reciente que haya publicado el pipeline (míralo en **Packages** o en el resumen de **Actions → release**; ver [Ver las imágenes en GitHub](#ver-las-imágenes-en-github)):

```bash
TAG=v0.1.2
docker pull ghcr.io/inerhead/omnidesk-deploy:$TAG
id=$(docker create ghcr.io/inerhead/omnidesk-deploy:$TAG)
docker cp "$id":/bundle/omnidesk-deploy /srv/omnidesk/bin/omnidesk-deploy
docker rm "$id"
chmod 755 /srv/omnidesk/bin/omnidesk-deploy
```

El bundle es una imagen `FROM scratch` con solo archivos: `docker create` no ejecuta nada. Si en algún despliegue el bundle trae una versión distinta del script, `omnidesk-deploy` lo avisa al terminar con el comando para actualizarlo (`install -m 755 /srv/omnidesk/releases/<tag>/omnidesk-deploy /srv/omnidesk/bin/omnidesk-deploy`). No se reemplaza solo.

### 2.5 El `.env.prod`

Se prepara en tu máquina a partir de `infra/deploy/.env.prod.example` y se copia al VPS. **Nunca va a git** (`.env.*` está ignorado).

| Variable | Valor en el VPS |
| --- | --- |
| `BACKUP_DIR` | `/srv/omnidesk/backups/prod` (debe existir) |
| `CORS_ORIGINS` | `https://channel.gastromesa.com`, **una sola línea**, sin `/omnidesk`, sin barra final y sin `localhost` |
| `APP_URL` | `https://channel.gastromesa.com/omnidesk` |
| `GOOGLE_CALLBACK_URL` | `https://channel.gastromesa.com/omnidesk/api/v1/auth/google/callback` |
| `BASE_PATH`, `PUBLIC_BASE_PATH` | `/omnidesk` (la imagen del gateway se construye con esa base) |
| `VITE_API_URL` | vacía (la web llama al API en el mismo origen) |
| `GATEWAY_HOST_PORT` | `8082` |
| `MINIO_HOST_PORT` | el del archivo (`9150`) |
| `CLOUDFLARE_TUNNEL_TOKEN` | el token del túnel (§2.1) |
| `NODE_ENV`, `DEMO_MODE`, `SESSION_COOKIE_SECURE`, `TRUST_PROXY`, `OMNIDESK_ENV` | `production`, `false`, `true`, `2`, `prod` |

Además:

- `POSTGRES_PASSWORD`, `DATABASE_APP_PASSWORD` y `MINIO_ROOT_PASSWORD`: `openssl rand -hex 24` (solo letras y números: van dentro de URLs).
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`: los de la credencial de §2.1.
- `PLATFORM_ADMIN_EMAILS`: los emails de Google, separados por comas, que aprueban, rechazan y suspenden empresas en `/platform` (SPEC 18). Vacía, las empresas nuevas se quedan en revisión.
- `APP_VERSION` no va en el archivo: la fija `deploy.sh` con el tag.

Comprueba en tu máquina que no hay claves repetidas (no debe imprimir nada) y cópialo:

```bash
grep -E '^[A-Z_][A-Z0-9_]*=' .env.prod | cut -d= -f1 | sort | uniq -d
scp .env.prod usuario@vps:/srv/omnidesk/.env.prod
ssh usuario@vps 'chmod 600 /srv/omnidesk/.env.prod'
```

`deploy.sh` repite las comprobaciones en el VPS: se niega a desplegar con valores `<…>` sin rellenar, claves repetidas, un `BACKUP_DIR` que no existe, `localhost` en `CORS_ORIGINS`, un `BASE_PATH` distinto de `/omnidesk` o una `VITE_API_URL` no vacía.

### 2.6 Traspaso del túnel

Si prod corre hoy en otro equipo (por ejemplo, un portátil) con el **mismo** token de túnel, apágalo **antes** de desplegar en el VPS: dos conectores del mismo túnel se reparten el tráfico, y parte de los usuarios llegaría a una instancia con otra base de datos. La base del VPS arranca **vacía**: los datos del otro equipo no se migran.

### 2.7 Desplegar y verificar

```bash
/srv/omnidesk/bin/omnidesk-deploy v0.1.2
```

`omnidesk-deploy`:

1. Comprueba que el ref es un tag `vX.Y.Z`.
2. Descarga el bundle `omnidesk-deploy:<tag>` y lo extrae en `/srv/omnidesk/releases/<tag>/`, comprobando que trae todos sus archivos. Si esa carpeta ya existe con la misma versión, la reutiliza.
3. Ejecuta `releases/<tag>/deploy.sh <tag>`, que:
   - valida el `.env.prod`;
   - descarga `omnidesk-api` y `omnidesk-gateway` de ese tag (`docker compose pull`);
   - levanta los servicios con `up -d --no-build`. Al arrancar, el API aplica las migraciones pendientes (`prisma migrate deploy`) antes de aceptar peticiones; si una falla, el API no arranca y el healthcheck no pasa;
   - espera al healthcheck del API y comprueba que `/health` responde ese tag;
   - borra imágenes de OmniDesk de versiones anteriores que nadie usa.
4. Apunta `/srv/omnidesk/current` a esa versión y conserva las 5 carpetas de `releases/` más recientes.

Termina con `✅ omnidesk-prod desplegado: v0.1.2`. Si algo falla, muestra el motivo (y los logs del API si es el healthcheck) y termina con un código distinto de 0.

Comprobaciones (define `$C` como en [Operación diaria](#6-operación-diaria)):

```bash
$C ps    # los 7 servicios en marcha; los que tienen healthcheck, (healthy)
curl -s https://channel.gastromesa.com/omnidesk/api/v1/health    # status ok, database up, version v0.1.2
curl -s -o /dev/null -w '%{http_code}\n' https://channel.gastromesa.com/omnidesk/api/docs   # 404
ss -ltn | grep -E ':(8082|9150)\b'    # solo en 127.0.0.1
find /srv/omnidesk -name '.git' -o -name '*.ts'    # no debe devolver nada: no hay código
```

- Abre <https://channel.gastromesa.com/omnidesk> e inicia sesión con Google. La cookie `omnidesk_session` debe ser `Secure`, `HttpOnly`, `SameSite=Lax` y `Path=/omnidesk`. El primer login lleva a **Crea tu empresa**; un email de `PLATFORM_ADMIN_EMAILS` ve **Plataforma** y puede aprobarla.
- El punto de conexión debe mostrar **En vivo** (WebSocket por el túnel).
- Adjunta un archivo en una conversación: se guarda en MinIO del VPS y se vuelve a descargar.
- En Cloudflare, el túnel muestra una sola conexión de conector (el VPS).
- Desde fuera del VPS, los puertos 80, 443, 8082 y el de MinIO no responden.
- Al día siguiente, tras las 03:00, existe `/srv/omnidesk/backups/prod/omnidesk-prod-<fecha>.dump`.

**WhatsApp y n8n.** Si apuntaban a otra URL, actualiza el webhook de Meta y el de n8n cuando la app responda. La URL del webhook que muestra **Settings** del canal se arma con `APP_URL`; copia esa. Detalle en [integracion-n8n.md](integracion-n8n.md).

### Instalar la PWA en el celular

- **Android (Chrome):** abre `https://channel.gastromesa.com/omnidesk` y pulsa **Instalar app**.
- **iPhone (Safari):** Compartir → **Añadir a pantalla de inicio**. Haz el login con Google **dentro** de la app instalada: en modo standalone, iOS guarda cookies separadas de Safari.

## 3. Actualizar

1. Haz un **backup manual** (§5).
2. Espera a que el pipeline termine en verde en **Actions → release**, incluido el job `images`. Si `verify` o `migrations` fallan, ese commit no tiene tag; si `images` falla, el tag existe pero no tiene imágenes ni bundle. En ambos casos no se puede desplegar: corrige `main` y espera al siguiente.
3. Despliega el tag nuevo:

   ```bash
   /srv/omnidesk/bin/omnidesk-deploy vX.Y.Z
   ```

El despliegue tiene una caída breve mientras se recrean los contenedores (no hay blue/green). La PWA instalada muestra **Nueva versión disponible** y no se recarga sola.

Prod no compila: descarga lo que el pipeline construyó. Por eso el despliegue no tiene pico de CPU ni de memoria de build.

## 4. Rollback

Despliega la etiqueta anterior; `omnidesk-deploy` usa el bundle de esa versión, con su propio compose:

```bash
/srv/omnidesk/bin/omnidesk-deploy v0.1.1
```

- La versión tiene que tener bundle e imágenes en `ghcr.io`: el pipeline conserva las 10 más recientes, y los tags anteriores a SPEC 27 (o puestos a mano) no tienen bundle.
- Si la carpeta de esa versión sigue en `releases/` (se conservan 5), no se vuelve a descargar el bundle; las imágenes sí, porque `deploy.sh` borra las que no están en uso.
- La página **Estado** (y `/health`) muestran la versión que corre.

Las migraciones solo avanzan. Si la versión nueva aplicó una migración que la anterior no tolera (por ejemplo, borró o renombró una columna), hay dos pasos: restaura el backup previo al despliegue (§5) y después despliega la etiqueta anterior.

## 5. Backups

El servicio `backup` ejecuta `pg_dump -Fc` cada día a las 03:00, hora del servidor (monta `/etc/localtime`). Guarda en `BACKUP_DIR` y conserva los 7 más recientes. El mismo paso archiva el volumen de MinIO (`omnidesk-prod-media-YYYYMMDD.tar.gz`); la restauración de esos archivos está en [Adjuntos y MinIO](#adjuntos-y-minio-spec-14).

```text
/srv/omnidesk/backups/prod/omnidesk-prod-20261012.dump
```

Un dump se escribe primero a `*.partial` y solo se renombra cuando termina bien. El log está en `$C logs backup`.

**Backup manual** (antes de cada despliegue):

```bash
$C run --rm backup now
```

Si hay más de un backup el mismo día, el último reemplaza al anterior, porque el nombre lleva la fecha.

### Restaurar un backup

```bash
DUMP=omnidesk-prod-20261012.dump

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
$C up -d --no-build
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

El compose de la versión en uso está en `/srv/omnidesk/current`, y necesita saber su tag:

```bash
export OMNIDESK_IMAGE_TAG=$(cat /srv/omnidesk/current/VERSION)
C="docker compose -p omnidesk-prod --env-file /srv/omnidesk/.env.prod -f /srv/omnidesk/current/docker-compose.prod.yml"
$C ps                       # estado y healthchecks
$C logs -f --tail 100 api   # logs JSON (pino) con x-request-id
$C restart api
```

Todos los servicios tienen `restart: unless-stopped`: vuelven solos tras reiniciar el VPS. Si un servicio sigue vivo pero deja de responder, lo reinicia `autoheal` (ver [Autorreparación](#autorreparación-spec-19)).

## 7. Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| `omnidesk-deploy` dice «Solo se despliegan etiquetas vX.Y.Z…» | Pasaste `main`, una rama, un commit o `dev`. Usa un tag publicado (míralo en **Packages**). |
| «No hay sesión en ghcr.io» | Falta iniciar sesión en el VPS: `docker login ghcr.io -u <usuario-de-github>` con un token clásico con `read:packages` (ver [Token y sesión en el VPS](#token-y-sesión-en-el-vps-una-vez)). |
| «No se pudo descargar el bundle …» | Ese tag no tiene bundle: el job `images` falló o aún corre, el tag es anterior a SPEC 27 o puesto a mano, o es de más de 10 versiones atrás. O el token caducó. Mira **Actions → release** y **Packages**. |
| «No se pudieron descargar las imágenes de vX.Y.Z» | Igual que el anterior, para `omnidesk-api` u `omnidesk-gateway`. |
| «repite estas claves», «BACKUP_DIR … no existe» o «CORS_ORIGINS de prod no puede incluir localhost» | Corrige `/srv/omnidesk/.env.prod`: una sola línea por clave, `BACKUP_DIR=/srv/omnidesk/backups/prod` (créala) y `CORS_ORIGINS=https://channel.gastromesa.com`. |
| «BASE_PATH de prod debe ser /omnidesk» o «VITE_API_URL de prod debe estar vacía» | La imagen del gateway se construyó con esos valores. Corrígelos en el `.env.prod`; cambiarlos de verdad exige modificar el workflow y publicar un tag nuevo. |
| «falta OMNIDESK_IMAGE_TAG» al usar `$C` | Falta el `export OMNIDESK_IMAGE_TAG=…` de [Operación diaria](#6-operación-diaria). |
| Hay commits en `main` sin tag nuevo | El pipeline falló en ese commit (lint, tests, build o migraciones). Mira **Actions → release**. |
| Cloudflare responde **502** en `/omnidesk/` | El gateway no está arriba (`$C ps`). |
| Cloudflare responde **error 1033** en `/omnidesk/` | El túnel no tiene ninguna conexión: `cloudflared` sigue "Up" pero se quedó colgado (típico tras un corte de red). `autoheal` lo reinicia solo en unos 4 min desde el corte. Para no esperar: `$C restart cloudflared`. Ver [Autorreparación](#autorreparación-spec-19). |
| El badge no pasa a **En vivo** (se queda en reconectando) | El WebSocket no llega por el túnel: revisa `$C logs cloudflared`. La app sigue usable con el polling de respaldo de 15 s. |
| Tras el login de Google se vuelve a `/login` | La cookie no se guarda. Revisa que `SESSION_COOKIE_SECURE=true` y `TRUST_PROXY=2`, y que `APP_URL` y `PUBLIC_BASE_PATH` terminan en `/omnidesk`. |
| Google responde `redirect_uri_mismatch` | Falta la URI de §2.1 en la credencial, o `GOOGLE_CALLBACK_URL` no coincide con ella. |
| `403 Origen no permitido` al enviar | `CORS_ORIGINS` no es exactamente `https://channel.gastromesa.com` (sin `/omnidesk` ni barra final). |
| El API no arranca tras un despliegue | Una migración falló: `$C logs api`. Corrige en el repo y publica un tag nuevo, o haz rollback (§4). |
| Las empresas nuevas se quedan en **Solicitud en revisión** y nadie ve **Plataforma** | `PLATFORM_ADMIN_EMAILS` está vacía o no tiene el email exacto de tu cuenta de Google (SPEC 18). Al arrancar, el API lo avisa en `$C logs api`. Corrige el `.env.prod` y vuelve a desplegar el mismo tag. |

## 8. Imágenes y bundle en ghcr.io

El pipeline publica tres paquetes **privados**, enlazados al repo, con una etiqueta por versión (`vX.Y.Z`, igual que el tag de git y que `/health`; no hay `latest`) para `linux/amd64`:

| Paquete | Referencia | Contenido |
| --- | --- | --- |
| `omnidesk-api` | `ghcr.io/inerhead/omnidesk-api:vX.Y.Z` | API: `apps/api/Dockerfile`, etapa `prod`, con `APP_VERSION` = el tag (SPEC 26) |
| `omnidesk-gateway` | `ghcr.io/inerhead/omnidesk-gateway:vX.Y.Z` | Caddy + web, con `BASE_PATH=/omnidesk` y `VITE_API_URL` vacía (SPEC 26) |
| `omnidesk-deploy` | `ghcr.io/inerhead/omnidesk-deploy:vX.Y.Z` | Bundle: `VERSION`, `deploy.sh`, `docker-compose.prod.yml`, `backup.sh`, `.env.prod.example` y `omnidesk-deploy`, en `/bundle/`. Sin código de la app (SPEC 27) |

- **Una versión publicada es inmutable**: si un paquete de un tag ya existe, el pipeline no lo reconstruye.
- El job `prune` conserva las **10 versiones más recientes** de cada paquete.
- Los tags `v0.1.0` y `v0.1.1` no tienen imágenes (anteriores a SPEC 26), y los anteriores a SPEC 27 no tienen bundle: no se despliegan.

### ¿Es gratis?

Hoy sí. La [documentación de GitHub Packages](https://docs.github.com/en/billing/concepts/product-billing/github-packages) dice que el almacenamiento y el ancho de banda del Container registry son actualmente gratuitos, y que avisarán con al menos un mes de antelación de cualquier cambio. Tenlo presente:

- Es una política vigente, no una garantía. Si cambia, las opciones son pagar, hacer los paquetes públicos o usar otro registro.
- La misma página lista cuotas para paquetes privados (cuenta Free: 500 MB de almacenamiento y 1 GB de transferencia al mes) y no aclara si la exención del registro de contenedores las anula. La retención de 10 versiones acota el uso. El bundle ocupa unos KB.
- La descarga desde Actions con `GITHUB_TOKEN` es gratis; la del VPS usa tu token personal.

Revisa **Settings → Billing and plans → Usage** de tu cuenta de vez en cuando para ver si el registro empieza a contar.

### Ver las imágenes en GitHub

**En la web** (los nombres de los menús pueden variar un poco):

1. **Desde el repo.** En `https://github.com/inerhead/OmniDesk`, barra lateral derecha, apartado **Packages**: lista los tres paquetes enlazados al repo. Cada uno abre `https://github.com/inerhead/OmniDesk/pkgs/container/omnidesk-api` (o `omnidesk-gateway`, `omnidesk-deploy`).
2. **Desde tu perfil.** `https://github.com/inerhead?tab=packages` lista todos tus paquetes. La página de cada uno es `https://github.com/users/inerhead/packages/container/package/omnidesk-api`.
3. **En la página del paquete**, la lista de versiones muestra las etiquetas (`v0.1.2`, …), la fecha y el tamaño. Al abrir una versión ves el **digest** (`sha256:…`) y el comando `docker pull`.
4. **Ajustes del paquete** (**Package settings**): comprueba que la visibilidad es **Private**, que el repo `OmniDesk` figura como enlazado y su rol (**Manage Actions access**).
5. **En Actions.** En **Actions → release**, abre un run: su **resumen** lista los tres paquetes publicados con su digest.

**Desde el terminal:**

```bash
# Listar las versiones de un paquete (necesita el permiso read:packages en gh)
gh auth refresh -h github.com -s read:packages
gh api /user/packages/container/omnidesk-deploy/versions \
  --jq '.[] | {id, etiquetas: .metadata.container.tags, creada: .created_at}'

# Comprobar que una etiqueta existe, sin descargarla (necesita docker login ghcr.io)
docker manifest inspect ghcr.io/inerhead/omnidesk-api:v0.1.2 > /dev/null && echo existe

# Ver qué trae un bundle sin desplegarlo
id=$(docker create ghcr.io/inerhead/omnidesk-deploy:v0.1.2) && docker export "$id" | tar -t && docker rm "$id"
```

Sin sesión, `docker manifest inspect` y `docker pull` responden `denied` o `unauthorized`: los paquetes son privados.

### Primera publicación: qué comprobar

Tras el primer push a `main` que publica un paquete nuevo, en GitHub:

1. **Actions → release**: los jobs `images` y `prune` terminaron (el segundo puede mostrar un aviso, ver abajo).
2. Los tres paquetes existen, son **Private** y están **enlazados al repo**. Si uno no estuviera enlazado, Actions no podría publicar versiones nuevas: en **Package settings → Manage Actions access**, añade el repo `OmniDesk` con rol **Write**.
3. **Para que `prune` pueda borrar versiones antiguas**, el repo necesita el rol **Admin** en ese mismo apartado (con **Write** puede publicar pero no borrar). Hazlo una vez por paquete, también en `omnidesk-deploy`. Mientras no lo hagas, `prune` termina con un aviso («No se pudieron borrar versiones antiguas…») y el release sigue en verde; las versiones se acumulan.

### Token y sesión en el VPS (una vez)

Se usa un token personal **clásico** de solo lectura (los tokens de granularidad fina no admiten paquetes de `ghcr.io`):

1. En GitHub: **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**. Nombre `omnidesk-vps`, **caducidad** (por ejemplo 90 días) y un único permiso: **`read:packages`**.
2. Copia el token (solo se muestra una vez) e inicia sesión en el VPS. Pégalo cuando pida `Password:` (no se ve y no queda en el historial):

   ```bash
   docker login ghcr.io -u inerhead
   ```

   Docker guarda la credencial en `~/.docker/config.json` (en base64, no cifrada): el archivo es del usuario de despliegue.
3. Comprueba que funciona (con el tag que exista):

   ```bash
   docker manifest inspect ghcr.io/inerhead/omnidesk-deploy:v0.1.2 > /dev/null && echo ok
   ```

**Caducidad y rotación.** Cuando el token caduca, `omnidesk-deploy` falla al descargar el bundle. Genera uno nuevo y repite `docker login`. Para **revocarlo** (por ejemplo, si se filtra): Developer settings → Tokens (classic) → **Delete**, y `docker logout ghcr.io` en el VPS.

## 9. Dimensionamiento: ¿cabe en el VPS mínimo?

Plan mínimo de referencia: **VPS-1** de OVHcloud, 2 vCores, 4 GB de RAM y 40 GB NVMe (según su [web](https://us.ovhcloud.com/vps/compare/); confirma las cifras y el precio de tu región en el configurador antes de contratar). El siguiente, **VPS-2**, tiene 4 vCores, 8 GB y 75 GB.

Presupuesto de OmniDesk en VPS-1, dejando espacio a otra app en el mismo servidor:

| Recurso | VPS-1 | SO, Docker y swap | Máximo para OmniDesk | Resto para otra app |
| --- | --- | --- | --- | --- |
| RAM | 4 GB | 0,5 GB | 2 GB (los 7 servicios en uso normal) | ≥ 1,5 GB |
| Disco | 40 GB | 8 GB | 20 GB (imágenes, volúmenes y 7 backups) | ≥ 12 GB |
| CPU | 2 vCores | — | Sin tope | — |

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
- **Sin build en el VPS:** el build en frío medido en local subía ~944 MiB la memoria; desde SPEC 26 ese pico ocurre en GitHub Actions, no en el servidor.
- **Sin medir:** carga con mensajes reales (el simulador necesita `DEMO_CHANNEL_API_KEY`, que no existe con `DEMO_MODE=false`) y crecimiento de `postgres` y MinIO con datos reales.

**Veredicto provisional: cabe en VPS-1** (0,3 a 0,65 GB de los 2 GB del presupuesto). Se confirma, o se cambia a «necesita VPS-2», con la medición en el VPS. Si OmniDesk supera 2 GB en uso normal, la conclusión es VPS-2.

**Límites en el compose:** un servicio descontrolado no debe quitarle la RAM a otra app del servidor.

| Servicio | `mem_limit` | Pico medido con carga |
| --- | --- | --- |
| `api` | 768m | 187 MiB |
| `postgres` | 512m | 48 MiB |
| `minio` | 384m | 99 MiB |
| `gateway` | 128m | 33 MiB |

`cloudflared`, `autoheal` y `backup` no llevan límite: consumen poco y un tope justo podría matarlos en el pico del backup. Todos los servicios rotan sus logs (`json-file`, 10 MB × 3 archivos). Los valores se ajustan en el repo (nunca en el servidor) y llegan con el bundle del tag siguiente.

**Medir en el VPS**, tras el primer despliegue:

```bash
docker stats --no-stream                       # memoria de cada servicio (suma ≤ 2 GB)
free -m && swapon --show                       # memoria disponible y uso de swap
df -h /  && docker system df                   # disco (≤ 60 % con 7 backups)
dmesg | grep -i 'out of memory'                # no debe imprimir nada
```

Mide también **durante** un despliegue (en otra sesión SSH, `watch -n2 free -m`): la memoria disponible no debe llegar a 0 y el swap no debe usarse de forma sostenida.

`deploy.sh` limpia al terminar bien las imágenes huérfanas y las de OmniDesk de versiones anteriores que nadie usa (filtradas por la etiqueta `org.opencontainers.image.source`, sin tocar las de otras apps), y la caché de build de más de 7 días (`docker builder prune`, que actúa sobre todo el host).

### Swap de 2 GB

Prod ya no compila en el VPS, así que el swap es solo un seguro ante picos (por ejemplo, la otra app). Comprueba primero si el VPS ya tiene:

```bash
swapon --show        # vacío = sin swap
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -m              # Swap: 2047
```

## 10. Convivir con otras apps en el mismo VPS

OmniDesk no asume que está solo en el servidor. Si despliegas otra app (por ejemplo, la del restaurante) en el mismo VPS:

| Tema | Regla |
| --- | --- |
| **Túnel** | El `cloudflared` de OmniDesk comparte la red de su gateway y su servicio es `http://localhost:80`: solo sirve a OmniDesk. La otra app usa **su propio túnel** (token y hostname distintos). |
| **Proyecto Compose** | OmniDesk es `omnidesk-prod`. La otra app usa otro nombre de proyecto, para que no compartan red ni volúmenes. |
| **Puertos** | OmniDesk usa `127.0.0.1:8082` (gateway) y `127.0.0.1:9150` (MinIO). La otra app, otros. Todo se publica solo en `127.0.0.1`. |
| **`autoheal`** | El `autoheal` de OmniDesk reinicia **cualquier** contenedor `unhealthy` del servidor que lleve la etiqueta `autoheal=true`. La otra app **no debe usar esa etiqueta**. Comprueba el log: `docker logs omnidesk-prod-autoheal` solo debe mencionar contenedores `omnidesk-prod-*`. |
| **Horarios** | El backup de OmniDesk corre a las 03:00 y la retención a las 03:30 (hora del servidor). La otra app no programa tareas pesadas a esas horas. |
| **Despliegues** | Despliega una app a la vez. |
| **Firewall y usuario** | Compartidos: solo SSH entrante. |
| **Recursos** | Presupuesto de OmniDesk: 2 GB de RAM y 20 GB de disco (§9). Lo demás es de la otra app. |

## Secretos de canales y WhatsApp (SPEC 09)

`CHANNEL_SECRETS_KEY` cifra HMAC, access tokens y app secrets de Meta. Guarda una copia segura de la clave separada del backup de PostgreSQL. Las claves `VAPID_*` (Web Push) van en el mismo sitio: regenerarlas invalida las suscripciones y cada dispositivo debe volver a activarlas. Restaurar solo la base sin la misma clave deja los secretos ilegibles. Si se pierde la clave, configura una nueva, vuelve a introducir los secretos Meta desde Settings y rota las credenciales de integración; actualiza n8n con el nuevo HMAC.

Las imágenes del API aplican las migraciones al arrancar. `WHATSAPP_GRAPH_VERSION` se pasa al API desde el compose; por defecto usa `v25.0`. `APP_URL` debe coincidir con el dominio y subruta públicos: de él sale el callback que se muestra en Settings.

Mantén el reloj del servidor sincronizado (NTP) para la tolerancia HMAC de ±300 segundos. La conexión de WhatsApp y n8n se configura por empresa siguiendo [la guía de integración](integracion-n8n.md).

## Adjuntos y MinIO (SPEC 14)

El API de producción exige `ATTACHMENT_STORAGE_DRIVER=s3`. El compose lo fija y apunta a MinIO del mismo proyecto (`http://minio:9000`, bucket `omnidesk-attachments`). En el `.env.prod` hay que rellenar:

| Variable | Uso |
| --- | --- |
| `MINIO_ROOT_USER` | Usuario raíz de MinIO y `S3_ACCESS_KEY_ID` del API. |
| `MINIO_ROOT_PASSWORD` | Contraseña (`openssl rand -hex 24`, solo letras y números) y `S3_SECRET_ACCESS_KEY`. |
| `MINIO_HOST_PORT` | Puerto S3 publicado solo en `127.0.0.1` (`9150`). |
| `S3_BUCKET` | Opcional. Por defecto `omnidesk-attachments`. |
| `ATTACHMENT_INBOUND_MAX_BYTES` | Opcional. Tope de un adjunto entrante; por defecto 25 MB (`26214400`). |

Fuera de producción, si no se define el driver, el API usa `memory` (los archivos se pierden al reiniciar). `.env.example` de desarrollo local pone `s3` para usar el MinIO de `docker-compose.yml`. La consola de ese MinIO local está en <http://localhost:9051>.

El API admite 16 MB por archivo saliente. MinIO no publica consola en el VPS; para administrarlo, abre un túnel SSH al puerto `MINIO_HOST_PORT`.

La imagen es `pgsty/minio`, un fork comunitario mantenido por Pigsty: MinIO dejó de publicar imágenes y el repositorio `minio/minio` ya no existe en Docker Hub ni en quay.io. Usa el mismo `server /data`, las mismas variables `MINIO_ROOT_*` e incluye `mc` para el healthcheck.

El volumen se llama `omnidesk-prod_miniodata`. El `backup now` escribe `omnidesk-prod-media-YYYYMMDD.tar.gz` junto al dump de Postgres y conserva los 7 más recientes. Un `tar` en caliente puede no incluir un objeto que se está escribiendo en ese momento.

Restaurar los adjuntos:

```bash
$C stop api minio
docker run --rm -v omnidesk-prod_miniodata:/data -v /srv/omnidesk/backups/prod:/b alpine \
  sh -c 'rm -rf /data/* && tar -xzf /b/omnidesk-prod-media-YYYYMMDD.tar.gz -C /data'
$C up -d --no-build
```

El envío de adjuntos no tiene rate limit: SPEC 10 no está en el repositorio. Cuando exista, debe cubrir `POST /api/v1/conversations/:id/messages/attachments`.

## Retención y Row Level Security (SPEC 12)

`DATABASE_APP_PASSWORD` (`openssl rand -hex 24`: va dentro de una URL, solo letras y números) es obligatoria en el `.env.prod`: el compose arma con ella `DATABASE_APP_URL`, y sin ella no levanta el API.

Al arrancar, el API aplica las migraciones (entre ellas `…_retention`, `…_app_role` y `…_rls`), y después `scripts/ensure-app-role.mjs` fija la contraseña de `omnidesk_app_login` con `DATABASE_APP_PASSWORD`. Si cambias la variable, basta con reiniciar el API. Antes de desplegar una versión con migraciones que cambian permisos, haz un **backup manual** (§5) y pruébala en local.

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
| `cloudflared` (prod y local) | `cloudflared tunnel ready`: falla con 0 conexiones activas | 3 fallos × 30 s + hasta 10 s: unos 100 s |
| `gateway` | `wget` a `${BASE_PATH}/` | unos 100 s |
| `api` | `GET /api/v1/health/live`: liveness, **no** mira la base | 5 fallos × 10 s + hasta 10 s: unos 60 s |

- **El API no se reinicia por la base.** Con Postgres caído, `/api/v1/health` responde `503` (es el que deben usar los monitores externos), pero `/health/live` sigue en `200`. Reiniciar el API no arreglaría la base.
- **Detección del túnel.** Tras un corte de red, `cloudflared` tarda unos 2–3 min en dar por perdidas sus conexiones. Después, autoheal lo reinicia en unos 70 s: unos 4 min desde el corte.
- **Reiniciar el gateway reinicia también el túnel**, que comparte su red (`network_mode: service:gateway`): se queda sin red, pasa a `unhealthy` y autoheal lo reinicia unos 100 s después.
- **Sin backoff.** Un servicio que falla siempre (por ejemplo, el API con una migración rota) se reinicia sin fin. Se ve en el log de autoheal.
- **`postgres`, `minio` y `backup` no llevan la etiqueta**: autoheal nunca los toca.
- **Seguridad.** autoheal monta `/var/run/docker.sock`, que da control total de Docker en el host. El `:ro` no limita esa API. La imagen va fijada (`willfarrell/autoheal:1.2.0`), sin puertos ni red publicada.

```bash
$C ps                                                         # columna STATUS: (healthy) / (unhealthy)
docker inspect --format '{{.State.Health.Status}}' omnidesk-prod-cloudflared
docker logs omnidesk-prod-autoheal                            # una línea por cada reinicio
```

## Evolución

- **Copias de los backups fuera del VPS** (S3 u otro): hoy los backups están en el mismo disco que la base, un riesgo aceptado (SPEC 08).
- Despliegue automático desde GitHub.
- Despliegue sin caída (blue/green).
- Varias instancias del API, que requieren el adapter Redis de Socket.IO.
- Monitoreo y alertas (SPEC 11).
