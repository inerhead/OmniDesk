# SPEC 26 — Imágenes de producción en GitHub Container Registry

> **Status:** Approved
> **Depends on:** SPEC 08, SPEC 25
> **Date:** 2026-10-24
> **Objective:** El pipeline de GitHub construye las imágenes `api` y `gateway` de cada tag `vX.Y.Z`, las publica en `ghcr.io` como paquetes privados, `deploy.sh` las descarga en prod en lugar de compilarlas en el VPS, y la guía explica cómo verlas en GitHub.

## Por qué existe este spec

Hoy `deploy.sh prod <tag>` construye las dos imágenes **dentro del VPS** (SPEC 08 y SPEC 25). Eso tiene tres costes medidos o documentados:

- **Memoria:** el build en frío subió ~944 MiB la memoria usada en el equipo de pruebas (SPEC 25). En el VPS mínimo de OVHcloud (4 GB, compartido con otra app) es el mayor riesgo, y obligó a añadir swap.
- **Tiempo y CPU:** 2 vCores compilan `pnpm install`, `tsc` y `vite build` mucho más despacio que un runner de GitHub, y compiten con el resto del servidor.
- **Disco:** la caché de build crece en cada despliegue (SPEC 25 añadió una limpieza para evitarlo).

Las imágenes se construyen mejor una vez, en el pipeline, y el VPS solo las descarga.

**¿Es gratis?** Hoy sí. La [documentación oficial de GitHub Packages](https://docs.github.com/en/billing/concepts/product-billing/github-packages) dice que «el almacenamiento y el ancho de banda de imágenes del Container registry son actualmente gratuitos» y que avisarán con al menos un mes de antelación de cualquier cambio. Matices a tener en cuenta:

- Es una política vigente, no una garantía permanente.
- La misma página lista cuotas por plan para paquetes privados (Free: 500 MB de almacenamiento y 1 GB de transferencia al mes) y no aclara si la exención del registro de contenedores las anula. Una imagen del API pesa ~900 MB, así que si esas cuotas se aplicaran, se agotarían rápido.
- Los paquetes públicos son gratis sin límite. Aquí se eligieron privados (ver Decisiones).
- La descarga desde un runner de Actions con `GITHUB_TOKEN` es gratuita; la del VPS usa un token personal.

Este spec no depende de la gratuidad: incluye retención de versiones y un criterio para vigilar el uso.

Lo que ya fijaron otros specs y aquí no se reabre:

- Los tags `vX.Y.Z` los crea `.github/workflows/release.yml` sobre commits verdes de `main`, y prod solo despliega un tag contenido en `origin/main` (SPEC 25).
- `dev` se despliega con cualquier ref, incluido `main` (SPEC 08).
- Las imágenes de `postgres`, `minio`, `cloudflared` y `autoheal` vienen de Docker Hub y no se tocan.
- Los límites de memoria y de logs del compose (SPEC 25).

## Alcance

**Dentro:**

- **Imágenes publicadas** en `ghcr.io/inerhead/` (cuenta del dueño del repo, en minúsculas):
  - `omnidesk-api`: `apps/api/Dockerfile`, etapa `prod`, con `APP_VERSION` = el tag.
  - `omnidesk-gateway`: `infra/gateway/Dockerfile`, con `BASE_PATH=/omnidesk` y `VITE_API_URL` vacía (los valores de prod y dev).
  - Una etiqueta por versión: `vX.Y.Z`. No hay `latest`.
  - Plataforma `linux/amd64` (el VPS de OVHcloud es x86; un criterio lo comprueba).
  - Etiquetas OCI, entre ellas `org.opencontainers.image.source` con la URL del repo, para que GitHub enlace el paquete al repo y herede su visibilidad privada.
- **Workflow `release.yml`** (el de SPEC 25), con jobs nuevos tras `tag`:
  - `tag` expone el tag resultante como salida, tanto si lo crea como si el commit ya lo tenía.
  - `images`: hace checkout del tag, inicia sesión en `ghcr.io` con `GITHUB_TOKEN`, y construye y sube las dos imágenes. Permisos: `contents: read` y `packages: write`, solo en este job.
    - Si la imagen de ese tag ya existe en el registro, no la reconstruye ni la sobrescribe: una versión publicada es inmutable.
    - Caché de capas con `type=gha`.
    - Sin atestaciones de procedencia (`provenance: false`), para no dejar manifiestos sin etiquetar que ensucian la lista de versiones.
    - Escribe en el resumen del run las referencias publicadas y su digest.
  - `prune`: tras publicar, conserva las **10 versiones más recientes** de cada paquete y borra el resto. Borrar exige que el repo tenga el rol **Admin** en «Manage Actions access» del paquete (con el rol Write que recibe por defecto solo puede publicar): el job usa `continue-on-error` y avisa si no puede, para no marcar en rojo un release que publicó bien.
  - Un tag solo existe en `origin` si `verify` y `migrations` pasaron; las imágenes se construyen después. Si `images` falla, el tag existe sin imagen y no se despliega (ver Riesgos).
- **`docker-compose.prod.yml`:** `api` y `gateway` pasan a tener `image:` con la variable `OMNIDESK_IMAGE_TAG` (por defecto `dev`), además de su `build:`:
  - Con `build`, el compose etiqueta la imagen construida con ese nombre: dev sigue funcionando igual.
  - Con `pull`, baja la imagen publicada.
- **`deploy.sh`:**
  - **`prod`** (cambia el flujo): exporta `OMNIDESK_IMAGE_TAG=<tag>`, ejecuta `compose pull api gateway` en lugar de `build`, y levanta con `up -d --no-build`.
    - Si la imagen del tag no existe, falla con un mensaje claro («la imagen … no existe: espera a que termine el job `images` en Actions»). No cae a compilar en el VPS.
    - Si no hay sesión en `ghcr.io`, falla con el comando para iniciarla.
    - Falla si el `.env.prod` tiene `BASE_PATH` distinto de `/omnidesk` o `VITE_API_URL` no vacía: son los valores con los que se construyó la imagen del gateway, y un `.env` distinto no cambiaría la imagen.
    - Mantiene las comprobaciones de SPEC 25 (tag en `origin/main`, claves duplicadas, `BACKUP_DIR`, `localhost`), la espera del healthcheck, la comprobación de versión y la limpieza.
    - Al terminar, borra las imágenes de OmniDesk de versiones anteriores que ningún contenedor usa (`docker image prune -a` filtrado por la etiqueta `org.opencontainers.image.source`). Sin esto, cada despliegue dejaría ~1 GB en un disco de 40 GB. No toca imágenes de otras apps ni las que están en uso.
  - **`dev`:** sin cambios; sigue construyendo en el VPS con cualquier ref.
- **Acceso del VPS a las imágenes privadas:** un token personal clásico de solo lectura (`read:packages`), usado una vez con `docker login ghcr.io` en el VPS.
- **Documentación:**
  - `docs/despliegue.md`: sección «Imágenes en ghcr.io (SPEC 26)» con la guía para crear el token, iniciar sesión en el VPS, desplegar por pull y **ver las imágenes en GitHub** (ver abajo), y actualización de §2, §3, §4, del runbook de OVHcloud y de la sección de dimensionamiento (el build ya no ocurre en el VPS de prod).
  - README: una línea.
- **Guía para ver las imágenes** (dentro de la sección de arriba):
  - En GitHub: la barra lateral del repositorio (**Packages**) y la pestaña **Packages** de tu perfil, con la URL `https://github.com/users/inerhead/packages/container/package/omnidesk-api` y su equivalente para el gateway. Cada versión muestra sus etiquetas, su digest y el comando de `docker pull`.
  - Ajustes del paquete: enlace al repositorio, visibilidad privada y gestión de acceso.
  - Desde el terminal: `gh api` para listar versiones (con el permiso `read:packages`), `docker pull` y `docker image inspect` para ver el digest, y `docker manifest inspect` para comprobar que una etiqueta existe.
  - En Actions: el resumen del run de `release` lista lo publicado en cada ejecución.

**Fuera de alcance (para futuros specs):**

- Imágenes públicas.
- Imágenes de varias arquitecturas (arm64).
- Imágenes para `dev`: dev sigue construyendo en el VPS.
- Ejecución manual del workflow para reconstruir o construir un tag existente. Los tags previos a este spec (`v0.1.0`, `v0.1.1`) no tienen imagen y no se podrán desplegar en prod.
- Firma de imágenes (cosign), atestaciones de procedencia y análisis de vulnerabilidades.
- Despliegue automático desde GitHub por SSH.
- Etiqueta `latest` o etiquetas por SHA.
- Espejo en otro registro (Docker Hub, OVHcloud) por si GitHub cambia las condiciones.
- Alertas de uso o de cuota del registro.

## Modelo de datos

Este spec no introduce estructuras de datos de la aplicación. Cambia lo que se publica y una variable de despliegue.

**Paquetes en `ghcr.io`** (privados, enlazados al repo `inerhead/OmniDesk`):

| Paquete | Referencia | Origen |
| --- | --- | --- |
| `omnidesk-api` | `ghcr.io/inerhead/omnidesk-api:vX.Y.Z` | `apps/api/Dockerfile`, etapa `prod` |
| `omnidesk-gateway` | `ghcr.io/inerhead/omnidesk-gateway:vX.Y.Z` | `infra/gateway/Dockerfile` |

**Argumentos de build en el pipeline:**

```text
api:     target=prod   APP_VERSION=<tag>
gateway: BASE_PATH=/omnidesk   VITE_API_URL=
```

**Variable de despliegue** (la fija `deploy.sh`; no va en el `.env` y no entra en `turbo.json`, porque solo la usa Compose):

```text
OMNIDESK_IMAGE_TAG=v0.1.2     # prod; por defecto «dev» en las construcciones locales
```

Fragmento del compose:

```yaml
api:
  image: ghcr.io/inerhead/omnidesk-api:${OMNIDESK_IMAGE_TAG:-dev}
  build: { context: ../.., dockerfile: apps/api/Dockerfile, target: prod }
gateway:
  image: ghcr.io/inerhead/omnidesk-gateway:${OMNIDESK_IMAGE_TAG:-dev}
  build: { context: ../.., dockerfile: infra/gateway/Dockerfile }
```

## Plan de implementación

1. **Compose.** Añadir `image:` con `OMNIDESK_IMAGE_TAG` a `api` y `gateway`. Comprobar: `compose config` sigue válido y `compose build api gateway` etiqueta las imágenes como `…:dev`, es decir, dev no cambia.
2. **Pipeline.** Ampliar `release.yml`: salida del job `tag`, job `images` (login, comprobación de existencia, build y push de las dos imágenes, resumen) y job `prune`. Probar en local que ambos Dockerfiles construyen con los argumentos del pipeline y que la imagen del gateway sirve `/omnidesk/` con `BASE_PATH=/omnidesk`; validar el YAML.
3. **`deploy.sh`.** Rama de prod por `pull`, comprobación de sesión en `ghcr.io`, mensaje de imagen inexistente y validación de `BASE_PATH` y `VITE_API_URL`; dev intacto. Probar con un `docker` simulado: prod con la imagen presente, sin imagen, sin sesión, con `BASE_PATH` distinto, y dev construyendo.
4. **Documentación.** Sección de `ghcr.io` en `docs/despliegue.md` con la guía para ver las imágenes, actualización de §2–§4, runbook y dimensionamiento, y README.
5. **Fusionar en `main`.** El pipeline crea el siguiente tag y publica las imágenes. Comprobar en GitHub que ambos paquetes existen, son privados y están enlazados al repo, y dar al repo el rol **Admin** en «Manage Actions access» de cada paquete para que `prune` pueda borrar versiones antiguas.
6. **Token y sesión en el VPS.** Crear el token de solo lectura e iniciar sesión con `docker login ghcr.io`.
7. **Desplegar por pull** el tag nuevo con `deploy.sh prod <tag>` y verificar.

## Criterios de aceptación

**Pipeline**

- [ ] Un push verde a `main` crea el tag `vX.Y.Z` y, después, el job `images` publica `ghcr.io/inerhead/omnidesk-api:vX.Y.Z` y `ghcr.io/inerhead/omnidesk-gateway:vX.Y.Z`.
- [ ] Si `verify` o `migrations` fallan, no hay tag ni imágenes.
- [ ] El job `images` solo tiene `packages: write`; los jobs `verify` y `migrations` conservan solo `contents: read`.
- [ ] Volver a ejecutar el workflow sobre un commit que ya tiene tag e imagen no reconstruye ni sobrescribe la imagen (el digest no cambia).
- [ ] Tras publicar la versión 11, el job `prune` deja solo las 10 más recientes de cada paquete (con el rol Admin del repo en el paquete). Sin ese rol, `prune` termina con un aviso y el release sigue en verde.
- [ ] El resumen del run lista las dos referencias con su digest.

**Registro**

- [ ] Los dos paquetes aparecen en la barra lateral del repo, en **Packages**, y en la pestaña **Packages** del perfil.
- [ ] Ambos paquetes son **privados** y están enlazados al repo `inerhead/OmniDesk`.
- [ ] `docker manifest inspect ghcr.io/inerhead/omnidesk-api:vX.Y.Z` sin sesión falla (no autorizado), y con la sesión del token funciona.
- [ ] La imagen es `linux/amd64` y el VPS de OVHcloud es x86 (`uname -m` devuelve `x86_64`).

**Despliegue**

- [ ] `deploy.sh prod vX.Y.Z` no ejecuta ningún `build`: hace `pull` de `api` y `gateway`, levanta con `--no-build` y termina con `✅ omnidesk-prod desplegado: vX.Y.Z`.
- [ ] `/api/v1/health` responde `version: vX.Y.Z`.
- [ ] `deploy.sh prod <tag sin imagen>` (por ejemplo `v0.1.1`) falla con un mensaje que nombra la imagen que falta y no compila en el VPS.
- [ ] Sin sesión en `ghcr.io`, `deploy.sh prod` falla con un mensaje que indica cómo iniciarla.
- [ ] Con `BASE_PATH` distinto de `/omnidesk` o `VITE_API_URL` no vacía en `.env.prod`, `deploy.sh prod` se niega a desplegar.
- [ ] `deploy.sh dev main` sigue construyendo en el VPS y funciona como antes.
- [ ] Durante un `deploy.sh prod`, la memoria disponible del VPS no baja del nivel de un despliegue normal: ya no aparece el pico de ~1 GB del build (`watch -n2 free -m`).
- [ ] Tras un despliegue de prod, `docker image ls` en el VPS solo muestra las imágenes de OmniDesk de la versión en uso (las anteriores se borran) y no se borra ninguna imagen de otra app.
- [ ] El rollback a una versión anterior que tenga imagen (`deploy.sh prod <tag anterior>`) deja `/health` con esa versión.

**Documentación**

- [ ] `docs/despliegue.md` explica cómo ver las imágenes en GitHub (barra lateral del repo, perfil, URL del paquete, página de versiones), en el terminal (`gh api`, `docker manifest inspect`) y en el resumen del run de Actions.
- [ ] La guía explica cómo crear el token (`read:packages`), cómo iniciar sesión en el VPS y cómo revocarlo.

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0.

## Decisiones

- **Sí:** `ghcr.io`. Es gratis hoy, está integrado con el repo y con `GITHUB_TOKEN`, y no hace falta una cuenta nueva. Decisión del usuario.
- **No:** Docker Hub o el registro de OVHcloud. Cuentas y credenciales nuevas, y Docker Hub limita las descargas.
- **Sí:** paquetes **privados**. Decisión del usuario. La imagen del API lleva tu código compilado y las migraciones; el precio es un token personal en el VPS y que el almacenamiento cuente contra la cuota si GitHub cambia las condiciones.
- **No:** paquetes públicos. Cualquiera podría descargar el código compilado y las migraciones.
- **Sí:** el VPS descarga las imágenes (`pull`) en lugar de compilarlas. Decisión del usuario. Elimina el pico de memoria del build en prod y acelera el despliegue.
- **No:** mantener el build en el VPS como alternativa automática. Dos caminos de despliegue distintos dan resultados distintos. Un tag sin imagen falla en lugar de compilar.
- **Sí:** el build dentro de `release.yml`, tras crear el tag. Decisión del usuario. Los tags creados con `GITHUB_TOKEN` no disparan otros workflows, así que un workflow aparte no se enteraría; un solo flujo garantiza que cada tag tiene su imagen.
- **No:** ejecución manual para reconstruir. Decisión del usuario: se evita un segundo camino. Consecuencia aceptada: `v0.1.0` y `v0.1.1` no tienen imagen y no se despliegan en prod; el primer tag desplegable es el siguiente que cree el pipeline.
- **No:** construir en cada push a `main` con el SHA. Separa la imagen de la versión desplegada y duplica el trabajo.
- **Sí:** retención de las **10** versiones más recientes. Decisión del usuario. Cada versión pesa cerca de 1 GB; sin límite, el almacenamiento crece sin tope. Consecuencia: el rollback llega como mucho 10 versiones atrás.
- **Sí:** una sola etiqueta por imagen, `vX.Y.Z`; sin `latest`. El tag de git, la imagen y `/health` dicen lo mismo, y `latest` es ambiguo en un despliegue que siempre nombra la versión.
- **Sí:** inmutabilidad: si la imagen de un tag ya existe, no se sobrescribe. Lo desplegado en prod con ese tag no cambia a posteriori.
- **Sí:** nombres `omnidesk-api` y `omnidesk-gateway` bajo `ghcr.io/inerhead`. Llevan el prefijo del proyecto para distinguirlos de otros paquetes de la misma cuenta. Cambiar el prefijo solo toca el compose y el workflow.
- **Sí:** `linux/amd64` únicamente. El VPS es x86; una imagen multi-arquitectura duplica el tiempo de build sin que nada la use.
- **Sí:** el gateway se construye con `BASE_PATH=/omnidesk` y `VITE_API_URL` vacía, y `deploy.sh` rechaza un `.env.prod` que difiera. La base y la API quedan fijadas en el build de la web; sin la validación, un `.env` distinto parecería funcionar y rompería rutas.
- **Sí:** token personal clásico con `read:packages`. Los tokens de granularidad fina no admiten paquetes de `ghcr.io`.
- **Sí:** sin atestaciones de procedencia (`provenance: false`). Cada una crea un manifiesto sin etiquetar que ocupa una entrada más en la lista de versiones y complica la retención.
- **Sí:** dev no cambia. No hace falta una imagen por commit, y dev se despliega con cualquier ref.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| GitHub deja de ofrecer `ghcr.io` gratis o aplica la cuota de 500 MB de la cuenta Free a paquetes privados | GitHub avisa con al menos un mes de antelación. La retención de 10 versiones acota el uso. Si pasa, las opciones son pagar el plan, hacer los paquetes públicos o pasar a otro registro (otro spec). |
| El job `images` falla y el tag existe sin imagen | `deploy.sh prod` lo detecta y falla con un mensaje claro. El siguiente push verde crea el tag siguiente con su imagen. No hay forma de reconstruir un tag antiguo (fuera de alcance). |
| El token del VPS queda guardado en `~/.docker/config.json` en base64 (no cifrado) | Es de solo lectura y solo para paquetes; el archivo tiene permisos del usuario. Se documenta cómo revocarlo y rotarlo. |
| El token personal caduca y el despliegue falla con «no autorizado» | El mensaje de `deploy.sh` indica el comando para volver a iniciar sesión. Se documenta la caducidad. |
| El paquete se crea sin enlace al repo o con otra visibilidad | La etiqueta OCI `org.opencontainers.image.source` lo enlaza. Criterios de aceptación comprueban enlace y visibilidad. |
| Un cambio de `BASE_PATH` o de la URL de la API exige reconstruir el gateway | `deploy.sh` lo rechaza. Cambiarlos implica cambiar el workflow y publicar un tag nuevo. |
| `prune` no puede borrar porque el repo solo tiene el rol Write en el paquete | El job avisa sin tumbar el release. Se da el rol Admin al repo una vez (paso 5). Mientras tanto las versiones se acumulan. |
| `docker image prune -a` borra una imagen de otra app del VPS | Filtra por la etiqueta `org.opencontainers.image.source` del repo de OmniDesk: solo borra imágenes que el pipeline etiquetó así y que ningún contenedor usa. |
| La retención borra la versión a la que se quiere volver | Solo borra más allá de la décima. Si hace falta más historial, se sube el número en el workflow. |
| La caché de Actions (`type=gha`) se llena o se invalida | Solo acelera: sin caché el build tarda más pero produce lo mismo. |
| Las imágenes se publican en un VPS de otra arquitectura | Criterio de aceptación con `uname -m`. Si fuera arm64, hay que añadir esa plataforma. |
| Tags antiguos sin imagen (`v0.1.0`, `v0.1.1`) no se pueden desplegar ni usar para rollback | Se documenta. El rollback funciona entre los tags desde este spec. |

## Lo que **no** entra en este spec

- Imágenes públicas y multi-arquitectura.
- Imágenes para `dev`.
- Reconstruir o construir a mano un tag existente.
- Firma, atestaciones y análisis de vulnerabilidades.
- Despliegue automático por SSH desde GitHub.
- Etiqueta `latest` y etiquetas por SHA.
- Espejo en otro registro y alertas de cuota.

Cada uno de esos, si llega, va en su propio spec.
