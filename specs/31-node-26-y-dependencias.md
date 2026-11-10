# SPEC 31 — Node 26 LTS, GitHub Actions y dependencias al día

> **Status:** Implemented
> **Depends on:** SPEC 01, SPEC 25, SPEC 26
> **Date:** 2026-11-10
> **Objective:** El repo, sus imágenes Docker y el CI pasan a Node 26 LTS, las GitHub Actions dejan de avisar de Node 20, y las dependencias suben a sus últimas versiones menores más tsup 9 y web-push 4.

## Por qué existe este spec

El workflow `release.yml` muestra avisos «Node.js 20 is deprecated» en los jobs `migrations`, `verify` y otros. El aviso no viene de nuestro Node, sino de las acciones de terceros:

| Acción | Hoy | Última | Runtime de la última |
| --- | --- | --- | --- |
| `actions/checkout` | `@v4` | `@v7` | `node24` |
| `actions/setup-node` | `@v4` | `@v7` | `node24` |
| `docker/setup-buildx-action` | `@v3` | `@v4` | `node24` |
| `docker/login-action` | `@v3` | `@v4` | `node24` |
| `docker/build-push-action` | `@v6` | `@v7` | `node24` |
| `actions/delete-package-versions` | `@v5` | `@v5` | **`node20`** |

`delete-package-versions` no tiene versión con Node 24: el aviso solo desaparece si se reemplaza.

Además, el repo usa Node 24. Node 26 («Lithium») es LTS desde el 28‑10‑2026 y es la última estable. `@types/node` ya está en 26.

## Alcance

**Dentro:**

- **Node 26 en todo el repo:**
  - `.nvmrc`: `24` → `26`.
  - `package.json` raíz: `engines.node` `>=24` → `>=26`.
  - `apps/api/Dockerfile`, `apps/web/Dockerfile` e `infra/gateway/Dockerfile`: `node:24-bookworm-slim` → `node:26-bookworm-slim`.
  - El CI lee `.nvmrc` (`node-version-file`), así que pasa a Node 26 sin más cambios.
  - Node 26 ya no trae `corepack`. Los 3 Dockerfiles y los jobs `verify` y `migrations` lo instalan con `npm install -g corepack@0.36.0` antes de `corepack enable`. pnpm sigue saliendo de `packageManager`.
- **GitHub Actions** en `.github/workflows/release.yml`, fijadas por major como hoy:
  - `actions/checkout@v7` (jobs `verify`, `migrations`, `tag`, `images`, y donde más aparezca).
  - `actions/setup-node@v7`.
  - `docker/setup-buildx-action@v4`, `docker/login-action@v4`, `docker/build-push-action@v7`.
  - Si una major nueva cambia o renombra un input que usamos, se adapta el paso.
- **Job `prune` sin `delete-package-versions`:**
  - El paso `borrar` pasa a ser un `run` con `gh api` (`GH_TOKEN: ${{ github.token }}`).
  - Lista las versiones del paquete `${{ matrix.package }}` (tipo `container`), ordenadas de más nueva a más antigua, y borra todas menos las **10** más recientes.
  - El endpoint depende del dueño: `/users/<owner>/packages/container/<pkg>/versions` o `/orgs/<owner>/...`, según `github.repository_owner` sea usuario u organización (`github.event.repository.owner.type`).
  - Conserva `continue-on-error: true` y el paso «Aviso si no se pudo limpiar» con el mismo texto.
- **pnpm:** `packageManager` `pnpm@12.11.2` → la última `12.x` publicada hace más de 24 h. `pnpm-lock.yaml` se regenera con ella.
- **Dependencias: parches y minors de todos los paquetes** que `pnpm outdated -r` lista, a la última versión publicada hace más de 24 h. Referencia del 2026‑11‑10:
  - API: `@prisma/client`, `@prisma/adapter-pg` y `prisma` 7.10.x, `@aws-sdk/client-s3`, `@swc/core`, `multer`, `nestjs-zod`, `supertest`.
  - Web: `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `@radix-ui/*`, `lucide-react`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`.
  - Compartidos: `zod`, `vitest`, `@types/node`, `eslint`, `typescript-eslint`, `globals`, `prettier`, `turbo`.
  - `prisma` y `@prisma/*` siempre en la misma versión.
- **Dos majors:**
  - `tsup` 8 → 9 en `@omnidesk/contracts`. Requiere Node `>=26` (o 22.18/24.11). Se ajusta `tsup.config.ts` si la v9 cambia opciones.
  - `web-push` 3 → 4 en el API. Se ajusta `apps/api/src/modules/notifications/infrastructure/web-push.transport.ts` si cambia la API de la librería.
- **Documentación:** «Node 24» → «Node 26» en `README.md`, `CLAUDE.md` y el comentario de `infra/deploy/docker-compose.prod.yml` (`fetch de Node 24`).

**Fuera de alcance (para futuros specs):**

- NestJS 11 → 12 (`@nestjs/*`, `@nestjs/cli`, `@nestjs/swagger`). Major grande que toca todo el API.
- TypeScript 6 → 7. Puede romper typecheck y `typescript-eslint` en los cuatro paquetes.
- Prisma 8: solo existe como `rc`.
- Reemplazar `prom-client` (marcado como deprecated). Afecta a `/metrics` (SPEC 11).
- Cambiar las imágenes `postgres:18`, `caddy:2` o `alpine` de `infra/`.
- Fijar las acciones por SHA en lugar de por major.
- Editar specs anteriores que mencionan Node 24: son históricos.

## Modelo de datos

Este spec no introduce estructuras de datos ni cambia contratos, esquema de Prisma ni migraciones. Solo cambia versiones.

| Pieza | Antes | Después |
| --- | --- | --- |
| Node (`.nvmrc`, `engines`, Dockerfiles) | 24 | 26 |
| pnpm (`packageManager`) | 12.11.2 | última 12.x con >24 h |
| `actions/checkout` / `setup-node` | v4 / v4 | v7 / v7 |
| `docker/setup-buildx` / `login` / `build-push` | v3 / v3 / v6 | v4 / v4 / v7 |
| Limpieza de GHCR (`prune`) | `actions/delete-package-versions@v5` | `gh api` en un paso `run` |
| `tsup` | 8.5.1 | 9.x |
| `web-push` | 3.6.7 | 4.x |

## Plan de implementación

Cada paso es un commit y deja `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` en verde.

1. **Node 26.** `.nvmrc`, `engines`, los tres Dockerfiles, `README.md`, `CLAUDE.md` y el comentario de `docker-compose.prod.yml`. Comprobar: `docker compose build && docker compose up` levanta el stack en `http://localhost:8080/omnidesk`, y `docker compose exec api node -v` muestra `v26.x`.
2. **pnpm.** `packageManager` a la última `12.x` con >24 h y `pnpm install` para regenerar el lockfile. Comprobar: `pnpm install --frozen-lockfile` pasa.
3. **Parches y minors.** `pnpm update -r` dentro de los rangos menores (sin NestJS 12, TypeScript 7, Prisma 8). Si una versión tiene <24 h, se fija la anterior. Comprobar: `pnpm --filter @omnidesk/api db:generate` y los cuatro comandos del repo pasan; `pnpm outdated -r` solo lista majors fuera de alcance y `prom-client`.
4. **tsup 9.** Subir en `@omnidesk/contracts` y adaptar `tsup.config.ts` si hace falta. Comprobar: `pnpm --filter @omnidesk/contracts build` genera `dist/` y el API y la web typecheckean contra él.
5. **web-push 4.** Subir en el API y adaptar `web-push.transport.ts` si hace falta. Comprobar: los tests de `modules/notifications` pasan y, con el stack levantado, una notificación push de prueba llega al navegador.
6. **E2E del API.** Comprobar: `docker compose exec api pnpm --filter @omnidesk/api test:e2e` pasa en Node 26.
7. **Actions.** Subir `checkout`, `setup-node`, `setup-buildx`, `login` y `build-push` en `release.yml`. Comprobar: un push de la rama ejecuta `verify` y `migrations` en verde y sin avisos de Node 20.
8. **`prune` con `gh api`.** Reemplazar `delete-package-versions` por el paso `run`. Comprobar: tras un release en `main`, el job `prune` termina sin avisos de Node 20 y cada paquete de GHCR conserva 10 versiones.

## Criterios de aceptación

- [ ] `.nvmrc` contiene `26` y `engines.node` es `>=26`.
- [ ] Ningún Dockerfile del repo usa `node:24`; los tres usan `node:26-bookworm-slim`.
- [ ] `docker compose exec api node -v` muestra `v26.x`.
- [ ] El stack local arranca con `docker compose up --build` y `http://localhost:8080/omnidesk` permite entrar y abrir la bandeja.
- [ ] `pnpm simulate` siembra las 5 conversaciones sin errores con Node 26.
- [ ] `packageManager` es una `pnpm@12.x` mayor que `12.11.2` y `pnpm install --frozen-lockfile` pasa.
- [ ] `pnpm outdated -r` no lista parches ni minors pendientes; solo `@nestjs/*`, `typescript`, `prisma` 8 `rc` y `prom-client`.
- [ ] `prisma`, `@prisma/client` y `@prisma/adapter-pg` tienen la misma versión.
- [ ] `tsup` está en 9.x y `pnpm --filter @omnidesk/contracts build` genera `dist/`.
- [ ] `web-push` está en 4.x y una notificación push de prueba llega al navegador.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` pasan.
- [ ] El e2e del API (`test:e2e`) pasa.
- [ ] `release.yml` no referencia `actions/checkout@v4`, `actions/setup-node@v4`, `docker/*@v3`, `docker/build-push-action@v6` ni `actions/delete-package-versions`.
- [ ] Una ejecución de `release.yml` no muestra ningún aviso «Node.js 20 is deprecated» en ningún job.
- [ ] Tras un release, cada paquete de GHCR (`omnidesk-api`, `omnidesk-gateway`, `omnidesk-deploy`) conserva 10 versiones.
- [ ] Si `prune` no puede borrar, el release no falla y aparece el aviso «No se pudieron borrar versiones antiguas…».
- [ ] `README.md` y `CLAUDE.md` dicen Node 26.

## Decisiones

- **Sí:** Node 26 LTS. Decisión del usuario. Es LTS desde el 28‑10‑2026, tiene soporte hasta 2029 y `@types/node` ya está en 26.
- **No:** quedarse en Node 24. Sigue soportado, pero el objetivo es la última estable.
- **No:** Node 27. Es versión impar (no LTS) y hoy solo hay `alpha`.
- **Sí:** instalar `corepack@0.36.0` con npm. Decisión del usuario, tomada al implementar: Node 26 dejó de incluirlo. Mantiene `packageManager` como única fuente de la versión de pnpm.
- **No:** `pnpm/action-setup` en CI o `npm i -g pnpm@<versión>`. El primero mezcla dos mecanismos; el segundo repite la versión de pnpm en 5 sitios.
- **Sí:** parches, minors, tsup 9 y web-push 4. Decisión del usuario. Son majors acotados a un archivo cada uno.
- **No:** NestJS 12 y TypeScript 7 aquí. Tocan todo el API o todo el typecheck; cada uno merece su spec para aislar roturas.
- **No:** Prisma 8. Solo hay `rc`.
- **Sí:** acciones en su última major, fijadas por major (`@v7`). Decisión del usuario. Es la convención actual y quita el aviso.
- **No:** fijar acciones por SHA. Más seguro, pero cambia la convención y exige mantenimiento.
- **Sí:** reemplazar `delete-package-versions` por `gh api`. Decisión del usuario. Su última versión sigue en `node20` y la limpieza es una llamada REST; `gh` ya viene en los runners.
- **No:** dejar el aviso de `prune` o quitar la limpieza. Lo primero no cumple el objetivo; lo segundo acumula ~1 GB por versión en GHCR.
- **Sí:** subir pnpm dentro de la 12. Decisión del usuario. Minor sin cambio de formato de lockfile esperado.
- **Sí:** versiones publicadas hace más de 24 h. pnpm rechaza las más nuevas (ver `CLAUDE.md`).
- **No:** `prom-client` aquí. Decisión del usuario. Reemplazarlo cambia `/metrics` (SPEC 11).
- **Sí:** actualizar `README.md`, `CLAUDE.md` y el comentario de prod; no los specs antiguos. Decisión del usuario. Los specs son históricos.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Una dependencia nativa (`@swc/core`, Prisma engines, `sharp` si lo hay) no tiene binario para Node 26. | El paso 1 compila las imágenes y el paso 3 ejecuta todos los tests. Si falla, se sube esa dependencia a una versión con soporte o se documenta el bloqueo antes de seguir. |
| Una major de acción cambia inputs (`build-push-action@v7`, `setup-node@v7`). | El paso 7 revisa los inputs que usamos contra el changelog de cada major y se prueba en la rama antes de `main`. |
| El endpoint de GHCR depende de si el dueño es usuario u organización. | El paso usa `github.event.repository.owner.type` para elegir `/users/` o `/orgs/`. Con `continue-on-error`, un fallo solo avisa. |
| `prune` borra versiones que prod necesita para un rollback. | Mismo criterio que hoy: se conservan las 10 más recientes. |
| `web-push` 4 cambia el formato de las claves VAPID o de la suscripción. | El paso 5 prueba una notificación real. Las suscripciones existentes (SPEC 13) no cambian de forma. |
| El VPS de prod corre la imagen con Node 26 por primera vez. | La imagen ya se prueba entera en CI y local. El despliegue automático (SPEC 28) hace backup y rollback si falla. |

## Lo que **no** entra en este spec

- NestJS 12.
- TypeScript 7.
- Prisma 8.
- Reemplazar `prom-client`.
- Cambiar las imágenes de `postgres`, `caddy` o `alpine`.
- Fijar acciones por SHA.
- Editar specs antiguos.

Cada uno, si llega, va en su propio spec.
