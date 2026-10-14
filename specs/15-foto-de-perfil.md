# SPEC 15 — Foto de perfil del usuario

> **Status:** Approved
> **Depends on:** SPEC 07, SPEC 14
> **Date:** 2026-10-14
> **Objective:** Cada usuario sube, encuadra en círculo, cambia o quita su propia foto de perfil desde `/settings/profile`, se guarda en MinIO y se ve en el menú de usuario, la lista de miembros, el agente asignado, los mensajes del agente y el selector demo del login.

## Por qué existe este spec

Hoy la única foto posible es la de Google. `User.avatarUrl` solo lo rellena `upsertFromGoogle` (`apps/api/src/modules/identity/infrastructure/prisma-user.repository.ts`) y se sobrescribe en cada login. Los usuarios demo y los que no quieren usar su foto de Google solo tienen iniciales.

Además, la foto solo aparece en el menú de usuario. `MemberSchema`, `MemberRefSchema` y `assignedAgent` (`packages/contracts`) solo llevan `id` y `displayName`. Por eso la lista de miembros, el chip de asignación y los mensajes del agente muestran iniciales aunque haya foto.

Este spec es el primero de tres en los que se dividió la petición del 2026-10-14. Los otros dos van aparte (ver "Qué **no** entra en este spec").

## Alcance

**Dentro:**

- **La foto es del usuario**, no del miembro: la misma en todas sus empresas.
- **Solo la propia.** Cada usuario sube, cambia o quita su foto. Nadie cambia la de otro.
- **Pantalla `/settings/profile`** ("Mi perfil"), para todos los roles:
  - Muestra la foto actual en tamaño grande (o las iniciales), el nombre y el email.
  - Botones "Subir foto" / "Cambiar foto" y "Quitar foto". "Quitar foto" solo aparece si hay foto subida.
  - Entrada "Mi perfil" en el menú del avatar (`user-menu.tsx`), encima de "Notificaciones".
- **Recorte circular en el navegador** con `react-easy-crop` (`cropShape="round"`, `aspect={1}`):
  - Diálogo con el recorte, un control de zoom y los botones "Cancelar" y "Guardar".
  - Acepta `image/jpeg`, `image/png` e `image/webp` de hasta 10 MB. Fuera de eso, aviso en la página y no se abre el recorte.
  - Al guardar, la web dibuja el área recortada en un canvas de 512×512 y lo exporta como WebP (calidad 0,85). Si el navegador no exporta WebP (Safari), exporta JPEG (calidad 0,85).
  - El archivo guardado es cuadrado. El círculo lo pone la UI (`rounded-full`), igual que hoy.
  - La librería se carga en diferido (`import()` dinámico), solo en "Mi perfil".
- **API:**
  - `PUT /api/v1/me/avatar` (multipart, campo `file`). Valida tipo por los primeros bytes (JPEG o WebP) y tamaño ≤ 1 MB. Guarda en MinIO, actualiza el usuario, borra el objeto anterior y responde `200` con `MeResponse['user']`.
  - `DELETE /api/v1/me/avatar`. Borra el objeto, limpia la foto subida y responde `200` con `MeResponse['user']` (que vuelve a la foto de Google o a `null`).
  - `GET /api/v1/users/:id/avatar`. Sirve la foto subida desde MinIO.
    - Exige sesión. Responde `404` si no hay foto subida, o si el usuario no es el propio y no tiene ni tuvo una membresía (`TenantMember`, aunque esté dada de baja) en la empresa activa de quien pide.
    - **Excepción demo:** con `DEMO_MODE=true`, la foto de un usuario sin cuenta de Google (`googleSub` null) se sirve sin sesión, para el selector del login. Con `DEMO_MODE=false` no hay excepción.
    - Cabeceras: `Content-Type` guardado, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` y `Cache-Control: private, max-age=31536000, immutable`.
  - `PUT` y `DELETE` pasan por `OriginGuard` y `UserSessionGuard`, como el resto de `/me`.
- **Precedencia de la foto:** la subida gana. Si no hay foto subida, se usa la de Google. Si no hay ninguna, iniciales.
  - El login con Google sigue actualizando la foto de Google en cada entrada, pero nunca toca la subida.
  - "Quitar foto" vuelve a la de Google, si la hay.
- **Dónde se ve la foto:**
  - Menú del avatar (botón y cabecera del menú), como hoy.
  - Lista de miembros (`/settings/members`).
  - Agente asignado: el chip de `status-chip.tsx`, con un avatar pequeño junto al nombre.
  - Mensajes del agente: el encabezado de autor del primer mensaje de cada grupo en `message-bubble.tsx`.
  - Selector demo del login (`login-page.tsx`).
- **Propagación:** el propio usuario ve la foto nueva al instante (la web invalida `['me']`, `['members']` y `['conversations']`). Los demás la ven cuando su app vuelva a pedir esos datos. No hay evento en tiempo real.
- **Borrado del archivo anterior:** al cambiar o quitar, primero se actualiza la fila y después se borra el objeto viejo en MinIO. Si el borrado falla, queda un log `warn` con la clave y la petición termina bien.

**Fuera:**

- Editar el nombre visible (`displayName`) u otros datos de la cuenta.
- Foto distinta por empresa.
- Que Owner o Admin cambien o quiten la foto de otro miembro (moderación).
- Evento en tiempo real cuando alguien cambia su foto.
- Foto en las notificaciones Web Push, en las líneas de eventos del chat ("Asignada a …") o en el selector "Asignar a" de `conversation-actions.tsx`.
- Procesar la imagen en el servidor (`sharp`), detectar el tamaño en píxeles o analizar el contenido.
- Foto de los contactos de WhatsApp.
- Rate limiting de la subida: el módulo de SPEC 10 no está implementado en `apps/api/src` (ver Riesgos).

## Modelo de datos

**Prisma (`User`):**

```prisma
model User {
  id              String    @id @default(uuid(7)) @db.Uuid
  googleSub       String?   @unique @map("google_sub")
  email           String    @unique
  displayName     String    @map("display_name")
  /// Foto de Google; se actualiza en cada login con Google. Misma columna que antes.
  googleAvatarUrl String?   @map("avatar_url")
  /// Clave en el bucket de la foto subida; null si no hay.
  avatarKey       String?   @map("avatar_key")
  /// Cuándo se subió la foto actual; versiona la URL para la caché.
  avatarUpdatedAt DateTime? @map("avatar_updated_at") @db.Timestamptz(3)
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  // … relaciones sin cambios
}
```

- `avatarUrl` pasa a llamarse `googleAvatarUrl` en Prisma con `@map("avatar_url")`. La columna no cambia y no se migran datos.
- La migración solo añade `avatar_key` y `avatar_updated_at`, ambas nulas.
- Clave en el bucket: `users/<userId>/avatar-<uuid>`. Es una clave nueva en cada subida, así que la caché del navegador nunca sirve una foto vieja con la URL nueva. Va en el bucket de SPEC 14 (`S3_BUCKET`), fuera de `tenants/`, porque la foto no pertenece a una empresa.

**Contratos (`@omnidesk/contracts`):**

```ts
/** URL de la foto subida, relativa al API; `v` = avatarUpdatedAt en ms. */
export function userAvatarPath(userId: string, version: number): string; // `/api/v1/users/${userId}/avatar?v=${version}`

export const AVATAR_UPLOAD_MAX_BYTES = 1024 * 1024; // lo que acepta el API
export const AVATAR_SOURCE_MAX_BYTES = 10 * 1024 * 1024; // lo que acepta la web antes de recortar
export const AVATAR_SIZE_PX = 512;

// Campo nuevo, siempre `z.string().nullable().default(null)`:
// MemberRefSchema.avatarUrl, ConversationSummary.assignedAgent.avatarUrl,
// MemberSchema.avatarUrl, AuthProvidersResponse.demoMembers[].avatarUrl.
// MeResponse.user.avatarUrl no cambia de forma.
```

- `avatarUrl` vale `userAvatarPath(...)` si hay foto subida, la URL de Google si no, o `null`. Lo calcula una función pura `resolveAvatarUrl(user)` en `apps/api/src/modules/identity/domain/user.ts`.
- La web antepone la base (`/omnidesk`) a los valores que empiezan por `/`, igual que hace `attachment-view.ts` con `attachmentContentPath`. Las URL de Google se usan tal cual.
- `.default(null)` mantiene válidos los payloads ya guardados en el Outbox, que no traen el campo.
- `MemberRef` lleva la foto del `User` enlazado. Un `TenantMember` sin `userId` (filas previas a SPEC 07) tiene `avatarUrl: null`.

## Plan de implementación

1. **Modelo y dominio.** Migración (`avatar_key`, `avatar_updated_at`), renombre `avatarUrl` → `googleAvatarUrl` en Prisma, `resolveAvatarUrl` con pruebas unitarias (subida, solo Google, ninguna). `upsertFromGoogle` escribe solo `googleAvatarUrl`. `GET /me` devuelve el valor resuelto. Prueba: tras un login con Google, `/me` sigue igual que antes.
2. **Contratos.** `userAvatarPath`, las constantes y el campo `avatarUrl` con `default(null)` en los cuatro esquemas. Typecheck verde sin tocar la web.
3. **Lecturas con foto.** Un `select` compartido de `MemberRef` que incluye `user { id, avatarKey, avatarUpdatedAt, googleAvatarUrl }`. Se usa en el read model de conversaciones (`assignedAgent`), en el repositorio de mensajes (`sender`) y en los eventos (`actor`, `target`). También en `GET /members` y en los `demoMembers` de `GET /auth/providers`. Prueba e2e: un miembro con foto de Google la ve en las cuatro respuestas.
4. **Módulo `profile` en el API** (`apps/api/src/modules/profile`). Importa `AttachmentsModule` (por `ATTACHMENT_STORAGE`) e `IdentityModule`. Casos de uso `UploadAvatar`, `RemoveAvatar` y `GetAvatar`. Controladores `MeAvatarController` (`PUT` y `DELETE /me/avatar`) y `UserAvatarController` (`GET /users/:id/avatar`). Detección de JPEG (`FF D8 FF`) y WebP (`RIFF….WEBP`) por los primeros bytes en `profile/domain`, con pruebas unitarias.
5. **E2E del API.** Subir, ver, cambiar (el objeto viejo desaparece del almacenamiento en memoria), quitar, los `404` de acceso y la excepción `DEMO_MODE`.
6. **Web: avatar en todas partes.** Tamaño `xs` (`size-5 text-[10px]`) en `shared/ui/avatar.tsx` y resolución de la base para rutas relativas. Foto en la lista de miembros, en el chip del agente asignado, en el encabezado de autor de los mensajes del agente y en el selector demo.
7. **Web: Mi perfil.** Ruta `settings/profile` en `router.tsx`, entrada "Mi perfil" en el menú, `features/profile/` con `profile-page.tsx`, `avatar-crop-dialog.tsx` (con `react-easy-crop` en diferido) y `crop-to-blob.ts` (canvas a 512×512, WebP con caída a JPEG), y `profile-api.ts`. Al guardar o quitar, invalida `['me']`, `['members']` y `['conversations']`.
8. **Documentación.** Sección "Verificación de implementación" en este spec.

## Criterios de aceptación

- [ ] Desde el menú del avatar, "Mi perfil" abre `/settings/profile` para Owner, Admin y Agent.
- [ ] Elegir un JPEG, PNG o WebP de hasta 10 MB abre el recorte circular. Un GIF, un PDF o un archivo de más de 10 MB muestra un aviso y no abre el recorte.
- [ ] Al guardar, la petición `PUT /api/v1/me/avatar` lleva una imagen de 512×512 px en WebP o JPEG de 1 MB o menos.
- [ ] Tras guardar, la foto nueva aparece en "Mi perfil" y en el menú del avatar sin recargar la página.
- [ ] La foto subida aparece en `/settings/members`, en el chip del agente asignado y en el encabezado de los mensajes que envió ese agente.
- [ ] Con `DEMO_MODE=true`, un usuario demo con foto subida la muestra en el selector de `/login`.
- [x] Cerrar sesión y volver a entrar con Google no reemplaza la foto subida.
- [x] "Quitar foto" vuelve a la foto de Google en un usuario de Google, y a las iniciales en un usuario demo.
- [x] Cambiar o quitar la foto borra el objeto anterior del bucket.
- [x] `PUT /api/v1/me/avatar` responde `415` con un PNG o un archivo que no sea JPEG/WebP por sus bytes, `413` con más de 1 MB, `400` sin archivo y `401` sin sesión.
- [x] `GET /api/v1/users/:id/avatar` responde `200` con `nosniff`, `Content-Security-Policy: sandbox` y `Cache-Control: private, max-age=31536000, immutable` a un miembro de la misma empresa activa.
- [x] `GET /api/v1/users/:id/avatar` responde `404` sin foto subida y a quien no comparte la empresa activa. Sin sesión responde `401`, salvo la excepción demo.
- [x] Con `DEMO_MODE=false`, la foto de un usuario demo sin sesión responde `401`.
- [x] La foto de un miembro dado de baja se sigue viendo en sus mensajes antiguos.
- [x] `react-easy-crop` no está en el bundle inicial: solo se descarga al abrir "Mi perfil".
- [ ] Lint, typecheck, test, build y e2e pasan.

## Decisiones tomadas y descartadas

- **Sí: foto del usuario, no del miembro** (elegida por el usuario). Encaja con la columna actual en `User` y con la foto de Google, que también es una sola.
- **Sí: solo la propia** (elegida por el usuario). La moderación por Owner/Admin queda fuera.
- **Sí: la subida gana a Google** (el usuario lo eligió tras ver que, con "gana Google", la foto se perdía en el siguiente login). Se guardan las dos por separado para que "Quitar foto" pueda volver a la de Google.
- **Sí: recorte circular en el navegador, salida 512×512** (elegida por el usuario). Sin dependencias nativas en el API. La subida pesa ~50–100 KB.
- **Sí: `react-easy-crop`** (elegida por el usuario). Pequeña y probada en táctil. Se descarta un recorte propio: más código y más riesgo en iOS.
- **No: `sharp` en el servidor.** Añade una dependencia nativa a la imagen Docker. El API solo valida tipo por bytes y tamaño, y el tope de 1 MB acota el daño de un cliente que se salte el recorte.
- **No: aceptar PNG en el API.** La web siempre envía WebP o JPEG. Aceptar solo dos formatos simplifica la validación por bytes.
- **Sí: servir por el API con sesión** (elegida por el usuario), como los adjuntos de SPEC 14. MinIO no se expone y la CSP actual (`img-src 'self'`) ya lo permite.
- **Sí: excepción sin sesión solo con `DEMO_MODE=true` y solo para usuarios sin Google** (elegida por el usuario). El selector del login se ve sin sesión. En producción no aplica.
- **Sí: acceso por la empresa activa, incluidas las membresías dadas de baja.** Así se ve la foto en el historial de un agente que ya no está. Se descarta exigir membresía activa: el historial mostraría iniciales.
- **Sí: clave nueva en cada subida y `?v=` en la URL.** Permite caché `immutable` de un año sin servir fotos viejas.
- **Sí: renombrar a `googleAvatarUrl` con `@map("avatar_url")`.** Deja claro el origen de cada campo sin migrar datos.
- **Sí: propagación al recargar datos** (elegida por el usuario). Se descarta un evento `user.avatar_changed` por Socket.IO: una foto no es urgente.
- **Sí: borrar el objeto anterior** (elegida por el usuario). Se descarta guardar un historial de fotos.
- **Sí: página `/settings/profile`** (elegida por el usuario) frente a un diálogo desde el menú. Deja sitio para más ajustes de cuenta.
- **No: editar el nombre visible.** Se ofreció y no se eligió.
- **Sí: dividir la petición en tres specs** (elegida por el usuario): 15 foto de perfil, 16 editar e inactivar empresa, 17 pulido de UI.

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Safari no exporta WebP desde `canvas.toBlob` y devuelve PNG. | `crop-to-blob.ts` comprueba el `type` del blob y, si no es WebP, exporta JPEG. Prueba unitaria con un `toBlob` simulado. |
| Fotos de iPhone en HEIC. | El `<input accept="image/jpeg,image/png,image/webp">` hace que iOS las convierta a JPEG al elegirlas. Si llega otro tipo, se muestra el aviso de formato. |
| Sin rate limiting, un usuario puede subir fotos en bucle. | Cada subida borra la anterior, así que el espacio no crece. El tope de 1 MB limita el ancho de banda. El rate limiting general es de SPEC 10, aún sin implementar. |
| Un fallo al borrar el objeto viejo deja un huérfano en MinIO. | Log `warn` con la clave. El prefijo `users/` permite limpiarlos a mano. |
| El job de retención de SPEC 12 recorre el bucket. | Las fotos viven en `users/`, fuera de `tenants/`. El job no debe tocar ese prefijo. |
| La foto en `MemberRef` añade un `join` con `users` a mensajes y eventos. | Es un `select` de tres columnas por clave primaria. Se revisa el tiempo de `GET /conversations/:id/messages` en la verificación. |
| Un cliente que se salte la web puede subir una imagen enorme en píxeles pero de menos de 1 MB. | El navegador la muestra a 40 px en un `<img>` con `object-cover`. No hay procesado en el servidor que pueda agotarse. |

## Qué **no** entra en este spec

- Editar el nombre visible u otros datos de la cuenta.
- Foto por empresa, moderación de fotos ajenas y evento en tiempo real.
- Foto en notificaciones push, en líneas de eventos y en el selector "Asignar a".
- Procesado en el servidor y rate limiting de la subida.
- **Editar o inactivar una empresa:** va en SPEC 16.
- **Icono animado de Conversaciones, rediseño de `/settings/members` y de `/settings/channels`:** van en SPEC 17.

Cada uno de esos, si llega, va en su propio spec.

## Verificación de implementación

2026-10-14, rama `spec-15-foto-de-perfil`.

Automatizado, en verde:

- `pnpm lint`, `pnpm typecheck` y `pnpm test` en todo el monorepo: 337 unitarias del API, 136 de la web y las de contratos.
- `pnpm --filter @omnidesk/api build` y `pnpm --filter @omnidesk/contracts build`.
- `pnpm --filter @omnidesk/api test:e2e` desde el host contra el Postgres local (`_e2e`): 174 pasaron y 1 se saltó (el de MinIO). `test/profile.e2e-spec.ts` aporta 11 pruebas.
- En el build de la web, `react-easy-crop` y su CSS salen en un chunk aparte (`avatar-crop-dialog-*.js` y `.css`). "Mi perfil" lo precarga al montarse.

Los criterios marcados arriba los cubren esas pruebas:

- El borrado del objeto anterior, los códigos `415`/`413`/`400`/`401`/`404`, las cabeceras, la excepción `DEMO_MODE` y la baja de un miembro están en `test/profile.e2e-spec.ts`.
- La prueba del login con Google llama a `upsertFromGoogle` de verdad.
- "Quitar foto" devuelve la foto de Google a un usuario de Google y `null` (iniciales) a un usuario demo.

Desviaciones menores del plan:

- **`Content-Type` del `GET`:** sale del tipo detectado por los bytes al servir, no de un metadato guardado. `AttachmentStorage.get` solo devuelve el cuerpo, y la foto pesa ≤ 1 MB, así que se lee entera.
- **Ruta de la foto en el dominio:** `resolveAvatarUrl` construye la ruta en `identity/domain/user.ts` sin importar `userAvatarPath`. La regla de lint impide que `domain/` importe `@omnidesk/contracts`. Es la misma convención que `REPLY_WINDOW_MS`.
- **Contratos:** se añadieron `isUploadedAvatarUrl` y `AVATAR_SOURCE_MIME_TYPES`. La web los usa para mostrar "Quitar foto" y para validar el archivo elegido.
- **Invitaciones:** `invitedBy` también lleva `avatarUrl`, porque usa `MemberRefSchema`.
- **CSP de producción.** El recorte se adaptó a `default-src 'self'` e `img-src 'self' data: …`:
  - Se pasa `disableAutomaticStylesInjection` y se importa `react-easy-crop/react-easy-crop.css`.
  - La imagen elegida se carga como URL `data:`, no `blob:`.

Pendiente:

- **`pnpm build` de la web falla, ya en `main`.** El fallo viene de `src/sw.ts`, que referencia `self.__WB_MANIFEST` dos veces desde `87f5519`, y `injectManifest` exige una sola. Se comprobó con los cambios de este spec guardados en un stash: el mismo error. No se corrige aquí porque está fuera del alcance.
- **Sin probar en navegador ni en teléfono:**
  - "Mi perfil" desde el menú con los tres roles.
  - El recorte con JPEG, PNG y WebP, y el aviso con GIF o PDF.
  - El tamaño real de la imagen que se sube.
  - La foto en la lista de miembros, en el chip del asignado, en los mensajes del agente y en el selector demo.
  - Safari, que exporta JPEG en lugar de WebP.
  - La conversión de HEIC en iOS.
- **El stack de Docker en marcha no tiene estos cambios:**
  - La imagen de `web` no tiene `react-easy-crop`.
  - El `api` necesita aplicar la migración `20261019000000_user_avatar`.
  - Para probarlo: `docker compose up -d --build api web`.
- **Tiempo de `GET /conversations/:id/messages`:** no se midió con el `join` nuevo a `users`.
