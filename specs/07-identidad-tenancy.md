# SPEC 07 — Identidad y tenancy: Google Login, empresas, invitaciones y roles

> **Status:** Implemented
> **Depends on:** SPEC 04, SPEC 06
> **Date:** 2026-10-12
> **Objective:** Los usuarios entran con Google (o con el login de desarrollo en `DEMO_MODE`) mediante una sesión en cookie `httpOnly` guardada en Postgres, crean su empresa, invitan miembros con un enlace, gestionan roles y cambian de empresa activa, y esa sesión reemplaza al actor demo en el API, en Socket.IO y en la web.

## Por qué existe este spec

Hasta SPEC 05, el actor sale de la cabecera `X-Demo-Member-Id`, y el tenant es siempre el tenant demo. Eso basta para local, pero impide desplegar (SPEC 08) y notificar a personas reales (SPEC 13).

Lo que la arquitectura ya fijó y aquí no se reabre (§5, §11, §17):

- Google OAuth con Passport en NestJS.
- Cookie `httpOnly`, `Secure` y `SameSite=Lax`.
- Roles `OWNER`, `ADMIN` y `AGENT`.
- El API es la autoridad, y Socket.IO reutiliza la misma sesión.
- El frontend nunca elige un `tenantId` ajeno.

## Alcance

**Dentro:**

- **Usuario global** (`User`), separado de la membresía por empresa (`TenantMember.userId`). Un usuario puede pertenecer a varias empresas.
- **Sesión en Postgres** (`Session`):
  - La cookie `omnidesk_session` lleva un token opaco de 32 bytes; en la base solo se guarda su sha256.
  - Expiración deslizante de 30 días. `lastSeenAt` se actualiza como máximo cada 5 min.
  - La sesión guarda el `activeTenantId`.
  - Es revocable en el logout y al quitar al miembro.
- **Google OAuth:**
  - `GET /api/v1/auth/google?next=/conversations` y `GET /api/v1/auth/google/callback`.
  - Crea el `User` en el primer login (por `googleSub`) y actualiza el nombre y el avatar en cada login.
  - Redirige a `next` (solo rutas relativas internas) o a `/onboarding` si el usuario no tiene membresías.
- **Login de desarrollo** (solo con `DEMO_MODE=true`):
  - `POST /api/v1/auth/dev-login { memberId }` crea una sesión real para un miembro demo.
  - La pantalla de login muestra los botones "Entrar como Sup. Demo / Laura / Mateo".
  - Se elimina `X-Demo-Member-Id`, junto con `DemoActorGuard` y `DemoTenantGuard`.
- **`GET /api/v1/me`:** el usuario, sus membresías (empresa, rol, `memberId`) y el `activeTenantId`.
- **Cambio de empresa:** `POST /api/v1/me/active-tenant { tenantId }`. Solo acepta empresas de las que el usuario es miembro activo.
- **Alta de empresa en autoservicio:**
  - `POST /api/v1/tenants { name, slug }`. Quien la crea queda como `OWNER` y la empresa pasa a ser la activa.
  - Pantalla `/onboarding` "Crea tu empresa".
- **Invitaciones por enlace** (sin email):
  - `POST /api/v1/invitations { email, role }` → `{ url }`.
    - Expira en 7 días.
    - Es de un solo uso.
    - Queda ligada al email (comparación sin mayúsculas).
  - `GET /api/v1/invitations` lista las pendientes.
  - `DELETE /api/v1/invitations/:id` revoca una.
  - `GET /api/v1/invitations/by-token/:token` devuelve una vista previa pública (empresa, rol, email enmascarado).
  - `POST /api/v1/invitations/by-token/:token/accept` requiere sesión con el mismo email.
  - Pantalla `/invite/:token`.
- **Gestión de miembros** (`/settings/members`):
  - Lista de miembros e invitaciones pendientes.
  - `PATCH /api/v1/members/:id { role }`.
  - `DELETE /api/v1/members/:id`:
    - Baja lógica (`removedAt`).
    - Revoca las sesiones del usuario cuya empresa activa es esta.
    - Libera a la IA sus conversaciones asignadas, mediante el caso de uso `release` existente con el actor que quita.
- **Permisos:**

  | Acción | OWNER | ADMIN | AGENT |
  | --- | --- | --- | --- |
  | Invitar `ADMIN` | ✓ | — | — |
  | Invitar `AGENT` | ✓ | ✓ | — |
  | Revocar invitación | ✓ | ✓ (las de `AGENT`) | — |
  | Cambiar rol | ✓ | — | — |
  | Quitar `OWNER`/`ADMIN` | ✓ | — | — |
  | Quitar `AGENT` | ✓ | ✓ | — |

  Siempre queda al menos un `OWNER`: degradarlo o quitarlo responde `409 LAST_OWNER`.
- **Guard de sesión** (`SessionGuard`):
  - Resuelve `ActorContext { userId, tenantId, memberId, role }` desde la cookie y reemplaza al actor demo en todos los controladores de `/conversations` y `/members`.
  - Sin sesión: `401 UNAUTHENTICATED`.
  - Con sesión pero sin empresa activa: `403 NO_ACTIVE_TENANT`.
- **Protección CSRF:** los métodos que modifican datos exigen que `Origin` esté en `CORS_ORIGINS`; si no, `403`. Se suma a `SameSite=Lax`.
- **Socket.IO:**
  - El handshake valida la cookie y une el socket al room `tenant:<activeTenantId>`.
  - Sin sesión válida, rechaza la conexión.
  - Al cambiar de empresa, la web reconecta.
- **Web:**
  - Rutas `/login`, `/onboarding`, `/invite/:token` y `/settings/members`.
  - `AuthGate`, que consulta `GET /me` y protege el resto de rutas.
  - Un `401` en cualquier petición limpia la caché de TanStack Query, desconecta el socket y redirige a `/login?next=<ruta actual>`.
  - El menú de usuario del rail (SPEC 06) sustituye a **Actuar como**. Incluye avatar, nombre, selector de empresa, tema, "Miembros" (OWNER/ADMIN) y "Cerrar sesión".
- **Demo:** con `DEMO_MODE=true`, la semilla crea un `User` sin `googleSub` por cada miembro demo y los enlaza.

**Fuera de alcance (para specs futuros):**

- Envío de invitaciones por email.
- Gestión de canales y credenciales de integración desde la UI (SPEC 09).
- Otros proveedores de identidad (email/contraseña, Microsoft) y 2FA.
- Lista de "sesiones activas" por dispositivo y cierre remoto selectivo.
- Rooms por conversación en Socket.IO (siguen por tenant).
- Facturación y planes.

## Modelo de datos

**Prisma (nuevo y cambios):**

```prisma
model User {
  id          String    @id @default(uuid(7)) @db.Uuid
  /// `sub` de Google; null para los usuarios demo.
  googleSub   String?   @unique @map("google_sub")
  email       String    @unique                     // guardado en minúsculas
  displayName String    @map("display_name")
  avatarUrl   String?   @map("avatar_url")
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  memberships TenantMember[]
  sessions    Session[]
  @@map("users")
}

model Session {
  id             String    @id @default(uuid(7)) @db.Uuid
  /// sha256 hex del token de la cookie.
  tokenHash      String    @unique @map("token_hash")
  userId         String    @map("user_id") @db.Uuid
  activeTenantId String?   @map("active_tenant_id") @db.Uuid
  userAgent      String?   @map("user_agent")
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  lastSeenAt     DateTime  @map("last_seen_at") @db.Timestamptz(3)
  expiresAt      DateTime  @map("expires_at") @db.Timestamptz(3)
  revokedAt      DateTime? @map("revoked_at") @db.Timestamptz(3)
  user           User      @relation(fields: [userId], references: [id])
  @@index([userId])
  @@map("sessions")
}

model Invitation {
  id          String     @id @default(uuid(7)) @db.Uuid
  tenantId    String     @map("tenant_id") @db.Uuid
  email       String                                 // minúsculas
  role        MemberRole                             // ADMIN | AGENT (OWNER no se invita)
  tokenHash   String     @unique @map("token_hash")
  invitedById String     @map("invited_by_id") @db.Uuid   // TenantMember
  createdAt   DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  expiresAt   DateTime   @map("expires_at") @db.Timestamptz(3)
  acceptedAt  DateTime?  @map("accepted_at") @db.Timestamptz(3)
  revokedAt   DateTime?  @map("revoked_at") @db.Timestamptz(3)
  @@index([tenantId])
  @@map("invitations")
}

model TenantMember {
  // … campos de SPEC 04
  userId    String?   @map("user_id") @db.Uuid      // null solo en filas previas a la migración
  removedAt DateTime? @map("removed_at") @db.Timestamptz(3)
  user      User?     @relation(fields: [userId], references: [id])
  @@unique([tenantId, userId])
}
```

- `TenantMember` no se borra físicamente. Lo referencian `Message.senderMemberId` y `ConversationEvent` (`onDelete: Restrict`), y el historial debe seguir mostrando "Laura".
- Un miembro con `removedAt` no aparece en `/members` ni en "Asignar a…", y no puede autenticarse en esa empresa.
- Volver a invitar a un email cuyo miembro está dado de baja reactiva la misma fila (`removedAt = null`, rol nuevo).

**Contratos** (`packages/contracts/src/auth.ts`, `tenants.ts`, `invitations.ts`; `members.ts` ampliado):

```ts
MeResponseSchema = {
  user: { id, email, displayName, avatarUrl: string | null },
  memberships: Array<{ memberId, tenantId, tenantName, tenantSlug, role }>,
  activeTenantId: z.uuid().nullable(),
}
SetActiveTenantRequestSchema = { tenantId: z.uuid() }
DevLoginRequestSchema = { memberId: z.uuid() }
CreateTenantRequestSchema = { name: z.string().trim().min(2).max(80),
                              slug: z.string().regex(/^[a-z0-9](-?[a-z0-9])*$/).min(3).max(40) }
CreateInvitationRequestSchema = { email: z.email(), role: z.enum(['ADMIN', 'AGENT']) }
CreateInvitationResponseSchema = { id, url: z.url(), expiresAt }
InvitationSchema = { id, email, role, invitedBy: MemberRef, createdAt, expiresAt }
InvitationPreviewSchema = { tenantName, role, emailMasked: string, expired: boolean }
UpdateMemberRoleRequestSchema = { role: MemberRoleSchema }
// Errores: UNAUTHENTICATED, NO_ACTIVE_TENANT, LAST_OWNER, INVITATION_EXPIRED,
//          INVITATION_EMAIL_MISMATCH, SLUG_TAKEN, ALREADY_MEMBER
```

**Variables de entorno** (`shared/config/env.ts`):

```
GOOGLE_CLIENT_ID=            # obligatoria con NODE_ENV=production
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:8080/api/v1/auth/google/callback
APP_URL=http://localhost:8080          # base para los enlaces de invitación y las redirecciones
SESSION_COOKIE_SECURE=false            # true obligatorio en producción
```

Sin `GOOGLE_CLIENT_ID` y con `DEMO_MODE=true`, la pantalla de login solo muestra el login de desarrollo.

## Plan de implementación

1. **Modelo y migración** `…_identity`: crear `users`, `sessions` e `invitations`, y añadir `user_id` y `removed_at` a `tenant_members`. La semilla demo crea y enlaza los `User` demo. La app sigue funcionando con el actor demo.
2. **Contratos** nuevos con pruebas.
3. **Módulo `identity`** (hexagonal: `domain`, `application`, `infrastructure`).
   - Casos de uso `CreateSession`, `ResolveSession` (deslizante) y `RevokeSession`.
   - `SessionGuard` y el decorador `@Actor()`.
   - Pruebas unitarias con reloj falso.
4. **Login de desarrollo + `GET /me` + logout.**
   - `POST /auth/dev-login`, solo con `DEMO_MODE`; si no, `404`.
   - `POST /auth/logout`.
   - Comprobación de `Origin` en los métodos que modifican datos.
   - e2e.
5. **Migrar los controladores al actor de sesión.**
   - `/conversations` y `/members` pasan de `DemoActorGuard`/`DemoTenantGuard` a `SessionGuard`.
   - Borrar los guards demo y la cabecera.
   - Los e2e existentes pasan a autenticarse con dev-login.
6. **Socket.IO con sesión.** `realtime.gateway.ts` valida la cookie en el handshake y une al room de la empresa activa. e2e: sin cookie, la conexión se rechaza.
7. **Web: autenticación.**
   - `features/auth/` (`use-me`, `AuthGate`, `login-page.tsx` con botones Google y demo).
   - El interceptor de `401` en `http-client.ts` redirige a `/login?next=`.
   - Menú de usuario en el rail.
   - Borrar `features/actor/`.
8. **Google OAuth.**
   - `passport-google-oauth20`: estrategia, `GET /auth/google` (guarda `next` en un `state` firmado) y callback.
   - Crear o actualizar el `User` y crear la sesión.
   - Prueba unitaria del mapeo del perfil y de la validación de `next`.
9. **Empresas.**
   - `POST /tenants` y `POST /me/active-tenant`.
   - Pantalla `/onboarding`.
   - Selector de empresa en el menú, que al cambiar invalida queries y reconecta el socket.
   - e2e.
10. **Invitaciones.**
    - Crear, listar, revocar, vista previa y aceptar, con sus reglas de rol, expiración, un solo uso y email.
    - Pantalla `/invite/:token`: sin sesión, "Entrar con Google para unirte a <empresa>"; con sesión, botón "Unirme".
    - e2e de cada error.
11. **Gestión de miembros.**
    - `PATCH` y `DELETE /members/:id`, con `LAST_OWNER`, revocación de sesiones y liberación de conversaciones.
    - Página `/settings/members`, con la tabla de miembros y pendientes, "Invitar" (diálogo que muestra el enlace con **Copiar**), cambio de rol y "Quitar".
    - e2e.
12. **Documentación.**
    - README: cómo crear el cliente OAuth de Google para local, el login de desarrollo y cómo sustituye a **Actuar como**.
    - `docs/arquitectura.md` §11 (rutas finales) y §14.

## Criterios de aceptación

**Sesión y login**

- [ ] Sin sesión, abrir `/conversations` redirige a `/login?next=%2Fconversations`.
- [ ] Con `DEMO_MODE=true`, "Entrar como Laura" lleva a `/conversations` con la bandeja de Laura. La cookie `omnidesk_session` es `HttpOnly` y `SameSite=Lax`.
- [ ] La tabla `sessions` guarda `token_hash`, nunca el token en claro.
- [ ] Con un cliente OAuth configurado, "Entrar con Google" completa el login. La primera vez sin membresías lleva a `/onboarding`.
- [ ] `next=https://evil.com` se ignora y redirige a `/conversations`.
- [ ] "Cerrar sesión" invalida la sesión: un `GET /me` posterior responde `401`.
- [ ] Una sesión con `expires_at` en el pasado responde `401`, y la web redirige a `/login`.
- [ ] Un `POST` con `Origin: https://otro.com` responde `403`.
- [ ] La cabecera `X-Demo-Member-Id` ya no tiene efecto, y el selector **Actuar como** no existe.

**Empresas e invitaciones**

- [ ] `POST /tenants` con un slug ya usado responde `409 SLUG_TAKEN`.
- [ ] Quien crea la empresa queda `OWNER` y la ve como activa en `GET /me`.
- [ ] Un ADMIN que invita con `role: ADMIN` recibe `403`.
- [ ] Aceptar una invitación con una sesión de otro email responde `409 INVITATION_EMAIL_MISMATCH`.
- [ ] Aceptar dos veces la misma invitación: la segunda responde `410 INVITATION_EXPIRED`. Pasados 7 días, también `410`.
- [ ] Revocar una invitación hace que su enlace muestre "Invitación no válida".
- [ ] Un usuario con dos empresas cambia la activa desde el menú. La lista muestra solo las conversaciones de la nueva empresa en ≤ 1 s y el socket se une a su room.

**Miembros y permisos**

- [ ] El único OWNER que intenta degradarse recibe `409 LAST_OWNER`.
- [ ] Quitar a Laura con dos conversaciones asignadas las devuelve a la bandeja IA, con el evento "Sup. Demo liberó la conversación". La sesión activa de Laura recibe `401` en su siguiente petición.
- [ ] Los mensajes antiguos de Laura siguen mostrando "Laura" tras quitarla.
- [ ] Un AGENT no ve "Miembros" en el menú, y `GET /invitations` le responde `403`.

**Tiempo real**

- [ ] Un cliente Socket.IO sin cookie no se conecta. Con cookie, recibe solo los eventos de su empresa activa.

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0, y el e2e del API pasa.
- [ ] `pnpm simulate` y `pnpm simulate --live` siguen funcionando sin cambios (credencial de canal).

## Decisiones

- **Sí:** sesión opaca en la tabla `sessions` de Postgres. Es revocable al momento (logout, quitar miembro), y Socket.IO la valida igual que HTTP. Lo decidió el equipo.
- **No:** JWT en cookie. No se puede revocar antes de que expire.
- **Sí:** `User` global + `TenantMember.userId`, con selector de empresa activa en la sesión. Lo decidió el equipo; cambiarlo después obligaría a migrar datos.
- **Sí:** las rutas usan la empresa activa de la sesión (`/invitations`, `/members`), no `/tenants/:id/...` como decía el borrador de §11. Así el cliente nunca envía un `tenantId` en las operaciones de una empresa.
- **Sí:** invitaciones por enlace copiado, ligadas al email, de un solo uso y con 7 días de vigencia. Sin proveedor de email por ahora. Lo decidió el equipo.
- **Sí:** el `DEMO_MODE` se convierte en login de desarrollo con sesiones reales. Permite probar en local, y en los E2E de SPEC 10, sin credenciales de Google. Lo decidió el equipo.
- **Sí:** alta de empresa en autoservicio para cualquier usuario de Google. Lo decidió el equipo.
- **Sí:** baja lógica de miembros (`removedAt`). Las FK del historial son `Restrict`, y el nombre del autor debe conservarse.
- **Sí:** al quitar a un miembro, sus conversaciones vuelven a la IA con el caso de uso `release` existente. Reutiliza `controlVersion` y los eventos, y ninguna conversación queda huérfana.
- **Sí:** comprobación de `Origin` además de `SameSite=Lax`. Es defensa en profundidad barata para los `POST` JSON.
- **Sí:** ante un `401`, redirección global a `/login?next=`. Lo decidió el equipo. Un modal de re-login complica el OAuth por redirección en iOS standalone.
- **No:** gestión de canales en este spec. Va en SPEC 09 con la integración real. Lo decidió el equipo.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El OAuth por redirección no vuelve a la PWA instalada en iOS (pendiente de §17) | El flujo es de página completa dentro de la PWA (`window.location`), sin popups. Se verifica en SPEC 08 en un iPhone real. Si falla, se anota la alternativa (Google Identity Services con credencial por `POST`) como decisión pendiente. |
| La migración deja `tenant_members` sin `user_id` | Solo pasa con los miembros demo, que la semilla enlaza. `user_id` es nullable, y `SessionGuard` exige membresía con usuario. |
| Fijación de sesión o robo del token | Token aleatorio de 32 bytes, guardado como hash. Se regenera en cada login. `HttpOnly` + `Secure` en producción. |
| Carrera al quitar al último OWNER desde dos pestañas | La comprobación de `LAST_OWNER` se hace dentro de la transacción con `SELECT … FOR UPDATE` sobre los OWNER de la empresa. |
| Enlace de invitación filtrado | Ligado al email de Google, de un solo uso y con expiración de 7 días. Revocable desde la UI. |

## Lo que **no** entra en este spec

- Invitaciones por email.
- Canales y credenciales en la UI (SPEC 09).
- Otros proveedores de identidad y 2FA.
- Sesiones por dispositivo y cierre remoto selectivo.
- Rooms por conversación.

Cada uno llega en su propio spec.
