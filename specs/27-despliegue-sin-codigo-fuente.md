# SPEC 27 — Despliegue de prod sin código fuente en el VPS

> **Status:** Approved
> **Depends on:** SPEC 25, SPEC 26
> **Date:** 2026-10-24
> **Objective:** El VPS de OVHcloud despliega prod sin clon del repo: un script fijo descarga de `ghcr.io` un bundle con los archivos de despliegue de cada tag y las imágenes de esa versión, y el clon y la deploy key se retiran del servidor.

## Por qué existe este spec

Desde SPEC 26, prod no compila en el VPS: descarga las imágenes `omnidesk-api` y `omnidesk-gateway` de `ghcr.io`. Aun así el VPS conserva un clon completo del repo en `/srv/omnidesk/repo`, por tres motivos:

- **Archivos de despliegue:** `infra/deploy/deploy.sh`, `infra/deploy/docker-compose.prod.yml` e `infra/deploy/backup.sh`, que el servicio `backup` monta (`./backup.sh:/usr/local/bin/omnidesk-backup.sh`).
- **Git en `deploy.sh`:** `git fetch`, `checkout` del tag, la comprobación de que el tag está en `origin/main` y el cálculo de `APP_VERSION`.
- **Dev:** `deploy.sh dev <ref>` compila en el VPS con `build: context: ../..`.

El usuario quiere que en el VPS no haya código fuente: solo las imágenes y lo necesario para desplegarlas. Eso reduce lo que se expone si el servidor se compromete, quita la deploy key de GitHub y deja un único artefacto versionado por tag.

Lo que ya fijaron otros specs y aquí no se reabre:

- Los tags `vX.Y.Z` los crea `release.yml` solo sobre commits verdes de `main` (SPEC 25), y el job `images` publica sus imágenes como paquetes privados inmutables con retención de 10 versiones (SPEC 26).
- El token clásico `read:packages` y `docker login ghcr.io` en el VPS (SPEC 26).
- Topología con Cloudflare Tunnel, `.env.prod` en `/srv/omnidesk/.env.prod`, backups en `/srv/omnidesk/backups/prod`, límites de memoria y de logs (SPEC 25).
- Validaciones del `.env.prod` en `deploy.sh`: claves duplicadas, `BACKUP_DIR`, `localhost` en `CORS_ORIGINS`, `BASE_PATH` y `VITE_API_URL` (SPEC 25 y 26).

## Alcance

**Dentro:**

- **Imagen bundle `ghcr.io/inerhead/omnidesk-deploy:vX.Y.Z`**, publicada por el job `images` de `release.yml` junto a las otras dos, con las mismas reglas: privada, `linux/amd64`, etiqueta OCI `source`, inmutable y con retención de 10 versiones en `prune`.
  - Se construye con `infra/deploy/Dockerfile.bundle`, `FROM scratch`. Solo contiene archivos, en `/bundle/`:
    - `deploy.sh`
    - `docker-compose.prod.yml`
    - `backup.sh`
    - `.env.prod.example`
    - `omnidesk-deploy` (el script fijo del VPS, para instalarlo o actualizarlo)
    - `VERSION`, con el tag.
  - No contiene código de la aplicación ni nada de `apps/` o `packages/`.
- **Script fijo `omnidesk-deploy`** (en el repo: `infra/deploy/omnidesk-deploy`; en el VPS: `/srv/omnidesk/bin/omnidesk-deploy`):
  - Uso: `omnidesk-deploy vX.Y.Z`. Solo prod; rechaza cualquier ref que no sea `vX.Y.Z`.
  - Descarga el bundle del tag (`docker pull`) y lo extrae con `docker create` + `docker cp` en `/srv/omnidesk/releases/vX.Y.Z/`. Si esa carpeta ya existe y su `VERSION` coincide, la reutiliza.
  - Ejecuta `/srv/omnidesk/releases/vX.Y.Z/deploy.sh vX.Y.Z`. Cada versión se despliega con su propio compose y su propio `deploy.sh`.
  - Si no hay sesión en `ghcr.io` o el bundle no existe, falla con el mismo tipo de mensaje que SPEC 26 (login o «espera al job `images`»).
  - Si el `omnidesk-deploy` del bundle es distinto del instalado, avisa al terminar con el comando para actualizarlo. No se reemplaza solo.
  - Conserva las 5 carpetas de `releases/` más recientes y borra las demás (solo son archivos de texto; las imágenes se limpian aparte).
- **`deploy.sh`, solo prod y sin git:**
  - Uso: `deploy.sh vX.Y.Z`. Desaparece el argumento `<dev|prod>` y la rama de dev.
  - Elimina `git status`, `git fetch`, `checkout`, la comprobación de `origin/main` y el cálculo de `APP_VERSION` con git: `APP_VERSION` es el tag.
  - Se ejecuta desde su carpeta de release: el compose y `backup.sh` son los de esa carpeta.
  - Conserva todo lo demás: validaciones del `.env.prod`, `pull` de `api` y `gateway`, `up -d --no-build`, espera del healthcheck, comprobación de versión y las limpiezas de SPEC 25 y 26.
- **`docker-compose.prod.yml` sin `build:`**: `api` y `gateway` solo tienen `image:`. Sin código en el VPS no hay contexto de build. `OMNIDESK_IMAGE_TAG` pasa a ser obligatoria (`${OMNIDESK_IMAGE_TAG:?…}`).
- **Garantía «solo tags de `main`»**: pasa del VPS al pipeline. Solo `release.yml` publica imágenes y bundles, y solo corre en push a `main`, así que un tag con bundle viene siempre de `main`. Un tag puesto a mano (por ejemplo, `v0.2.0` para subir el menor) no tiene bundle ni imágenes y no se despliega; el siguiente push a `main` publica `v0.2.1`.
- **Dev sale del VPS**: el VPS solo aloja prod. Dev se trabaja en local con `docker-compose.yml`. `.env.dev.example` deja de usarse en el VPS (se conserva en el repo solo si algo local lo usa; si no, se elimina).
- **Migración del VPS actual** (pasos documentados y verificados):
  1. Instalar `omnidesk-deploy` desde el bundle del primer tag publicado con este spec.
  2. Desplegar ese tag con `omnidesk-deploy`. Compose reconoce el proyecto `omnidesk-prod` y recrea los contenedores; los volúmenes `pgdata` y `miniodata` se conservan.
  3. Borrar `/srv/omnidesk/repo`.
  4. Quitar la deploy key en GitHub (Settings → Deploy keys) y en el VPS (`~/.ssh/omnidesk_deploy*` y su bloque de `~/.ssh/config`).
  5. Comprobar que no queda código ni credenciales de git en el servidor.
- **Documentación** (`docs/despliegue.md` y README):
  - Runbook de OVHcloud sin clon: prepara el VPS, inicia sesión en `ghcr.io`, instala `omnidesk-deploy`, copia el `.env.prod` y despliega.
  - Actualizar, rollback y la sección de migración.
  - Quitar de la guía de prod los pasos de git y de deploy key.
  - Marcar como retirados los pasos de dev en el VPS de SPEC 08.
  - Explicar cómo ver el bundle en GitHub, igual que las otras imágenes.

**Fuera de alcance (para futuros specs):**

- Imágenes o despliegue de dev en algún servidor.
- Actualización automática de `omnidesk-deploy`.
- Despliegue automático desde GitHub (SSH o webhook).
- Firma o verificación de bundles e imágenes.
- Fijar imágenes por digest en lugar de etiqueta.
- Gestor de secretos para el `.env.prod`.
- Desplegar tags puestos a mano.

## Modelo de datos

Este spec no introduce estructuras de datos de la aplicación. Cambia artefactos y la disposición del VPS.

**Paquetes en `ghcr.io`** (todos privados, enlazados al repo, una etiqueta `vX.Y.Z`, retención de 10):

| Paquete | Contenido |
| --- | --- |
| `omnidesk-api` | API (SPEC 26) |
| `omnidesk-gateway` | Caddy + web (SPEC 26) |
| `omnidesk-deploy` | **Nuevo.** Solo archivos en `/bundle/` |

**Contenido del bundle:**

```text
/bundle/
├── VERSION                  # vX.Y.Z
├── deploy.sh
├── docker-compose.prod.yml
├── backup.sh
├── .env.prod.example
└── omnidesk-deploy
```

**Disposición del VPS:**

```text
/srv/omnidesk/
├── bin/omnidesk-deploy          # instalado una vez desde un bundle
├── .env.prod                    # chmod 600 (SPEC 25)
├── backups/prod/                # SPEC 25
└── releases/
    ├── v0.1.3/                  # bundle extraído (las 5 más recientes)
    └── v0.1.4/
```

Sin `/srv/omnidesk/repo` y sin `~/.ssh/omnidesk_deploy`.

**Variables:** `OMNIDESK_IMAGE_TAG` y `APP_VERSION` las fija `deploy.sh` a partir del tag; no van en el `.env.prod`.

## Plan de implementación

1. **Bundle.** Crear `infra/deploy/Dockerfile.bundle` (`FROM scratch`, copia a `/bundle/` y escribe `VERSION`). Probar en local: construir con un tag de prueba, extraer con `docker create` + `docker cp` y comprobar que contiene exactamente los 6 archivos y nada de `apps/` ni `packages/`.
2. **Pipeline.** Añadir `omnidesk-deploy` al job `images` (comprobación de existencia, build, push, resumen) y al job `prune`. Validar el YAML y probar la lógica de existencia como en SPEC 26.
3. **Compose.** Quitar `build:` de `api` y `gateway`, y hacer obligatoria `OMNIDESK_IMAGE_TAG`. Comprobar `compose config` con y sin la variable.
4. **`deploy.sh` sin git y solo prod.** Nueva firma `deploy.sh vX.Y.Z`. Probar con un `docker` simulado, desde una carpeta sin `.git`: despliegue correcto, ref inválido, validaciones del `.env` y fallo de `pull`.
5. **`omnidesk-deploy`.** Script fijo con descarga y extracción del bundle, reutilización de carpeta, aviso de versión distinta del script y retención de 5 releases. Probar con `docker` simulado: bundle presente, inexistente, sin sesión, carpeta ya extraída y poda de releases.
6. **Documentación.** Runbook sin clon, actualizar, rollback, migración, ver el bundle en GitHub, retirada de dev en el VPS y README.
7. **Fusionar en `main`.** El pipeline publica el tag con sus tres paquetes. Dar el rol Admin al repo en el paquete nuevo `omnidesk-deploy` (como en SPEC 26).
8. **Migrar el VPS** siguiendo la guía: instalar `omnidesk-deploy`, desplegar, borrar el clon, retirar la deploy key y verificar.

## Criterios de aceptación

**Bundle y pipeline**

- [ ] Un push verde a `main` publica `omnidesk-api`, `omnidesk-gateway` y `omnidesk-deploy` con el mismo tag `vX.Y.Z`.
- [ ] El bundle extraído contiene exactamente `VERSION`, `deploy.sh`, `docker-compose.prod.yml`, `backup.sh`, `.env.prod.example` y `omnidesk-deploy`, y `VERSION` coincide con el tag.
- [ ] El bundle no contiene ningún archivo de `apps/`, `packages/` ni `tools/`.
- [ ] El paquete `omnidesk-deploy` es privado, está enlazado al repo y aparece en **Packages**.
- [ ] Volver a ejecutar el workflow sobre un tag ya publicado no cambia el digest del bundle.
- [ ] `prune` aplica la retención de 10 versiones también a `omnidesk-deploy`.

**Despliegue**

- [ ] `omnidesk-deploy vX.Y.Z` en el VPS extrae el bundle en `/srv/omnidesk/releases/vX.Y.Z/`, ejecuta su `deploy.sh` y termina con `✅ omnidesk-prod desplegado: vX.Y.Z`.
- [ ] `/api/v1/health` responde `version: vX.Y.Z`.
- [ ] `omnidesk-deploy main`, `omnidesk-deploy <commit>` y `omnidesk-deploy dev` fallan sin descargar nada.
- [ ] `omnidesk-deploy <tag sin bundle>` (por ejemplo, `v0.1.1` o un tag puesto a mano) falla con un mensaje que nombra el bundle que falta.
- [ ] Sin sesión en `ghcr.io`, `omnidesk-deploy` falla con el comando de `docker login`.
- [ ] `deploy.sh` no ejecuta ningún comando `git` ni `docker compose build` (comprobado con el `docker` simulado y con `grep` en el script).
- [ ] Desplegar un tag anterior con bundle (`omnidesk-deploy <tag anterior>`) usa el compose de esa versión y deja `/health` con esa versión.
- [ ] Tras varios despliegues, `/srv/omnidesk/releases/` contiene como mucho 5 carpetas.
- [ ] Si el `omnidesk-deploy` del bundle es distinto del instalado, el despliegue termina avisando con el comando para actualizarlo.
- [ ] El servicio `backup` arranca con el `backup.sh` de la carpeta de release y un `backup now` deja un dump en `/srv/omnidesk/backups/prod/`.

**Migración del VPS**

- [ ] Tras migrar, los datos siguen ahí: una empresa y una conversación creadas antes del cambio existen después.
- [ ] `/srv/omnidesk/repo` no existe y `find /srv/omnidesk -name '*.ts' -o -name '.git'` no devuelve nada.
- [ ] La deploy key ya no aparece en GitHub (Settings → Deploy keys), y `~/.ssh/omnidesk_deploy*` no existe en el VPS.
- [ ] `docker compose -p omnidesk-prod … ps` muestra los 7 servicios sanos tras la migración.

**Documentación y calidad**

- [ ] `docs/despliegue.md` describe el despliegue de prod sin ningún paso de git, clon ni deploy key, e incluye la migración y cómo ver el bundle en GitHub.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0.

## Decisiones

- **Sí:** el VPS no tiene código fuente. Decisión del usuario. Si el servidor se compromete, no expone el código ni una credencial de git, y lo que hay es exactamente lo que se despliega.
- **Sí:** bundle como imagen `omnidesk-deploy` en `ghcr.io`. Decisión del usuario. Usa el mismo token `read:packages`, la misma inmutabilidad y la misma retención que las imágenes; no hace falta otra credencial.
- **No:** adjunto de GitHub Release. En un repo privado, descargarlo exige un token con lectura del repo, más permisos que `read:packages`.
- **No:** copiar los archivos con `scp` en cada despliegue. Depende de copiar a mano la versión correcta.
- **Sí:** `FROM scratch` y extracción con `docker create` + `docker cp`. Es la imagen más pequeña posible y no ejecuta nada en el VPS.
- **Sí:** script fijo `omnidesk-deploy` que baja el bundle del tag y ejecuta su `deploy.sh`. Decisión del usuario. Cada versión se despliega con su propio compose, así que un rollback usa los archivos de esa versión.
- **No:** un único directorio sobrescrito. El rollback perdería la copia anterior de los archivos.
- **Sí:** `omnidesk-deploy` no se actualiza solo; avisa. Un script que se reemplaza mientras se ejecuta es frágil, y este cambia poco.
- **Sí:** se conservan 5 carpetas en `releases/`. Son archivos pequeños y cubren los rollbacks habituales; la imagen de un tag más viejo se vuelve a descargar con su bundle.
- **Sí:** dev sale del VPS. Decisión del usuario. Desplegar cualquier ref exige compilar, y compilar exige código. Ya era así en SPEC 25, que solo despliega prod.
- **No:** dev también por imágenes. Exigiría publicar imágenes de `main` o de ramas; otro spec.
- **Sí:** el compose de prod no tiene `build:`. Sin código no hay contexto de build, y quitarlo evita que alguien compile por error.
- **Sí:** la comprobación «tag en `main`» la garantiza el pipeline. Solo `release.yml` publica bundles e imágenes, y solo en push a `main`; sin bundle no hay despliegue.
- **Sí:** se incluye la migración del VPS actual, con borrado del clon y revocación de la deploy key. Decisión del usuario. Sin ella, el código seguiría en el servidor.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La migración borra el clon antes de comprobar que el despliegue nuevo funciona | Orden fijo: desplegar con `omnidesk-deploy`, verificar `/health` y los datos, y solo después borrar el clon y la deploy key. |
| Compose no reconoce los contenedores existentes porque cambia la ruta del compose | El nombre de proyecto `omnidesk-prod` se mantiene, y Compose agrupa por proyecto, no por ruta. Los volúmenes se llaman `omnidesk-prod_*` y se conservan. Hay un criterio que comprueba los datos. |
| El bundle y las imágenes de un tag quedan desalineados (uno publicado y otro no) | Los tres se publican en el mismo job. `omnidesk-deploy` falla si falta el bundle y `deploy.sh` si faltan las imágenes. |
| `omnidesk-deploy` instalado queda viejo y no entiende un bundle nuevo | El script compara su copia con la del bundle y avisa. El formato del bundle (carpeta `/bundle/` y `deploy.sh vX.Y.Z`) se trata como contrato: cambiarlo exige actualizar el script. |
| Sin clon, no hay forma rápida de inspeccionar el código desplegado en el VPS | Es el objetivo. El código de cada tag está en GitHub; el VPS solo tiene lo que ejecuta. |
| La retención (10 versiones en `ghcr.io`, 5 carpetas locales) impide volver a una versión muy antigua | Se documenta. Si hace falta más historial, se suben los números. |
| El paquete nuevo `omnidesk-deploy` no tiene el rol Admin del repo y `prune` no lo poda | Igual que en SPEC 26: el job avisa sin tumbar el release, y el paso 7 da el rol. |
| Un tag puesto a mano para subir el menor no se puede desplegar | Se documenta: el siguiente push a `main` publica el parche siguiente (`v0.2.1`). |
| Quedan restos de git o credenciales en el VPS | Criterios de aceptación con `find` y la comprobación de la deploy key. |

## Lo que **no** entra en este spec

- Dev en algún servidor, o imágenes de dev.
- Actualización automática de `omnidesk-deploy`.
- Despliegue automático desde GitHub.
- Firma de bundles e imágenes, y fijar imágenes por digest.
- Gestor de secretos.
- Desplegar tags puestos a mano.

Cada uno de esos, si llega, va en su propio spec.
