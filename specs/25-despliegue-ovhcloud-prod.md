# SPEC 25 — Despliegue de prod en un VPS de OVHcloud con `.env.prod` y tags automáticos

> **Status:** Approved
> **Depends on:** SPEC 08, SPEC 12, SPEC 14, SPEC 19
> **Date:** 2026-10-23
> **Objective:** OmniDesk se despliega en prod en un VPS de OVHcloud ya contratado, con el `.env.prod` del usuario y el túnel de Cloudflare, a partir de tags `vX.Y.Z` que un pipeline de GitHub crea solo sobre los commits de `main` que pasan los checks y aplican todas las migraciones, y queda accesible en `https://channel.gastromesa.com/omnidesk` con una base de datos vacía, medido y limitado para caber en el VPS mínimo de OVHcloud y convivir en él con otras apps.

## Por qué existe este spec

SPEC 08 dejó el despliegue manual con `deploy.sh`, pero asumía un VPS con Nginx propio, TLS y `https://gastromesa.com/omnidesk`. SPEC 19 añadió después el túnel `cloudflared` al compose de producción. El `.env.prod` real del usuario ya refleja esa realidad (`APP_URL` y `GOOGLE_CALLBACK_URL` en `https://channel.gastromesa.com/omnidesk`, `CLOUDFLARE_TUNNEL_TOKEN`), pero se armó para correr en un portátil:

- `BACKUP_DIR` apunta a una ruta de macOS (`/Volumes/…`), que no existe en el VPS.
- `CORS_ORIGINS` aparece **dos veces**, una con `https://gastromesa.com` y otra con `http://localhost:8082` y `https://channel.gastromesa.com`. Con una clave duplicada, el valor que gana depende de cómo la lea Compose, y el origen correcto no está garantizado.
- Hay comentarios de arranque local y claves que la plantilla no tiene (`WEB_UPSTREAM`, `API_HOST_PORT`, `POSTGRES_HOST_PORT`, `SIMULATOR_HMAC_SECRET`) y una que le falta (`METRICS_TOKEN`).

Además, SPEC 08 exigía que prod se desplegara desde una etiqueta `vX.Y.Z`, pero nadie las crea: hoy no existe ninguna y el repo no tiene pipeline (no hay carpeta `.github`). Crearlas a mano es un paso que se olvida, y nada garantiza que el commit etiquetado esté sano. El usuario pidió que un pipeline en GitHub las genere solo y que prod se despliegue siempre por tag, para poder volver a un tag anterior.

Por último, el VPS no será solo de OmniDesk: el usuario quiere desplegar en él otra app (la del restaurante) y quiere saber si OmniDesk cabe en el plan mínimo de OVHcloud. Hoy no hay datos para responder:

- El compose de producción no fija límites de memoria ni de CPU en ningún servicio, ni límite de tamaño para los logs de Docker (que crecen sin tope).
- Corre siete servicios: `postgres`, `api`, `gateway` (Caddy), `cloudflared`, `autoheal`, `minio` y `backup`.
- Nunca se midió su consumo. Los contenedores que hoy corren en el portátil del usuario son de otras apps, así que tampoco hay una medición previa de OmniDesk.
- Hay dos puntos del diseño que asumen que OmniDesk está solo en el host: `autoheal` reinicia cualquier contenedor `unhealthy` con la etiqueta `autoheal=true` de todo el host, y el `cloudflared` comparte la red del gateway de OmniDesk, así que su túnel no puede servir a otra app.

El plan mínimo de la gama actual de OVHcloud (VPS-1) ofrece 2 vCores, 4 GB de RAM y 40 GB de NVMe según su web (<https://us.ovhcloud.com/vps/compare/>, consultada el 2026-10-24); las fuentes discrepan en algunas cifras y precios por región, así que se confirman en el configurador antes de decidir. Este spec fija cuánto puede usar OmniDesk de ese VPS, cómo se mide y qué se hace si no cabe.

Este spec es operativo: no cambia el comportamiento de la app. Define qué se corrige en el `.env.prod`, el pipeline que etiqueta `main`, cómo se dimensiona y se hace convivir OmniDesk con otras apps, cómo se prepara el VPS de OVHcloud y cómo se verifica el primer despliegue.

Lo que ya fijaron otros specs y aquí no se reabre:

- Topología, subruta `/omnidesk`, dos proyectos Compose, `deploy.sh <env> <ref>`, backups y rollback por ref anterior (SPEC 08). Prod sigue desplegándose solo desde una etiqueta `vX.Y.Z`; este spec añade que el tag debe venir de `main`.
- Roles de base de datos, RLS y `DATABASE_APP_PASSWORD` (SPEC 12). Las migraciones de RLS exigen un rol superusuario.
- MinIO y `ATTACHMENT_STORAGE_DRIVER=s3` (SPEC 14).
- `cloudflared` comparte la red del gateway (`http://localhost:80` en Cloudflare) y `autoheal` (SPEC 19).

## Alcance

**Dentro:**

- **Pipeline de GitHub** `.github/workflows/release.yml`, que se ejecuta en cada `push` a `main` (no en ramas ni en pull requests) y crea el tag solo si todo pasa:
  - **Job `verify`:** `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`, con Node 24 (`.nvmrc`). El e2e del API no entra (necesita el stack levantado).
  - **Job `migrations`:** levanta un Postgres de la misma versión que usa el compose de producción (`postgres:18`), con un usuario superusuario, **sin datos**, y comprueba dos cosas:
    - Todas las migraciones de `apps/api/prisma/migrations` se aplican de principio a fin con `prisma migrate deploy` (el mismo comando con el que arranca el API en prod), y después corre `db:app-role` (`scripts/ensure-app-role.mjs`) sin error.
    - No hay deriva: `prisma migrate diff` entre las migraciones y `schema.prisma` no encuentra diferencias. Si alguien cambió el schema sin crear la migración, el pipeline falla. Los flags exactos se confirman contra la versión de Prisma instalada.
  - **Job `tag`** (depende de `verify` y `migrations`):
    - Toma el tag `vX.Y.Z` más alto existente (orden por versión). Si no hay ninguno, el primero es `v0.1.0`.
    - Crea `vX.Y.(Z+1)` sobre el commit del push y lo sube a `origin`.
    - Si ese commit ya tiene un tag `vX.Y.Z`, no crea otro.
    - Subir el menor o el mayor se hace a mano: se crea y sube un tag (`v0.2.0`) y el pipeline sigue desde él (`v0.2.1`, …).
    - Permisos mínimos: `contents: write` solo en este job; los otros leen.
  - **Concurrencia:** un grupo por rama, sin cancelar ejecuciones en curso, para que dos pushes seguidos no calculen el mismo número.
  - Si `verify` o `migrations` fallan, **no hay tag** y ese commit no se puede desplegar en prod.
- **Cambio de `deploy.sh`** (prod acepta solo tags creados desde `main`):
  - En `prod`, el ref debe ser una etiqueta `vX.Y.Z` (como hoy) **y** su commit debe estar contenido en `origin/main` (`git merge-base --is-ancestor`). Un tag puesto a mano en otra rama se rechaza con un mensaje claro.
  - `dev` no cambia: sigue aceptando cualquier ref, incluido `main`.
  - La versión visible (`APP_VERSION`, `/health`, página Estado) es el tag, como en SPEC 08.
  - Validaciones previas, sin cambiar el resto del flujo:
    - Falla si una clave del `.env` aparece duplicada.
    - Falla si `BACKUP_DIR` no existe en el host.
    - Falla si `CORS_ORIGINS` incluye `localhost`, solo cuando el entorno es `prod`.
  - Mensajes en español, como el resto del script.
- **Dimensionar OmniDesk** para el VPS mínimo (presupuesto en "Modelo de datos"):
  - **Medición antes de desplegar:** se levanta el compose de producción en el portátil con un proyecto aparte (`-p omnidesk-sizing`), con volúmenes nuevos y **sin `cloudflared`** (el token es real y reconectaría el túnel de prod). Se leen `docker stats` en reposo y con carga, y el tamaño de las imágenes (`docker image ls`).
  - **Carga:** el simulador (`tools/simulator`, que usa los mismos endpoints de integración que n8n) con credenciales de integración creadas en esa instancia (SPEC 22). Si no es viable con `DEMO_MODE=false`, se mide en reposo en local y la carga se mide en el VPS (paso de verificación).
  - **Medición en el VPS** tras el primer despliegue, en reposo y durante un build de `deploy.sh`, que es el pico de memoria.
  - **Límites en el compose** (`mem_limit` en `postgres`, `api`, `minio` y `gateway`) con valores salidos de la medición, para que un servicio descontrolado no se lleve la RAM de la otra app. Los valores se guardan en `docs/despliegue.md`.
  - **Límite de logs de Docker** en todos los servicios (`json-file`, `max-size: 10m`, `max-file: 3`).
  - **Swap** de 2 GB en el VPS como colchón durante los builds (`docs/despliegue.md`).
  - **Limpieza tras desplegar:** `deploy.sh` elimina la caché de build y las imágenes sin etiqueta antiguas (`docker builder prune -f --filter until=168h` y `docker image prune -f`) al terminar bien. Actúan sobre todo el host: solo borran caché e imágenes huérfanas, nunca contenedores ni volúmenes en uso.
  - **Veredicto:** el spec termina con una conclusión escrita en `docs/despliegue.md`: "cabe en VPS-1" o "necesita VPS-2", con las cifras medidas.
- **Convivir con otras apps** en el mismo VPS (reglas en `docs/despliegue.md`):
  - **Túnel propio por app:** el `cloudflared` de OmniDesk solo sirve a OmniDesk. La otra app usa su propio túnel (token y hostname distintos).
  - **Proyecto Compose y puertos:** OmniDesk conserva `-p omnidesk-prod`, `127.0.0.1:8082` (gateway) y su puerto de MinIO. La otra app usa un proyecto y puertos distintos. Todo se publica solo en `127.0.0.1`.
  - **`autoheal`:** la otra app no debe usar la etiqueta `autoheal=true`, o `autoheal` de OmniDesk le reiniciaría contenedores. El runbook lo exige y el criterio de aceptación lo comprueba en el log de `autoheal`.
  - **Horarios:** backup de OmniDesk a las 03:00 y retención a las 03:30 (hora del servidor). La otra app no programa tareas pesadas a esas horas.
  - **Builds:** se despliega una app a la vez; `deploy.sh` ya construye una imagen cada vez.
  - **Firewall y usuario de despliegue** compartidos: solo SSH entrante.
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
- **Traspaso del túnel:** el `CLOUDFLARE_TUNNEL_TOKEN` es el mismo que usa el prod del portátil. Antes de arrancar el VPS se detiene el prod local (`docker compose -p omnidesk-prod … down`, sin `-v`) para que Cloudflare no reparta tráfico entre dos conectores.
- **Primer despliegue y verificación:** `infra/deploy/deploy.sh prod <tag>` en el VPS con el tag que haya creado el pipeline (el primero será `v0.1.0`), y las comprobaciones de los criterios de aceptación.
- **Documentación:**
  - `docs/despliegue.md`:
    - Sección "OVHcloud + Cloudflare Tunnel (SPEC 25)" con el runbook paso a paso.
    - Cómo ver el último tag (`git fetch --tags && git tag --sort=-v:refname | head`) y la lista de tags en GitHub.
    - Actualizar (§3) y rollback (§4) con el flujo por tag: para volver atrás se despliega el tag anterior.
    - Aclaración de que, con túnel, el fragmento de Nginx (§1.4) y la ruta de `gastromesa.com` no aplican.
    - Tabla de valores del `.env.prod` que cambian para el VPS.
    - Verificación de la URI de redirección de Google y de la URL del webhook de WhatsApp/n8n.
  - README: la línea del despliegue menciona que los tags los crea el pipeline.

**Fuera de alcance (para futuros specs):**

- **Despliegue automático desde GitHub** (SSH al VPS tras el tag). Decisión del usuario: va en otro spec. Aquí el pipeline solo crea el tag y el despliegue sigue siendo manual.
- GitHub Releases y notas de versión.
- Ejecutar el e2e del API en el pipeline.
- Ejecutar el pipeline en pull requests.
- Registro de imágenes: el build sigue ocurriendo en el VPS.
- El entorno **dev** en OVHcloud: solo se despliega prod.
- Migrar datos del Postgres o del MinIO del portátil: la base arranca vacía y el primer usuario crea la empresa.
- Reconfigurar WhatsApp (Meta) y n8n hacia la nueva URL. Se documenta como paso posterior; ningún criterio depende de ello.
- Copia de los backups fuera del VPS (S3 de OVH u otro). Los backups quedan en el mismo disco (riesgo ya aceptado en SPEC 08).
- Despliegue sin caída y varias instancias del API.
- Contratar o ampliar el VPS. Se asume que existe; si la medición dice que no cabe, el cambio de plan lo hace el usuario.
- Desplegar, configurar o medir la **otra app**: aquí solo se fijan las reglas para que conviva.
- Un proxy o balanceador común para varias apps. Cada app tiene su túnel.
- Monitoreo continuo de recursos (SPEC 11 cubre las métricas de la app, no las del host).
- Gestionar `.env.prod` con un gestor de secretos.

## Modelo de datos

Este spec no introduce estructuras de datos. Cambian valores del `.env.prod` de prod y se fija un presupuesto de recursos.

**Presupuesto de recursos.** Referencia del plan mínimo (VPS-1, a confirmar en el configurador de OVHcloud):

| Recurso | VPS-1 | Reservado al SO, Docker y swap | Máximo para OmniDesk | Resto para la otra app |
| --- | --- | --- | --- | --- |
| RAM | 4 GB | 0,5 GB | 2 GB (sumando los 7 servicios en uso normal) | ≥ 1,5 GB |
| CPU | 2 vCores | — | Sin tope; los picos son los builds | — |
| Disco | 40 GB NVMe | 8 GB (SO y Docker) | 20 GB (imágenes, volúmenes, 7 backups y caché de build) | ≥ 12 GB |

Si OmniDesk supera su máximo con carga normal, la conclusión es "necesita VPS-2" (4 vCores, 8 GB, 75 GB según la web de OVHcloud).

**Mediciones en local (2026-10-24).** Stack `omnidesk-prod` en Docker Desktop (VM de 10 CPUs y 7,75 GB), base casi vacía (`pgdata` 50 MB), sin límites de memoria. Son una primera estimación, no sustituyen la medición en el VPS.

| Servicio | Reposo | Pico con carga HTTP | Imagen |
| --- | --- | --- | --- |
| `api` | 133 MiB | 414 MiB (sigue en 414 MiB 30 s después) | 907 MB |
| `minio` | 108 MiB | 110 MiB | 199 MB |
| `postgres` | 37 MiB | 54 MiB | 672 MB |
| `gateway` (Caddy) | 15 MiB | 45 MiB | 91 MB |
| `cloudflared` | 19 MiB | 27 MiB | 104 MB |
| `autoheal` | < 1 MiB | 2 MiB | 14 MB |
| `backup` | < 1 MiB | < 1 MiB | (`postgres:18`, compartida) |
| **Suma** | **313 MiB** | **653 MiB** | **~2 GB** |

- **Carga:** `ab` contra el gateway (`127.0.0.1:8082`), 50 conexiones simultáneas, 0 peticiones fallidas.
  - `GET /omnidesk/api/v1/health`, que consulta la base: ~4.700 peticiones por segundo, p95 de 17 ms. Pico de CPU: `api` 122 %, `gateway` 118 %, `postgres` 54 %.
  - `GET /omnidesk/` (la SPA): ~13.200 peticiones por segundo, p95 de 7 ms.
- **Build en frío** (`build --no-cache` del API y después del gateway, como `deploy.sh`): 44 s + 16 s en 10 CPUs. La memoria usada de la VM de Docker pasó de 1.787 MiB a 2.731 MiB, es decir, **~944 MiB de pico por encima del nivel base**, sin swap. Con el stack ya levantado, OmniDesk durante un build llega a ~1,25 GiB. En un VPS de 2 vCores el build será bastante más lento (no medido).
- **Sin medir:**
  - Carga con mensajes reales: el simulador necesita `DEMO_CHANNEL_API_KEY`, que solo existe con `DEMO_MODE=true`, prohibido con `NODE_ENV=production`. Haría falta crear una empresa y un canal desde la interfaz y usar su credencial de integración (SPEC 22).
  - Crecimiento de `postgres` y MinIO con datos reales.
  - El build en un equipo de 2 vCores.
- **Lectura provisional:** en reposo y con carga HTTP ligera, OmniDesk ocupa 0,3 a 0,65 GB de los 2 GB del presupuesto, y durante un build ~1,25 GB. Con estos datos cabría en VPS-1. El veredicto definitivo se cierra con la medición en el VPS (criterios de "Dimensionamiento").
- **Propuesta inicial de límites** (`mem_limit`), a validar en el VPS: `api` 768 MiB, `postgres` 512 MiB, `minio` 384 MiB, `gateway` 128 MiB. El `api` conserva 414 MiB tras la carga, así que su límite no puede ajustarse a la cifra de reposo.

Valores del `.env.prod` de prod:

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

Archivo nuevo en el repo:

```text
.github/workflows/release.yml    verify + migrations + tag (solo push a main)
```

Regla de versionado: `vMAYOR.MENOR.PARCHE`. El pipeline incrementa el parche del tag más alto. Ejemplo: `v0.1.0` → `v0.1.1` → `v0.1.2`; tras un `v0.2.0` manual, el siguiente es `v0.2.1`.

## Plan de implementación

1. **Pipeline.** Crear `.github/workflows/release.yml` con los jobs `verify`, `migrations` y `tag`. Probar en una rama: el push a una rama no debe ejecutar el workflow. Probar el cálculo del siguiente tag con un script de shell contra tags de prueba (sin tags → `v0.1.0`; con `v0.1.9` → `v0.1.10`; con `v0.1.2` y `v0.2.0` → `v0.2.1`; el orden es por versión, no alfabético). Comprobar que el job `migrations` falla si se introduce una migración rota y si se cambia `schema.prisma` sin migración.
2. **Cambios en `deploy.sh`.** Tag `vX.Y.Z` contenido en `origin/main` en prod; claves duplicadas, `BACKUP_DIR` existente y `CORS_ORIGINS` sin `localhost` en prod. Comprobación con `bash -n` y ensayo local con un `.env` de prueba que provoque cada fallo, y con `deploy.sh prod main` y un tag creado en otra rama para ver el rechazo.
3. **Documentación.** Sección de OVHcloud y Cloudflare en `docs/despliegue.md`, con la tabla de valores y el runbook; §3 y §4 por tag; aclaración sobre Nginx; README.
4. **Corregir el `.env.prod`** local según la tabla. Comprobar sin arrancar nada: `docker compose -p omnidesk-prod --env-file .env.prod -f infra/deploy/docker-compose.prod.yml config` termina con código 0 y no hay claves duplicadas.
5. **Medir OmniDesk en local.** _(Primera pasada hecha el 2026-10-24 sobre el stack `omnidesk-prod` en marcha: reposo, carga HTTP y build en frío, ver "Modelo de datos". Queda la carga con mensajes reales.)_ Levantar `-p omnidesk-sizing` sin `cloudflared` y con volúmenes nuevos; anotar `docker stats` en reposo y con carga, y el tamaño de las imágenes. Comparar con el presupuesto y escribir el veredicto provisional ("cabe" o "no cabe en VPS-1") en `docs/despliegue.md`. Bajar el proyecto con `down -v` al terminar: solo borra los volúmenes de `omnidesk-sizing`.
6. **Límites del compose.** Añadir `mem_limit` a `postgres`, `api`, `minio` y `gateway`, con los valores medidos más margen, y el límite de logs de Docker a todos los servicios. Añadir la limpieza de caché e imágenes huérfanas al final de `deploy.sh`. Comprobar con `docker compose … config` y levantando de nuevo `omnidesk-sizing`: los servicios arrancan sanos con esos límites y el API no muere por falta de memoria con carga.
7. **Reglas de convivencia.** Documentar en `docs/despliegue.md` el túnel propio, los puertos, `autoheal`, los horarios y los builds; y la sección de swap.
8. **Fusionar en `main`.** Al llegar los pasos 1 a 3, 6 y 7 a `origin/main`, el pipeline corre solo y, si pasa, crea el primer tag (`v0.1.0`). Antes de desplegar, confirmar en GitHub que el workflow terminó en verde y que el tag existe.
9. **Preparar el VPS.** Docker, usuario, carpetas, firewall, NTP, swap de 2 GB, deploy key y clon.
10. **Copiar el `.env.prod`** al VPS con `scp` y `chmod 600`.
11. **Backup y parada del prod local.** Backup manual del portátil por si acaso y `down` (sin `-v`) del proyecto `omnidesk-prod` local.
12. **Desplegar.** `infra/deploy/deploy.sh prod v0.1.0` en el VPS (o el tag que haya creado el pipeline).
13. **Verificar** los criterios de aceptación, incluida la medición en el VPS en reposo y durante un segundo `deploy.sh` (el pico del build). Lo que falle se corrige en el repo o en la guía, no a mano en el servidor.

## Criterios de aceptación

**Pipeline**

- [ ] Un push a `main` con lint, typecheck, test, build y migraciones en verde termina con un tag `vX.Y.Z` nuevo en `origin`, sobre ese commit, creado por `github-actions`.
- [ ] El primer tag, con el repo sin tags, es `v0.1.0`. Los siguientes suben el parche (`v0.1.1`, …).
- [ ] Dos tags `v0.1.9` y `v0.1.10` existentes producen `v0.1.11` (orden por versión).
- [ ] Un push a una rama que no es `main` no ejecuta el workflow ni crea tags.
- [ ] Si falla `lint`, `typecheck`, `test` o `build`, el commit no recibe tag.
- [ ] El job `migrations` aplica todas las migraciones sobre una base vacía con un superusuario, y `db:app-role` termina con código 0.
- [ ] Un cambio en `schema.prisma` sin migración correspondiente hace fallar el job `migrations`, y no hay tag.
- [ ] Una migración con error de SQL hace fallar el job `migrations`, y no hay tag.
- [ ] Dos pushes seguidos a `main` no producen el mismo tag ni un error por tag duplicado.

**Antes del despliegue**

- [ ] `.env.prod` no tiene claves duplicadas (`grep -E '^[A-Z_]+=' .env.prod | cut -d= -f1 | sort | uniq -d` no imprime nada).
- [ ] `docker compose -p omnidesk-prod --env-file .env.prod -f infra/deploy/docker-compose.prod.yml config` termina con código 0.
- [ ] `deploy.sh prod <tag>` falla con un mensaje claro si hay una clave duplicada, si `BACKUP_DIR` no existe o si `CORS_ORIGINS` contiene `localhost`.
- [ ] `deploy.sh prod main`, `deploy.sh prod <otra-rama>` y `deploy.sh prod <commit>` terminan con código distinto de 0 y dicen que prod solo se despliega desde un tag `vX.Y.Z`.
- [ ] `deploy.sh prod <tag>` para un tag que no está contenido en `origin/main` termina con código distinto de 0 y lo dice.
- [ ] `deploy.sh dev <cualquier ref>` sigue funcionando como antes.
- [ ] Los cambios de este spec están en `origin/main` y existe el tag que creó el pipeline.

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

**Dimensionamiento**

- [ ] `docs/despliegue.md` tiene una tabla con la RAM en reposo y con carga de cada servicio de OmniDesk, medida con `docker stats`, y el tamaño de las imágenes, tomados en local (paso 5) y repetidos en el VPS.
- [ ] La suma de la memoria de los siete servicios, medida en el VPS en reposo, es ≤ 2 GB.
- [ ] Durante un `deploy.sh` (build del API y del gateway), `free -m` en el VPS muestra memoria disponible (RAM + swap) > 0 en todo momento y el proceso de build termina sin que el kernel mate ningún contenedor (`dmesg | grep -i 'out of memory'` vacío).
- [ ] `docker compose … config` muestra `mem_limit` en `postgres`, `api`, `minio` y `gateway`, y todos los servicios arrancan sanos con esos límites.
- [ ] `docker inspect` de cada servicio muestra `max-size: 10m` y `max-file: 3` en sus logs.
- [ ] Con 7 backups acumulados, `df -h /` en el VPS marca ≤ 60 % de uso, y `docker system df` tras un despliegue no crece entre despliegues consecutivos por caché de build.
- [ ] `docs/despliegue.md` termina con el veredicto escrito: "cabe en VPS-1" o "necesita VPS-2", con las cifras que lo sustentan.

**Convivencia**

- [ ] Un contenedor de prueba con la etiqueta `autoheal=true` fuera del proyecto `omnidesk-prod` no existe en el VPS, y el log de `omnidesk-prod-autoheal` solo menciona contenedores de `omnidesk-prod`.
- [ ] `docs/despliegue.md` documenta que la otra app usa su propio túnel de Cloudflare y lista los puertos y proyecto de OmniDesk (`omnidesk-prod`, `127.0.0.1:8082`, MinIO).
- [ ] Levantar un segundo proyecto Compose de prueba (un `nginx` sencillo con otro puerto y su propio túnel o sin túnel) en el mismo VPS no cambia el estado `healthy` de los servicios de OmniDesk ni su respuesta en `/health`.

**Rollback** (se verifica con el siguiente push a `main`, cuando existe un segundo tag)

- [ ] Con `v0.1.0` y `v0.1.1` creados, desplegar `v0.1.1` y después `deploy.sh prod v0.1.0` deja `/health` respondiendo `version: v0.1.0` y la app funcionando.

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
- **Sí:** prod se despliega por tag `vX.Y.Z` y los tags los crea un pipeline de GitHub sobre `main`. Decisión del usuario. Cada versión es un punto fijo identificable y se puede volver a cualquier tag anterior.
- **No:** `deploy.sh prod main`. Fue la primera propuesta de este spec, pero desplegar la punta de `main` no deja versión estable ni rollback por nombre.
- **Sí:** el tag debe estar contenido en `origin/main`. Evita desplegar un tag creado a mano sobre una rama sin revisar.
- **Sí:** versión por parche incremental automático (`v0.1.N`). Decisión del usuario. No depende del formato de los commits; el menor y el mayor se suben a mano creando el tag.
- **No:** versionado por Conventional Commits (release-please o semantic-release). Un commit mal escrito daría una versión equivocada o ninguna.
- **Sí:** el pipeline comprueba lint, typecheck, test y build, y además que todas las migraciones se aplican en una base vacía y que no hay deriva del schema. Decisión del usuario: solo un `main` verde recibe tag, y una migración rota no llega a un VPS donde `prisma migrate deploy` bloquearía el arranque del API.
- **No:** el e2e del API en el pipeline. Necesita el stack completo; queda para otro spec.
- **Sí:** el pipeline solo crea el tag; el despliegue sigue manual con `deploy.sh`. Decisión del usuario: el despliegue automático desde GitHub va en otro spec, y así no hay que guardar una clave SSH del VPS en GitHub.
- **Sí:** el despliegue sigue construyendo en el VPS. Es lo que fijó SPEC 08. Si el pico del build no cabe, la alternativa documentada es construir en el portátil y copiar las imágenes con `docker save`/`load`.
- **Sí:** el VPS se comparte con otra app (la del restaurante). Decisión del usuario. OmniDesk deja de asumir que está solo en el host.
- **Sí:** medir antes de decidir el plan. No hay datos de consumo de OmniDesk, y las cifras iniciales son hipótesis. La medición local va primero porque no cuesta nada y no depende del VPS.
- **Sí:** la medición local usa un proyecto aparte y sin `cloudflared`. Con el token real, un segundo conector del túnel de prod repartiría tráfico entre el portátil y el VPS.
- **Sí:** presupuesto de 2 GB de RAM y 20 GB de disco para OmniDesk en VPS-1. Deja al menos 1,5 GB y 12 GB a la otra app. Es un criterio de decisión: si se supera, el veredicto es VPS-2.
- **Sí:** `mem_limit` en los servicios grandes y límite de logs. Sin límites, un servicio fuera de control o los logs sin rotar pueden dejar sin memoria o disco a la otra app.
- **No:** `mem_limit` en `cloudflared`, `autoheal` y `backup`. Consumen poco y un límite justo podría matarlos en el pico del backup.
- **Sí:** swap de 2 GB como colchón del build. Es un seguro, no una forma de que quepa: si el kernel usa el swap de forma sostenida, el veredicto es VPS-2.
- **Sí:** un túnel de Cloudflare por app. El `cloudflared` de OmniDesk comparte la red de su gateway y no puede servir a otra app; compartir el túnel exigiría rediseñar SPEC 19.
- **No:** un proxy común (Caddy o Nginx) delante de todas las apps. Es más superficie y otro spec; el túnel por app ya aísla.
- **Sí:** la otra app no usa la etiqueta `autoheal=true`. Cambiar la etiqueta de OmniDesk tocaría SPEC 19; la regla en el runbook es más barata.
- **Sí:** limpieza de caché e imágenes huérfanas tras cada despliegue. En local la caché de build ya ocupa 16 GB; en un disco de 40 GB llenaría el VPS en pocos despliegues.
- **Sí:** WhatsApp y n8n se reconfiguran después. Dependen de que la URL pública ya responda y no bloquean la app.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El portátil y el VPS conectados al mismo túnel a la vez | Paso 11: parar el prod local antes del despliegue. Criterio: una sola conexión en Cloudflare. La medición local (paso 5) no levanta `cloudflared`. |
| OmniDesk no cabe en VPS-1 (4 GB) junto a la otra app | La medición lo dice antes de desplegar. Veredicto "necesita VPS-2" y cambio de plan por el usuario; no se despliega a ciegas. |
| El pico del build (`pnpm install`, `tsc`, `vite build`) agota la RAM y el kernel mata un contenedor de cualquiera de las apps | Swap de 2 GB, build de una imagen a la vez y `mem_limit` en los servicios. Alternativa: construir en el portátil y copiar con `docker save`/`load`. Un criterio comprueba que no hay OOM durante el build. |
| La medición local no representa al VPS (el Mac usa Docker Desktop, que corre en una VM con su propio reparto de memoria) | Las cifras locales son una primera estimación; los criterios de dimensionamiento se repiten en el VPS. |
| El simulador no sirve para generar carga con `DEMO_MODE=false` | Se mide en reposo en local y la carga en el VPS. El criterio de RAM total se evalúa en el VPS. |
| Los `mem_limit` quedan demasiado justos y el kernel mata un servicio con un pico real | Valores con margen sobre la medición con carga; el criterio exige que todos arranquen sanos con ellos. Se ajustan en el repo, no en el servidor. |
| La limpieza con `docker builder prune` y `image prune` borra caché de la otra app | Solo afecta a caché e imágenes sin uso, que se reconstruyen. Se documenta en el runbook. |
| La otra app usa la etiqueta `autoheal=true` y `autoheal` de OmniDesk le reinicia contenedores | Regla en el runbook y criterio que revisa el log de `autoheal`. |
| Dos apps a la vez en el VPS compiten por CPU en el backup (03:00) o la retención (03:30) | Regla de horarios en el runbook. |
| El disco de 40 GB se llena (imágenes, caché de build, backups, MinIO, logs) | Presupuesto de 20 GB, limpieza tras desplegar, rotación de logs y criterio de `df` ≤ 60 %. |
| `CHANNEL_SECRETS_KEY` o `DATABASE_APP_PASSWORD` distintos de los del portátil | La base es nueva, así que no hay secretos cifrados que perder. Se guarda una copia de la clave fuera del VPS (SPEC 09). |
| El build en el VPS agota RAM o CPU | `deploy.sh` construye una imagen a la vez. Si falla, la alternativa `docker save`/`load` de `docs/despliegue.md` §3. |
| Pérdida del VPS y de sus backups (mismo disco) | Riesgo aceptado en SPEC 08. Copias externas quedan para otro spec. |
| El pipeline falla y `main` queda sin tag | Es lo esperado: ese commit no se despliega. Se corrige en `main` y el siguiente push que pase recibe el tag. |
| El repo no deja a `GITHUB_TOKEN` escribir tags | El workflow declara `permissions: contents: write` en el job `tag`. Si la organización lo restringe, hay que habilitarlo en Settings → Actions → Workflow permissions. Un criterio lo comprueba con el primer push. |
| Los tags creados por el pipeline no disparan otros workflows (comportamiento de `GITHUB_TOKEN`) | No hay otros workflows que dependan del tag. El despliegue automático (otro spec) tendrá que resolverlo. |
| La migración pasa en base vacía pero falla con los datos de prod | El pipeline no cubre datos existentes. Backup manual antes de cada despliegue a prod; la primera vez la base está vacía. |
| Una migración no es compatible hacia atrás y el rollback deja la app rota | Las migraciones solo avanzan: tras desplegar un tag anterior hay que restaurar el backup previo (`docs/despliegue.md` §5). |
| Dos pushes seguidos calculan el mismo número de tag | Grupo de concurrencia sin cancelación y comprobación de que el commit no tenga ya un tag. Criterio de aceptación. |
| Los minutos de GitHub Actions se agotan en un repo privado | Se ejecuta solo en push a `main`, sin PRs, para gastar lo mínimo. |
| `prisma migrate diff` cambia de flags entre versiones de Prisma | Se confirman contra la versión instalada y el ensayo del paso 1 prueba que el job detecta una deriva real. |
| Google rechaza el login (`redirect_uri_mismatch`) | Se verifica la URI en la credencial antes de desplegar. |
| El puerto de MinIO o el gateway quedan expuestos por una regla del firewall de OVH | Criterio de aceptación con comprobación desde fuera. |
| `METRICS_TOKEN` falta en el `.env.prod` | Revisado en el paso 4 contra `env.ts`: es opcional, y sin él `GET /api/v1/metrics` no existe (no queda sin proteger). Se deja sin definir hasta que haga falta un monitor externo. |

## Lo que **no** entra en este spec

- Despliegue automático desde GitHub.
- Desplegar o medir la otra app; un proxy común para varias apps.
- Monitoreo continuo de recursos del host.
- GitHub Releases y notas de versión.
- E2E del API y pipeline en pull requests.
- Entorno dev en OVHcloud.
- Migración de datos locales.
- Reconfiguración de WhatsApp/Meta y n8n.
- Backups fuera del VPS.
- Blue/green y varias instancias del API.
- Contratación o dimensionado del VPS.

Cada uno de esos, si llega, va en su propio spec.
