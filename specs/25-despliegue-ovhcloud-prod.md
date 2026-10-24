# SPEC 25 — Despliegue de prod en un VPS de OVHcloud con `.env.prod`

> **Status:** Appoved
> **Depends on:** SPEC 08, SPEC 12, SPEC 14, SPEC 19
> **Date:** 2026-10-23
> **Objective:** OmniDesk se despliega en prod en un VPS de OVHcloud ya contratado, con el `.env.prod` del usuario, la etiqueta `v0.1.0` y el túnel de Cloudflare, y queda accesible en `https://channel.gastromesa.com/omnidesk` con una base de datos vacía.

## Por qué existe este spec

SPEC 08 dejó el despliegue manual con `deploy.sh`, pero asumía un VPS con Nginx propio, TLS y `https://gastromesa.com/omnidesk`. SPEC 19 añadió después el túnel `cloudflared` al compose de producción. El `.env.prod` real del usuario ya refleja esa realidad (`APP_URL` y `GOOGLE_CALLBACK_URL` en `https://channel.gastromesa.com/omnidesk`, `CLOUDFLARE_TUNNEL_TOKEN`), pero se armó para correr en un portátil:

- `BACKUP_DIR` apunta a una ruta de macOS (`/Volumes/…`), que no existe en el VPS.
- `CORS_ORIGINS` aparece **dos veces**, una con `https://gastromesa.com` y otra con `http://localhost:8082` y `https://channel.gastromesa.com`. Con una clave duplicada, el valor que gana depende de cómo la lea Compose, y el origen correcto no está garantizado.
- Hay comentarios de arranque local y claves que la plantilla no tiene (`WEB_UPSTREAM`, `API_HOST_PORT`, `POSTGRES_HOST_PORT`, `SIMULATOR_HMAC_SECRET`) y una que le falta (`METRICS_TOKEN`).

Este spec es operativo: no cambia el comportamiento de la app. Define qué se corrige en el `.env.prod`, cómo se prepara el VPS de OVHcloud y cómo se verifica el primer despliegue.

Lo que ya fijaron otros specs y aquí no se reabre:

- Topología, subruta `/omnidesk`, dos proyectos Compose, `deploy.sh <env> <ref>`, backups y rollback (SPEC 08).
- Roles de base de datos, RLS y `DATABASE_APP_PASSWORD` (SPEC 12).
- MinIO y `ATTACHMENT_STORAGE_DRIVER=s3` (SPEC 14).
- `cloudflared` comparte la red del gateway (`http://localhost:80` en Cloudflare) y `autoheal` (SPEC 19).

## Alcance

**Dentro:**

- **Preparar el `.env.prod` para el VPS** (el archivo real no se sube a git; el spec fija los valores):
  - `BACKUP_DIR=/srv/omnidesk/backups/prod`.
  - Una sola `CORS_ORIGINS=https://channel.gastromesa.com` (sin `/omnidesk`, sin barra final, sin `localhost`).
  - `APP_URL`, `GOOGLE_CALLBACK_URL`, `BASE_PATH` y `PUBLIC_BASE_PATH` se conservan como están.
  - Se comprueba que `NODE_ENV=production`, `DEMO_MODE=false`, `SESSION_COOKIE_SECURE=true`, `TRUST_PROXY=2`, `ATTACHMENT_STORAGE_DRIVER=s3` y `OMNIDESK_ENV=prod`.
  - Se eliminan los comentarios de arranque local.
  - Se revisan `METRICS_TOKEN` (plantilla) y las claves extra del archivo frente a lo que consume `docker-compose.prod.yml` y `apps/api/src/shared/config/env.ts`. Las que nada consume se quitan.
  - `N8N_WEBHOOK_ALLOWED_HOSTS` se rellena con los hosts reales de n8n, o se deja vacía de forma consciente.
- **Preparar el VPS de OVHcloud** (una vez, documentado en `docs/despliegue.md`):
  - Docker Engine con el plugin Compose v2, `git` y un usuario no root del grupo `docker`.
  - Carpetas `/srv/omnidesk/` y `/srv/omnidesk/backups/prod`.
  - Firewall: solo SSH entrante. `cloudflared` sale por 443 hacia Cloudflare, así que no se abren 80 ni 443. Los puertos `GATEWAY_HOST_PORT` y `MINIO_HOST_PORT` solo escuchan en `127.0.0.1`.
  - NTP activo (tolerancia HMAC de ±300 s, SPEC 09).
  - Deploy key SSH **de solo lectura** generada en el VPS y registrada en el repo privado `inerhead/OmniDesk`; clon en `/srv/omnidesk/repo`.
- **Llevar el `.env.prod` al VPS** con `scp` a `/srv/omnidesk/.env.prod`, con `chmod 600`.
- **Etiqueta `v0.1.0`** creada y subida a `origin` (no existe ninguna hoy).
- **Mejora de `deploy.sh`** (validación previa, sin cambiar el flujo):
  - Falla si una clave del `.env` aparece duplicada.
  - Falla si `BACKUP_DIR` no existe en el host.
  - Falla si `CORS_ORIGINS` incluye `localhost`, solo cuando el entorno es `prod`.
  - Mensajes en español, como el resto del script.
- **Traspaso del túnel:** el `CLOUDFLARE_TUNNEL_TOKEN` es el mismo que usa el prod del portátil. Antes de arrancar el VPS se detiene el prod local (`docker compose -p omnidesk-prod … down`, sin `-v`) para que Cloudflare no reparta tráfico entre dos conectores.
- **Primer despliegue y verificación:** `infra/deploy/deploy.sh prod v0.1.0` en el VPS, y las comprobaciones de los criterios de aceptación.
- **Documentación** (`docs/despliegue.md`):
  - Sección "OVHcloud + Cloudflare Tunnel (SPEC 25)" con el runbook paso a paso.
  - Aclaración de que, con túnel, el fragmento de Nginx (§1.4) y la ruta de `gastromesa.com` no aplican.
  - Tabla de valores del `.env.prod` que cambian para el VPS.
  - Verificación de la URI de redirección de Google y de la URL del webhook de WhatsApp/n8n.

**Fuera de alcance (para futuros specs):**

- El entorno **dev** en OVHcloud: solo se despliega prod.
- Migrar datos del Postgres o del MinIO del portátil: la base arranca vacía y el primer usuario crea la empresa.
- Reconfigurar WhatsApp (Meta) y n8n hacia la nueva URL. Se documenta como paso posterior; ningún criterio depende de ello.
- Copia de los backups fuera del VPS (S3 de OVH u otro). Los backups quedan en el mismo disco (riesgo ya aceptado en SPEC 08).
- CI/CD, despliegue sin caída y varias instancias del API.
- Contratar o dimensionar el VPS. Se asume que existe.
- Gestionar `.env.prod` con un gestor de secretos.

## Modelo de datos

Este spec no introduce estructuras de datos. Solo cambian valores del `.env.prod` de prod:

| Variable | Valor en el VPS |
| --- | --- |
| `BACKUP_DIR` | `/srv/omnidesk/backups/prod` |
| `CORS_ORIGINS` | `https://channel.gastromesa.com` (una sola línea) |
| `APP_URL` | `https://channel.gastromesa.com/omnidesk` (sin cambios) |
| `GOOGLE_CALLBACK_URL` | `https://channel.gastromesa.com/omnidesk/api/v1/auth/google/callback` (sin cambios) |
| `GATEWAY_HOST_PORT` | `8082` (sin cambios) |
| `MINIO_HOST_PORT` | el del archivo (`9150`) |

Ubicaciones en el VPS:

```text
/srv/omnidesk/repo               clon (deploy key de solo lectura)
/srv/omnidesk/.env.prod          chmod 600
/srv/omnidesk/backups/prod/      dumps y archivos de media
```

## Plan de implementación

1. **Validaciones en `deploy.sh`.** Claves duplicadas, `BACKUP_DIR` existente y `CORS_ORIGINS` sin `localhost` en prod. Comprobación con `bash -n` y ensayo local con un `.env` de prueba que provoque cada fallo.
2. **Documentación.** Sección de OVHcloud y Cloudflare en `docs/despliegue.md`, con la tabla de valores y el runbook. Aclaración sobre Nginx.
3. **Corregir el `.env.prod`** local según la tabla. Comprobar sin arrancar nada: `docker compose -p omnidesk-prod --env-file .env.prod -f infra/deploy/docker-compose.prod.yml config` termina con código 0 y no hay claves duplicadas.
4. **Etiqueta.** Tras fusionar los pasos 1 y 2 en `main`, crear y subir `v0.1.0`.
5. **Preparar el VPS.** Docker, usuario, carpetas, firewall, NTP, deploy key y clon.
6. **Copiar el `.env.prod`** al VPS con `scp` y `chmod 600`.
7. **Backup y parada del prod local.** Backup manual del portátil por si acaso y `down` (sin `-v`) del proyecto `omnidesk-prod` local.
8. **Desplegar.** `infra/deploy/deploy.sh prod v0.1.0` en el VPS.
9. **Verificar** los criterios de aceptación. Lo que falle se corrige en el repo o en la guía, no a mano en el servidor.

## Criterios de aceptación

**Antes del despliegue**

- [ ] `.env.prod` no tiene claves duplicadas (`grep -E '^[A-Z_]+=' .env.prod | cut -d= -f1 | sort | uniq -d` no imprime nada).
- [ ] `docker compose -p omnidesk-prod --env-file .env.prod -f infra/deploy/docker-compose.prod.yml config` termina con código 0.
- [ ] `deploy.sh prod v0.1.0` falla con un mensaje claro si hay una clave duplicada, si `BACKUP_DIR` no existe o si `CORS_ORIGINS` contiene `localhost`.
- [ ] La etiqueta `v0.1.0` existe en `origin`.

**VPS**

- [ ] `git ls-remote origin` funciona en el VPS con la deploy key, y esa clave no tiene permiso de escritura en GitHub.
- [ ] `stat -c %a /srv/omnidesk/.env.prod` devuelve `600`.
- [ ] `ss -ltn` en el VPS muestra `8082` y el puerto de MinIO solo en `127.0.0.1`, y Postgres no escucha en ninguna interfaz del host.
- [ ] Desde fuera del VPS, los puertos `80`, `443`, `8082` y el de MinIO no responden.

**Despliegue**

- [ ] `infra/deploy/deploy.sh prod v0.1.0` termina con código 0 e imprime `✅ omnidesk-prod desplegado: v0.1.0`.
- [ ] `docker compose … ps` muestra `postgres`, `api`, `gateway`, `backup`, `minio`, `cloudflared` y `autoheal` en marcha, y los que tienen healthcheck, `healthy`.
- [ ] `curl -s https://channel.gastromesa.com/omnidesk/api/v1/health` responde `status: ok`, la base `up` y `version: v0.1.0`.
- [ ] `https://channel.gastromesa.com/omnidesk/api/docs` responde `404`.
- [ ] El login con Google en `https://channel.gastromesa.com/omnidesk` funciona. La cookie tiene `Secure`, `HttpOnly`, `SameSite=Lax` y `Path=/omnidesk`.
- [ ] Un email de `PLATFORM_ADMIN_EMAILS` ve **Plataforma** y la empresa creada puede aprobarse.
- [ ] El badge muestra **En vivo** (WebSocket por el túnel).
- [ ] Subir un adjunto desde la app lo guarda en MinIO del VPS y se vuelve a descargar.
- [ ] En Cloudflare, el túnel muestra una sola conexión de conector (el VPS) y el portátil ya no sirve tráfico.
- [ ] Tras 03:00, existe `/srv/omnidesk/backups/prod/omnidesk-prod-<fecha>.dump`.
- [ ] Tras reiniciar el VPS, todos los servicios vuelven solos y la URL pública responde.

## Decisiones

- **Sí:** solo prod, base de datos vacía. Lo decidió el usuario; evita migrar datos de un portátil de pruebas.
- **No:** dev en el mismo VPS. Queda para otro spec.
- **Sí:** Cloudflare Tunnel y no Nginx con TLS propio. Lo decidió el usuario; ya está en el compose (SPEC 19), el `.env.prod` lo usa y no hace falta abrir puertos en OVH ni gestionar certificados.
- **No:** abrir 80 y 443 en el firewall de OVH. El túnel solo hace conexiones salientes.
- **Sí:** dominio `https://channel.gastromesa.com/omnidesk`. Lo decidió el usuario y coincide con `APP_URL` y el callback de Google ya registrados.
- **No:** `https://gastromesa.com/omnidesk` (el de SPEC 08). No es el que tiene el `.env.prod` ni el que tiene OAuth.
- **Sí:** se reutiliza el mismo túnel y se apaga el prod del portátil. Decisión del usuario. Dos conectores del mismo túnel reparten tráfico y una parte de los usuarios vería una instancia con otra base de datos.
- **Sí:** deploy key SSH de solo lectura para el repo privado. Un token personal daría más permisos y quedaría guardado en el VPS.
- **Sí:** `.env.prod` por `scp`, nunca por git, con `chmod 600`. El archivo contiene secretos reales y `.env.*` está ignorado.
- **Sí:** el spec corrige los valores del `.env.prod` y `deploy.sh` los valida. Un `BACKUP_DIR` inexistente rompe el servicio `backup` en silencio y una `CORS_ORIGINS` duplicada es ambigua.
- **Sí:** el despliegue sigue siendo `deploy.sh prod <etiqueta>` construyendo en el VPS. Es lo que fijó SPEC 08.
- **Sí:** WhatsApp y n8n se reconfiguran después. Dependen de que la URL pública ya responda y no bloquean la app.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El portátil y el VPS conectados al mismo túnel a la vez | Paso 7: parar el prod local antes del despliegue. Criterio: una sola conexión en Cloudflare. |
| `CHANNEL_SECRETS_KEY` o `DATABASE_APP_PASSWORD` distintos de los del portátil | La base es nueva, así que no hay secretos cifrados que perder. Se guarda una copia de la clave fuera del VPS (SPEC 09). |
| El build en el VPS agota RAM o CPU | `deploy.sh` construye una imagen a la vez. Si falla, la alternativa `docker save`/`load` de `docs/despliegue.md` §3. |
| Pérdida del VPS y de sus backups (mismo disco) | Riesgo aceptado en SPEC 08. Copias externas quedan para otro spec. |
| Google rechaza el login (`redirect_uri_mismatch`) | Se verifica la URI en la credencial antes de desplegar. |
| El puerto de MinIO o el gateway quedan expuestos por una regla del firewall de OVH | Criterio de aceptación con comprobación desde fuera. |
| `METRICS_TOKEN` falta y el endpoint de métricas queda sin proteger | Se revisa en el paso 3 contra `env.ts`. |

## Lo que **no** entra en este spec

- Entorno dev en OVHcloud.
- Migración de datos locales.
- Reconfiguración de WhatsApp/Meta y n8n.
- Backups fuera del VPS.
- CI/CD, blue/green y varias instancias del API.
- Contratación o dimensionado del VPS.

Cada uno de esos, si llega, va en su propio spec.
