# SPEC 29 — Versión desplegada y versión de la app en «Mi perfil»

> **Status:** Implemented
> **Depends on:** SPEC 15, SPEC 21, SPEC 26, SPEC 28
> **Date:** 2026-11-09
> **Objective:** La página «Mi perfil» muestra, en una sección «Acerca de», la versión desplegada en el servidor y la versión de la app que usa este dispositivo, y ofrece actualizar cuando no coinciden.

## Por qué existe este spec

Desde SPEC 28 cada versión de `main` llega sola a prod. El usuario quiere comprobar desde la app qué versión está desplegada y cuál está usando.

Hoy hay dos versiones distintas y solo una se ve:

- **Servidor:** el API conoce su versión (`APP_VERSION`, el tag `vX.Y.Z`) y la devuelve en `GET /api/v1/health`. Solo se ve en `/status`.
- **App:** la web es una PWA. El service worker puede seguir sirviendo el bundle anterior hasta que el usuario acepta «Nueva versión disponible». La web no sabe qué versión es: el build del gateway no recibe `APP_VERSION`.

Si las dos no coinciden, el dispositivo usa una app desactualizada. El perfil lo dice y permite actualizar.

## Alcance

**Dentro:**

- **Versión de la web en el build:**
  - `infra/gateway/Dockerfile` acepta `ARG APP_VERSION=` y lo pasa como variable de entorno al `pnpm exec turbo run build`.
  - `.github/workflows/release.yml` pasa `APP_VERSION=${{ env.VERSION }}` en los `build-args` de la imagen del gateway, igual que en la del API.
  - `apps/web/vite.config.ts` inyecta la constante `__APP_VERSION__` con `define`: el valor de `APP_VERSION`, o `dev` si no existe (desarrollo local, `docker compose`).
  - `turbo.json`: `APP_VERSION` se añade al `env` de la tarea `build`, para que un build cacheado de otra versión no se reutilice. Ya está en `globalPassThroughEnv`.
  - Declaración de tipo de `__APP_VERSION__` (`declare const __APP_VERSION__: string`) en un `.d.ts` dentro de `apps/web/src`.
  - `apps/web/src/shared/config/app-version.ts` exporta `appVersion` (el valor de `__APP_VERSION__`). El resto del código no lee la constante directamente.
- **Comparación de versiones** (`apps/web/src/features/profile/version-status.ts`, función pura con test):
  - Entrada: versión de la app y versión del servidor (o `null` si el API no respondió).
  - Salida: `same` (coinciden), `different` (no coinciden), `unknown` (el servidor no respondió, o alguna de las dos es `dev`).
  - Compara por texto exacto, sin interpretar mayor o menor: cualquier diferencia es `different` (también tras un rollback del servidor).
- **Sección «Acerca de»** en `/settings/profile` (`apps/web/src/features/profile/about-section.tsx`), al final de la página y visible para todos los roles (`OWNER`, `ADMIN`, `AGENT`):
  - **Versión del servidor:** la de `/api/v1/health`, formateada con `formatVersion` (de `features/health/model/system-status.ts`).
    - Mientras carga: un esqueleto o «Cargando…».
    - Si el API no responde o la respuesta no es válida: «No disponible». El resto del perfil se muestra igual.
  - **Versión de la app (este dispositivo):** `appVersion`, formateada igual. Se muestra siempre, aunque falle el API.
  - **Si `different`:** el texto «Este dispositivo usa una versión distinta de la desplegada.» y un botón «Actualizar».
    - El botón llama a `registration.update()` del service worker y después a `applyAppUpdate` (`shared/pwa/apply-app-update.ts`), que activa el service worker nuevo y recarga.
    - Si no hay service worker registrado (por ejemplo, en `vite dev`), recarga la página.
    - Mientras actualiza, el botón queda deshabilitado.
    - Nunca recarga sola: solo al pulsar el botón.
  - Con `same` o `unknown` no se muestra aviso ni botón.
  - La consulta de `/health` usa TanStack Query con la clave `['health', 'about']` y `fetchHealth` (`features/health/api/fetch-health.ts`), sin polling: se pide al abrir la página.

**Fuera de alcance (para futuros specs):**

- Fecha u hora del despliegue o del build. Hoy no se guarda; exigiría cambiar `/health` y el contrato.
- Mostrar la versión en otras pantallas (menú lateral, login, pie de página).
- Changelog o notas de la versión.
- Comparar mayor/menor para decir «más nueva» o «más antigua».
- Cambiar el aviso flotante «Nueva versión disponible» o la frecuencia con la que se buscan versiones.
- Cambios en el API o en `@omnidesk/contracts`: `HealthResponse.version` ya existe.

## Modelo de datos

Este spec no introduce estructuras persistentes ni cambia contratos. Añade una constante de build y un tipo local de la web.

```ts
// apps/web/src/shared/config/app-version.ts
export const appVersion: string; // `__APP_VERSION__`: 'v0.1.7' en prod, 'dev' en local

// apps/web/src/features/profile/version-status.ts
export type VersionStatus = 'same' | 'different' | 'unknown';
export function versionStatus(app: string, server: string | null): VersionStatus;
```

Origen de cada versión:

| Versión | Fuente | Fijada en |
| --- | --- | --- |
| Servidor | `GET /api/v1/health` → `version` | Build de la imagen del API (`APP_VERSION`, SPEC 26) |
| App | `__APP_VERSION__` | Build de la imagen del gateway (`APP_VERSION`, este spec) |

Las dos imágenes se construyen en el mismo job `images` con el mismo tag, así que tras un despliegue correcto coinciden.

## Plan de implementación

1. **Constante de build.** `define` de `__APP_VERSION__` en `vite.config.ts`, declaración de tipo, `shared/config/app-version.ts` y `APP_VERSION` en el `env` de la tarea `build` de `turbo.json`. Comprobar: `pnpm --filter @omnidesk/web build` sin variable deja `dev` en el bundle; con `APP_VERSION=v9.9.9` deja `v9.9.9`.
2. **Gateway y pipeline.** `ARG APP_VERSION=` en `infra/gateway/Dockerfile` y `APP_VERSION` en los `build-args` del gateway en `release.yml`. Comprobar: `docker build --build-arg APP_VERSION=v9.9.9 -f infra/gateway/Dockerfile .` produce un bundle que contiene `v9.9.9`.
3. **`versionStatus`.** Función pura y su test (`version-status.spec.ts`): iguales → `same`; distintas → `different`; servidor `null` → `unknown`; app o servidor `dev` → `unknown`.
4. **Sección «Acerca de».** `about-section.tsx` con la consulta de `/health`, las dos versiones, los estados de carga y error, y el aviso con el botón «Actualizar». Añadirla al final de `profile-page.tsx` (también se omite en el esqueleto de carga, que sigue igual). Comprobar en `http://localhost:8080/omnidesk/settings/profile`: las dos versiones salen como `dev` y no hay aviso.
5. **Documentación.** Mencionar en `docs/despliegue.md` que, tras desplegar, «Mi perfil → Acerca de» muestra la versión del servidor y la de la app.

## Criterios de aceptación

- [ ] En `/settings/profile` aparece la sección «Acerca de» al final, para `OWNER`, `ADMIN` y `AGENT`.
- [ ] La sección muestra «Versión del servidor» con el valor de `version` de `/api/v1/health`.
- [ ] La sección muestra «Versión de la app» con el `APP_VERSION` con el que se construyó la imagen del gateway.
- [ ] En local (`docker compose up`), las dos versiones muestran `dev` y no aparece aviso ni botón.
- [ ] Con el API caído, «Versión del servidor» muestra «No disponible», «Versión de la app» se sigue mostrando y el resto del perfil funciona.
- [ ] Si la versión de la app es distinta de la del servidor, aparece el aviso y el botón «Actualizar».
- [ ] Pulsar «Actualizar» activa el service worker nuevo y recarga; después las dos versiones coinciden y el aviso desaparece.
- [ ] La página nunca recarga sola.
- [ ] Tras un despliegue en prod de `vX.Y.Z`, con la app actualizada, las dos versiones muestran `vX.Y.Z`.
- [ ] Dos builds de la web con distinto `APP_VERSION` no reutilizan la caché de turbo (el segundo contiene su versión).
- [ ] `version-status.spec.ts` cubre `same`, `different`, servidor `null` y `dev`, y pasa.
- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm test` pasan.

## Decisiones

- **Sí:** mostrar las dos versiones. Decisión del usuario. Solo la del servidor no detecta una PWA desactualizada, que es lo que de verdad usa el dispositivo.
- **Sí:** `APP_VERSION` como build-arg del gateway, inyectado con `define` de Vite como `__APP_VERSION__`. Decisión del usuario. Es la misma variable que ya recibe el API, y el pipeline usa el mismo tag para las dos imágenes.
- **No:** `VITE_APP_VERSION` validada en `WebEnvSchema`. Duplicaría el nombre de una variable que ya existe y la mezclaría con la configuración del despliegue.
- **No:** fecha del despliegue. Decisión del usuario. Hoy no se guarda; queda para otro spec si hace falta.
- **Sí:** sección «Acerca de» al final del perfil, para todos los roles. Decisión del usuario. Es información útil para cualquier agente que reporte un problema.
- **Sí:** «No disponible» si el API no responde. Decisión del usuario. El perfil no debe depender de `/health`.
- **Sí:** aviso con botón «Actualizar» que reutiliza `applyAppUpdate`. Decisión del usuario. Mantiene la regla de no recargar sin que el usuario lo pida (como el aviso flotante), y no se escribe otro mecanismo de actualización.
- **Sí:** comparación por texto exacto, sin mayor o menor. Tras un rollback del servidor la app sería «más nueva» y también debe actualizarse.
- **Sí:** `dev` en cualquiera de las dos da `unknown`. En local las versiones no significan nada y el aviso sería ruido.
- **Sí:** `APP_VERSION` en el `env` de la tarea `build` de turbo. `globalPassThroughEnv` pasa la variable, pero no la incluye en el hash: sin esto, turbo podría reutilizar un build con otra versión.
- **No:** polling de `/health` desde el perfil. Basta con pedirla al abrir la página; `/status` ya monitoriza el API.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Turbo reutiliza un `dist/` cacheado de otra versión | `APP_VERSION` en el `env` de la tarea `build` (entra en el hash). Criterio de aceptación específico. |
| El gateway se construye sin `APP_VERSION` (por ejemplo, un build manual) | La app muestra `dev` y la comparación da `unknown`: no hay aviso falso. |
| `registration.update()` no encuentra un service worker nuevo (la web no cambió entre versiones) | `applyAppUpdate` recarga igual; las imágenes se construyen siempre con el tag nuevo, así que el bundle cambia en cada versión. |
| El API responde una versión pero el gateway en marcha es de otra (despliegue a medias) | El aviso aparece y lo dice; es justo el caso que se quiere ver. |

## Lo que **no** entra en este spec

- Fecha u hora del despliegue.
- Versión en otras pantallas, changelog o notas de versión.
- Comparación mayor/menor entre versiones.
- Cambios en el aviso flotante de actualización, en el API o en `@omnidesk/contracts`.

Cada uno, si llega, va en su propio spec.
