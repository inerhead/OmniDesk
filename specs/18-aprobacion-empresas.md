# SPEC 18 — Aprobación de empresas y suspensión por el admin de plataforma

> **Status:** Approved
> **Depends on:** SPEC 07, SPEC 12, SPEC 13, SPEC 16
> **Date:** 2026-10-15
> **Objective:** Toda empresa nueva queda "En revisión" hasta que un admin de plataforma (email en `PLATFORM_ADMIN_EMAILS`) la aprueba o la rechaza con motivo desde `/platform`, donde también puede suspender y levantar la suspensión de una empresa aprobada.

## Por qué existe este spec

Hoy cualquiera que entra con Google crea una empresa al momento con `POST /api/v1/tenants` y empieza a usarla. No hay forma de decidir quién se da de alta en OmniDesk, ni de cortar a una empresa desde fuera.

Tampoco existe la figura de admin de plataforma. Los únicos roles son los de cada empresa (`OWNER`, `ADMIN`, `AGENT`, SPEC 07). La inactivación de SPEC 16 la decide el Owner, y él mismo la revierte.

Este spec añade las dos piezas que faltan:

- **Aprobación:** la empresa se crea, pero no sirve hasta que la plataforma la aprueba.
- **Suspensión:** la plataforma corta una empresa aprobada, y solo la plataforma la devuelve.

Lo que ya fijaron otros specs y aquí no se reabre:

- El API es la autoridad y el cliente nunca elige un `tenantId` ajeno (SPEC 07).
- Las rutas de empresa usan la empresa activa de la sesión (SPEC 07).
- RLS por empresa con el rol `omnidesk_app`. Los caminos de sistema usan `PrismaService` (rol dueño, SPEC 12).
- Los efectos de una empresa cortada: lo entrante se guarda, sin IA, sin push y sin envíos (SPEC 16).

## Alcance

**Dentro:**

- **Admin de plataforma:**
  - Se define por email en la variable `PLATFORM_ADMIN_EMAILS`, separada por comas. Se compara en minúsculas y sin espacios.
  - No es un rol de empresa ni una columna. Se calcula en cada petición a partir del email del `User` de la sesión.
  - Con `DEMO_MODE=true` se añade a la lista el usuario demo `platform-admin@demo.omnidesk.local`.
  - Con la lista vacía, el API arranca igual y registra un aviso. Las solicitudes se quedan en revisión.
- **Alta de empresa (`POST /api/v1/tenants`), cambia:**
  - La empresa se crea en `PENDING`, con quien la pide como `OWNER`, y pasa a ser la empresa activa de su sesión, como hoy.
  - Si quien la pide es admin de plataforma, se crea `APPROVED` directamente.
  - **Datos de contacto** (añadidos el 2026-10-15, durante la implementación):
    - `contactPhone` es obligatorio: un móvil en formato E.164 (`E164Schema`, p. ej. `+573001234567`). Sin él, o con otro formato, responde `400`.
    - `contactEmail` no se pide: el API guarda el email del `User` de la sesión, el de su login.
    - Los dos quedan fijos en la empresa. Nadie los edita desde la app.
  - Se mantiene `canCreateTenant` (sin empresas, o Owner en alguna). Ser Owner de una empresa aprobada no exime de la revisión.
  - Si el usuario ya es Owner de una empresa `PENDING`, responde `409 REQUEST_PENDING`.
  - El slug queda reservado mientras está en revisión: otro alta con ese slug responde `409 SLUG_TAKEN`, como hoy.
  - Encola un push a cada admin de plataforma con suscripción: "Nueva solicitud de empresa" / "<nombre> · <email del solicitante>", que abre `/platform`.
  - Al crearla, borra el aviso de rechazo que tuviera el usuario (ver Rechazo).
- **Empresa en revisión (`PENDING`):**
  - **Acceso:** todo el API de empresa responde `403 TENANT_PENDING`, incluidas las rutas `@AllowInactiveTenant()` de SPEC 16. El gateway no deja unirse a su sala.
  - **Web, sin otras empresas:** `/onboarding` muestra la pantalla de espera "Solicitud en revisión" con el nombre, el slug y la fecha de envío.
  - **Web, con otras empresas:** la empresa aparece en el selector como "En revisión". Al elegirla, cualquier ruta muestra la pantalla de espera.
  - **Actualización:** la pantalla de espera vuelve a pedir `/me` cada 30 s y al recuperar el foco. Al aprobarse, la app entra a `/conversations`. Al rechazarse, pasa a la pantalla de rechazo.
  - No se puede cancelar ni editar la solicitud.
- **Aprobar (`POST /api/v1/platform/tenants/:id/approve`):**
  - Solo con la empresa en `PENDING`; si no, `409 NOT_PENDING`.
  - Fija `approvedAt` y `approvedByUserId`, y pasa a `APPROVED`.
  - Encola un push al solicitante: "Empresa aprobada" / "Ya puedes usar <nombre>", que abre `/conversations`.
- **Rechazar (`POST /api/v1/platform/tenants/:id/reject { reason }`):**
  - Solo con la empresa en `PENDING`; si no, `409 NOT_PENDING`.
  - Motivo obligatorio de 5 a 500 caracteres.
  - En una transacción:
    1. Crea un `TenantRejection` con el nombre, el slug, el solicitante, el motivo, quién rechazó y las fechas.
    2. Borra la membresía y la empresa. El slug queda libre al momento.
    3. Encola un push al solicitante: "Solicitud rechazada" / "<nombre>: <motivo>", que abre `/onboarding`.
  - Las sesiones que tenían esa empresa activa caen a la siguiente con el mecanismo actual de `GetMeUseCase`.
- **Pantalla de rechazo:**
  - `/onboarding` muestra "Tu solicitud para <nombre> fue rechazada", el motivo, la fecha y el botón "Enviar otra solicitud", que abre el formulario de alta.
  - Si el usuario tiene otras empresas, el rechazo se ve una sola vez como aviso en la app, con "Entendido".
  - El aviso desaparece al enviar otra solicitud o al cerrarlo (`POST /api/v1/me/tenant-rejection/dismiss`).
  - El job de retención de SPEC 12 borra los `TenantRejection` de más de 20 días.
- **Suspender (`POST /api/v1/platform/tenants/:id/suspend { reason }`):**
  - Solo con la empresa en `APPROVED`; si no, `409 NOT_APPROVED`. Lo mismo al levantarla.
  - Motivo obligatorio de 5 a 500 caracteres.
  - Fija `suspendedAt`, `suspendedByUserId` y `suspensionReason`, y encola `tenant.status_changed { active: false }`.
  - Suspender una empresa ya suspendida responde `200` sin cambios.
  - Es independiente de la inactivación del Owner. Una empresa puede estar las dos cosas; la suspensión manda.
- **Con la empresa suspendida:**
  - **Acceso:** todos los roles, Owner incluido, la siguen viendo en `/me` y en el selector, marcada "Suspendida". Al elegirla, cualquier ruta muestra "Empresa suspendida por la plataforma", el motivo y la fecha, sin acciones.
  - **API:** todo el API de empresa responde `403 TENANT_SUSPENDED`, incluidas las rutas `@AllowInactiveTenant()`. El gateway no deja unirse a su sala.
  - **Sesiones:** la empresa activa de la sesión cae a la primera empresa usable. Si no hay ninguna, se queda en la suspendida y se ve el aviso.
  - **Tiempo real:** las apps abiertas reciben `tenant.status_changed` y vuelven a pedir `/me`, como en SPEC 16.
  - **Atención y envíos:** los mismos cortes que SPEC 16 (entrante guardado, sin IA ni push, la IA recibe `409 { sendAllowed: false, reason: 'TENANT_SUSPENDED' }`). El dispatcher marca `FAILED` los `message.send_requested` con motivo `TENANT_SUSPENDED`.
  - **Invitaciones:** aceptar una de esa empresa responde `409 TENANT_SUSPENDED`. Las pendientes no se revocan.
- **Levantar la suspensión (`POST /api/v1/platform/tenants/:id/unsuspend`).** En una transacción:
  1. Limpia `suspendedAt`, `suspendedByUserId` y `suspensionReason`.
  2. Si la empresa no está inactiva por el Owner, reencola los `FAILED` con `TENANT_SUSPENDED` que cumplen la regla de SPEC 16 (conversación abierta y `canSendNow`).
  3. Si está inactiva, los pasa a motivo `TENANT_INACTIVE`, para que los reencole la reactivación del Owner.
  4. Encola `tenant.status_changed`.
  - Repetirlo responde `200` sin cambios.
- **Panel `/platform`** (solo admins de plataforma):
  - Fuera del contexto de empresa: no necesita empresa activa.
  - Entrada "Plataforma" en el menú del avatar, solo para admins, con un contador de solicitudes pendientes.
  - Un admin sin empresas entra a `/platform` en lugar de `/onboarding`.
  - Pestañas con `SegmentedControl`, en la URL (`?tab=approved` / `?tab=rejected`; sin parámetro, Pendientes):
    - **Pendientes (n):** empresa, slug, solicitante (nombre y email), teléfono y email de contacto, fecha. Acciones "Aprobar" y "Rechazar". Rechazar abre un diálogo con el motivo.
    - **Aprobadas (n):** empresa, slug, Owner, teléfono y email de contacto, fecha de aprobación, estado ("Activa", "Inactiva" o "Suspendida"). Acción "Suspender" (diálogo con motivo) o "Levantar suspensión" (`ConfirmDialog`).
    - **Rechazadas (n):** empresa, slug, solicitante, motivo y fecha, de los últimos 20 días. Sin acciones.
  - Estados: cargando con skeleton de filas, error con "Reintentar" y vacío por pestaña ("No hay solicitudes pendientes", …).
  - Tras cada acción, la lista y el contador se vuelven a pedir.
- **Contacto en `/settings/company`** (SPEC 16, solo Owner): bloque "Contacto" de solo lectura con el teléfono y el email de la empresa. Sin datos (empresas anteriores a este spec), muestra "Sin datos de contacto".
- **Endpoints de plataforma** (`/api/v1/platform/*`, `PlatformAdminGuard`). Para quien no es admin responden `404`:
  - `GET /api/v1/platform/tenants?status=pending|approved|rejected` → `PlatformTenantRow[]`.
  - `POST /api/v1/platform/tenants/:id/approve`, `/reject`, `/suspend` y `/unsuspend`.
  - Leen y escriben con `PrismaService` (camino de sistema): cruzan empresas.
- **`/me`, amplía:**
  - `isPlatformAdmin: boolean`.
  - `platformPendingCount: number | null` (null si no es admin).
  - `tenantRejection: { tenantName, reason, rejectedAt } | null`.
  - Cada membresía gana `tenantState: 'active' | 'inactive' | 'pending' | 'suspended'` y `suspensionReason`. `tenantActive` se mantiene y es `true` solo con `active`.
- **Push de plataforma:** un tipo nuevo de Outbox, `platform.push_requested { userIds, title, body, url, tag }`. El dispatcher lo entrega aunque la empresa del evento no esté activa o ya no exista. No pasa por las preferencias de miembro de SPEC 13.
- **Login de desarrollo** (solo `DEMO_MODE=true`):
  - La semilla crea dos usuarios demo sin empresa: "Admin de plataforma" (`platform-admin@demo.omnidesk.local`) y "Usuario nuevo" (`new-user@demo.omnidesk.local`).
  - `/login` muestra "Entrar como Admin de plataforma" y "Entrar como usuario nuevo".
  - `POST /api/v1/auth/dev-login` acepta `{ memberId }` o `{ demoUser: 'platform-admin' | 'new-user' }`.
  - La empresa demo se siembra `APPROVED`.
- **Migración:** todas las empresas existentes, incluida la demo, quedan `APPROVED`.

**Fuera:**

- Gestionar admins de plataforma desde la app, o guardarlos en la base.
- Avisos por email (no hay infraestructura de email).
- Aviso en tiempo real por socket al solicitante. Se usan push y la consulta periódica de `/me`.
- Cancelar o editar una solicitud pendiente.
- Ver los datos de una empresa ajena (conversaciones, miembros, métricas) desde `/platform`.
- Borrar empresas aprobadas desde `/platform`, o inactivarlas en nombre del Owner.
- Historial de suspensiones.
- Rechazar en lote, o aprobar solo por dominio de email.
- Editar el teléfono o el email de contacto, o verificar el teléfono (SMS, WhatsApp).
- Mostrar los datos de contacto a Admin o Agent.

## Modelo de datos

**Prisma:**

```prisma
enum TenantApproval {
  PENDING
  APPROVED
}

model Tenant {
  // … campos de SPEC 07, 12 y 16 sin cambios
  /// PENDING hasta que la plataforma la aprueba (SPEC 18).
  approval          TenantApproval @default(PENDING)
  approvedAt        DateTime?      @map("approved_at") @db.Timestamptz(3)
  approvedByUserId  String?        @map("approved_by_user_id") @db.Uuid
  /// null = no suspendida.
  suspendedAt       DateTime?      @map("suspended_at") @db.Timestamptz(3)
  suspendedByUserId String?        @map("suspended_by_user_id") @db.Uuid
  suspensionReason  String?        @map("suspension_reason")
  /// Móvil E.164 del solicitante; null en empresas anteriores a SPEC 18.
  contactPhone      String?        @map("contact_phone")
  /// Email de login del solicitante al pedir el alta; null en empresas anteriores a SPEC 18.
  contactEmail      String?        @map("contact_email")

  approvedBy  User? @relation("TenantApprovedBy", fields: [approvedByUserId], references: [id], onDelete: SetNull)
  suspendedBy User? @relation("TenantSuspendedBy", fields: [suspendedByUserId], references: [id], onDelete: SetNull)
}

/// Solicitud rechazada (SPEC 18). La empresa se borra; queda esto para el aviso y la pestaña Rechazadas.
model TenantRejection {
  id               String    @id @default(uuid(7)) @db.Uuid
  userId           String    @map("user_id") @db.Uuid
  tenantName       String    @map("tenant_name")
  tenantSlug       String    @map("tenant_slug")
  reason           String
  requestedAt      DateTime  @map("requested_at") @db.Timestamptz(3)
  rejectedAt       DateTime  @map("rejected_at") @db.Timestamptz(3)
  rejectedByUserId String?   @map("rejected_by_user_id") @db.Uuid
  /// El solicitante cerró el aviso o envió otra solicitud.
  dismissedAt      DateTime? @map("dismissed_at") @db.Timestamptz(3)
  contactPhone     String?   @map("contact_phone")
  contactEmail     String?   @map("contact_email")

  user       User  @relation("TenantRejectionUser", fields: [userId], references: [id], onDelete: Cascade)
  rejectedBy User? @relation("TenantRejectionBy", fields: [rejectedByUserId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([rejectedAt])
  @@map("tenant_rejections")
}
```

- **Migración:** añade `approval` con valor `APPROVED` para las filas existentes y después cambia el default a `PENDING`. Una empresa nueva queda en revisión salvo que el código diga lo contrario (falla cerrado).
- `contactPhone` y `contactEmail` son nulos en la base para no tocar las empresas existentes. El API exige el teléfono en cada alta nueva.
- `TenantRejection` gana `contactPhone` y `contactEmail` (copia), para mostrarlos en la pestaña Rechazadas.
- `tenant_rejections` no tiene `tenant_id` y no lleva RLS. Se lee con `PrismaService`: por usuario en `/me`, y entera en `/platform`.
- Solicitud pendiente de un usuario = empresa `PENDING` donde es `OWNER`. No hay tabla de solicitudes.

**Estado efectivo** (`tenant/domain/tenant-state.ts`), en este orden:

```ts
export type TenantState = 'pending' | 'suspended' | 'inactive' | 'active';
// approval === 'PENDING' → 'pending'; suspendedAt → 'suspended'; deactivatedAt → 'inactive'; si no, 'active'.
```

- `TenantStatusReader` (SPEC 16) gana `state(tenantId): Promise<TenantState | null>`. `isActive` pasa a ser `state === 'active'`.
- La empresa de respaldo de la sesión es la primera `active` (orden por nombre, como hoy). Si no hay, la primera `pending` o `suspended`. Si no hay ninguna, `/onboarding`.

**Contratos (`@omnidesk/contracts`):**

```ts
// platform.ts (nuevo)
export const PlatformReasonSchema = z.string().trim().min(5).max(500);
export const PlatformReasonRequestSchema = z.object({ reason: PlatformReasonSchema });
export const PlatformTenantStatusQuerySchema = z.enum(['pending', 'approved', 'rejected']);

export const PlatformTenantRowSchema = z.object({
  /** id de la empresa; en `rejected`, el del `TenantRejection`. */
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  requester: z.object({ displayName: z.string(), email: z.string() }),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  requestedAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  rejectedAt: z.iso.datetime().nullable(),
  rejectionReason: z.string().nullable(),
  /** Solo en `approved`. */
  state: z.enum(['active', 'inactive', 'suspended']).nullable(),
  suspensionReason: z.string().nullable(),
});

// auth.ts — MeResponseSchema gana:
isPlatformAdmin: z.boolean().default(false),
platformPendingCount: z.number().int().nullable().default(null),
tenantRejection: z
  .object({ tenantName: z.string(), reason: z.string(), rejectedAt: z.iso.datetime() })
  .nullable()
  .default(null),
// MembershipSchema gana:
tenantState: z.enum(['active', 'inactive', 'pending', 'suspended']).default('active'),
suspensionReason: z.string().nullable().default(null),

// auth.ts — DevLoginRequestSchema pasa a unión:
// { memberId: uuid } | { demoUser: 'platform-admin' | 'new-user' }

// tenants.ts — CreateTenantRequestSchema gana:
contactPhone: E164Schema,
// TenantSchema (respuesta de POST /tenants) gana:
approval: z.enum(['PENDING', 'APPROVED']),
// TenantDetailsSchema (SPEC 16) gana:
contactPhone: z.string().nullable(),
contactEmail: z.string().nullable(),

// errors.ts — códigos nuevos:
// 'TENANT_PENDING' | 'TENANT_SUSPENDED' | 'REQUEST_PENDING' | 'NOT_PENDING' | 'NOT_APPROVED'
```

- `E164Schema` ya existe en `integrations.ts`; se reutiliza.
- `TENANT_SUSPENDED_REASON = 'TENANT_SUSPENDED'` es el `failureReason` de los mensajes cortados por la suspensión.
- `/me` solo calcula `platformPendingCount` para admins: una consulta `count` de empresas `PENDING`.

## Plan de implementación

1. **Configuración.** `PLATFORM_ADMIN_EMAILS` en `shared/config/env.ts` (opcional, lista normalizada), y el demo añadido con `DEMO_MODE`. Helper `isPlatformAdmin(email)` en `shared/application/platform-admins.ts`. Aviso al arrancar con la lista vacía. Variable en `.env.example` y en `infra/deploy/.env.*.example`. Pruebas unitarias del parseo.
2. **Modelo y contratos.** Migración de `Tenant` (incluidos `contact_phone` y `contact_email`) y `tenant_rejections` con el backfill `APPROVED`. Esquemas de arriba con `default`, para no romper la web actual. La semilla demo crea la empresa `APPROVED`.
3. **Estado efectivo.** `tenant-state.ts` con sus pruebas. `PrismaTenantStatus.state()`, e `isActive` sobre él. `ResolveActor` lee `approval` y `suspendedAt` en su misma consulta. `SessionGuard` responde `403 TENANT_PENDING` / `TENANT_SUSPENDED` antes de la excepción de `@AllowInactiveTenant()`. El gateway rechaza la sala de empresas `pending` y `suspended`.
4. **`/me` y sesión.** `tenantState`, `suspensionReason`, `isPlatformAdmin`, `platformPendingCount` y `tenantRejection`. Respaldo de la empresa activa según la regla de arriba. `POST /me/tenant-rejection/dismiss`. Pruebas de `GetMeUseCase`.
5. **Alta en revisión.** `CreateTenantUseCase` crea `PENDING` (o `APPROVED` para un admin), guarda `contactPhone` y el email del usuario como `contactEmail`, responde `REQUEST_PENDING` y descarta el aviso de rechazo. `GET /tenants/current` devuelve los datos de contacto. E2E: alta normal, alta de admin, sin teléfono o con uno no E.164 (`400`), segunda solicitud y slug reservado.
6. **Push de plataforma.** Tipo `platform.push_requested` en el Outbox. El dispatcher lo entrega con `DeliverPushUseCase` a las suscripciones de los `userIds` y no mira el estado de la empresa. El alta encola el aviso a los admins. Prueba del dispatcher con la empresa en revisión y con la empresa borrada.
7. **Aprobar y rechazar.** Módulo `modules/platform/` con `PlatformAdminGuard` (`404` a quien no es admin), `GET /platform/tenants` y los casos de uso de aprobar y rechazar (transacción, `TenantRejection`, borrado y push). E2E: guard, `NOT_PENDING`, motivo corto, slug libre tras rechazar y sesión que cae a otra empresa.
8. **Suspender y levantar.** Casos de uso con `tenant.status_changed`. El dispatcher usa `TENANT_SUSPENDED` cuando el estado es `suspended`. La IA y las invitaciones responden `409 TENANT_SUSPENDED`. Al levantar, reencola o pasa a `TENANT_INACTIVE` según el estado del Owner. E2E con la empresa solo suspendida y suspendida e inactiva.
9. **Retención.** El job de SPEC 12 borra los `tenant_rejections` con `rejected_at` de más de 20 días. Prueba del store.
10. **Login de desarrollo.** Usuarios demo nuevos en la semilla, `dev-login` con `demoUser`, y `/auth/providers` con los dos botones nuevos.
11. **Web: solicitud, espera y rechazo.** `onboarding-page.tsx` muestra el formulario (con el campo obligatorio "Teléfono móvil", validado con `E164Schema`, y el email de login como dato informativo), la pantalla de espera o la de rechazo según `/me`. Consulta cada 30 s y al recuperar el foco solo en la espera. Aviso "Entendido" en `AppLayout` cuando hay `tenantRejection` y otras empresas.
12. **Web: estados en el selector.** "En revisión" y "Suspendida" en `account-menu-items.tsx`. `AppLayout` lleva cualquier ruta a la pantalla de espera o al aviso de suspensión según `tenantState`.
13. **Web: `/platform` y contacto.** Bloque "Contacto" de solo lectura en `company-page.tsx`. `features/platform/` con `platform-page.tsx`, `platform-api.ts`, `reject-dialog.tsx` y `suspend-dialog.tsx`. Ruta en `router.tsx` fuera del requisito de empresa activa. Entrada "Plataforma" con contador en el menú del avatar. `AuthGate` lleva al admin sin empresas a `/platform`.
14. **Documentación.** `PLATFORM_ADMIN_EMAILS` en el README y en `docs/` de despliegue. Sección "Verificación de implementación" en este spec.

## Criterios de aceptación

- [ ] Un usuario sin empresas que envía el formulario de alta ve "Solicitud en revisión" con el nombre, el slug y la fecha.
- [x] Con una empresa `PENDING`, `GET /conversations` y `GET /tenants/current` responden `403 TENANT_PENDING`.
- [x] `POST /tenants` sin `contactPhone`, o con uno que no es E.164, responde `400` y no crea nada.
- [x] La empresa creada guarda el teléfono enviado y el email de login del solicitante como `contactEmail`.
- [ ] Las pestañas Pendientes, Aprobadas y Rechazadas muestran el teléfono y el email de contacto.
- [ ] Un Owner ve el bloque "Contacto" de solo lectura en `/settings/company`. Una empresa anterior a este spec muestra "Sin datos de contacto".
- [x] Un segundo `POST /tenants` del mismo usuario con una solicitud pendiente responde `409 REQUEST_PENDING`.
- [x] Otro usuario que pide el slug de una empresa en revisión recibe `409 SLUG_TAKEN`.
- [ ] Un `POST /tenants` de un admin de plataforma crea la empresa `APPROVED` y lleva a `/conversations`.
- [ ] Un admin con push activado recibe "Nueva solicitud de empresa" al crearse una solicitud.
- [ ] Un usuario que no es admin recibe `404` en `GET /platform/tenants` y no ve "Plataforma" en el menú.
- [ ] Un admin ve "Plataforma" con el contador de pendientes, y un admin sin empresas entra a `/platform` tras el login.
- [ ] Aprobar desde `/platform` hace que la pantalla de espera del solicitante entre a `/conversations` en menos de 35 s sin recargar.
- [x] Aprobar o rechazar una empresa que no está `PENDING` responde `409 NOT_PENDING`.
- [x] Rechazar sin motivo o con menos de 5 caracteres responde `400` y no cambia nada.
- [x] Rechazar borra la empresa y su membresía, y el slug queda libre: un alta nueva con ese slug responde `201`.
- [ ] Tras un rechazo, `/onboarding` muestra el motivo y "Enviar otra solicitud". Enviar otra hace desaparecer el aviso.
- [ ] Un usuario rechazado que pertenece a otra empresa ve el aviso una vez y, tras "Entendido", no vuelve a verlo.
- [x] La pestaña Rechazadas no muestra rechazos de más de 20 días, y el job de retención los borra de `tenant_rejections`.
- [x] Suspender sin motivo responde `400`. Suspender una empresa no aprobada responde `409 NOT_APPROVED`.
- [ ] Tras suspender, un Owner y un Agent con la app abierta ven "Empresa suspendida por la plataforma" con el motivo en menos de 5 s, y el API les responde `403 TENANT_SUSPENDED`, incluso en `/tenants/current`.
- [x] Con la empresa suspendida, un WhatsApp entrante se guarda sin `ai.reply_requested` ni `notification.requested`, y un envío en cola termina `FAILED` con `TENANT_SUSPENDED`.
- [x] Con la empresa suspendida, la IA recibe `409 { sendAllowed: false, reason: 'TENANT_SUSPENDED' }` y aceptar una invitación responde `409 TENANT_SUSPENDED`.
- [x] Levantar la suspensión devuelve el acceso y reencola los `TENANT_SUSPENDED` con la ventana de 18 h abierta.
- [x] Levantar la suspensión de una empresa también inactiva la deja inactiva, y sus `TENANT_SUSPENDED` pasan a `TENANT_INACTIVE`. Reactivarla después (SPEC 16) los reencola.
- [x] Suspender o levantar dos veces seguidas responde `200` y no duplica eventos ni reencolados.
- [x] Tras la migración, todas las empresas existentes y la demo están `APPROVED` y funcionan igual que antes.
- [x] Con `DEMO_MODE=true`, "Entrar como usuario nuevo" permite enviar una solicitud, y "Entrar como Admin de plataforma" permite aprobarla.
- [x] Lint, typecheck, test, build y e2e pasan.

## Decisiones tomadas y descartadas

- **Sí: admins de plataforma por variable de entorno** (elegido por el usuario). Cambiarlos exige redesplegar, y eso evita que alguien se dé el permiso desde la app. Se descartaron un flag en la base y la combinación de ambos.
- **Sí: la empresa existe en `PENDING` mientras espera** (elegido por el usuario), con el solicitante ya como Owner. Reutiliza el corte de acceso de SPEC 16 y reserva el slug. Se descartó una tabla de solicitudes aparte.
- **Sí: rechazar borra la empresa** (elegido por el usuario) y deja un `TenantRejection` para el aviso y la pestaña Rechazadas. Se descartó reenviar la misma empresa corregida.
- **Sí: los rechazos se guardan 20 días** (elegido por el usuario), con el job de SPEC 12.
- **Sí: motivo obligatorio al rechazar y al suspender** (elegido por el usuario), de 5 a 500 caracteres.
- **Sí: pantalla de espera con reintento tras el rechazo** (elegido por el usuario). Se descartaron no permitir reintentos y poder cancelar o editar la solicitud.
- **Sí: todos piden aprobación salvo el admin** (elegido por el usuario), incluido quien ya es Owner de otra empresa aprobada.
- **Sí: una solicitud pendiente por usuario** (elegido por el usuario). Evita el spam de solicitudes.
- **Sí: la pendiente se ve en el selector como "En revisión"** (elegido por el usuario) cuando el usuario tiene otras empresas.
- **Sí: suspender es un corte total y aparte de la inactivación** (elegido por el usuario). El Owner tampoco entra y no puede revertirla. Va en `suspendedAt`, separado de `deactivatedAt`, para no pisar la decisión del Owner.
- **Sí: motivo y reencolado al levantar la suspensión** (elegido por el usuario), con la regla de la ventana de 18 h de SPEC 16.
- **Sí: `TENANT_SUSPENDED` como motivo propio de fallo.** Así reactivar (SPEC 16) y levantar la suspensión no reencolan lo que corresponde al otro.
- **Sí: push y consulta periódica para avisar al solicitante** (elegido por el usuario). Se descartó una sala por usuario en Socket.IO.
- **Sí: push y contador para avisar al admin** (elegido por el usuario). Se descartó el email: no hay infraestructura.
- **Sí: `/platform` con entrada en el menú del avatar** (elegido por el usuario). Se descartó un icono en el rail.
- **Sí: el panel solo gestiona solicitudes y suspensiones** (elegido por el usuario). Ver los datos de una empresa ajena va en otro spec.
- **Sí: login de desarrollo para el admin y para un usuario nuevo** (elegido por el usuario), frente a probar solo con cuentas de Google.
- **Sí: `404` en `/platform/*` para quien no es admin.** No revela que el panel existe.
- **Sí: default `PENDING` en la columna** tras el backfill. Si un camino nuevo crea empresas sin pensar en la revisión, quedan cerradas en vez de abiertas.
- **Sí: push de plataforma como tipo propio de Outbox.** Los push de SPEC 13 son por miembro y se descartan con la empresa no activa. Estos van a usuarios y deben salir aunque la empresa esté en revisión o ya borrada.
- **Sí: teléfono móvil obligatorio en E.164 al pedir el alta** (elegido por el usuario el 2026-10-15, durante la implementación). Reutiliza `E164Schema`, el mismo formato que los números de WhatsApp.
- **Sí: el email de contacto es el de login, copiado en la empresa.** Lo pidió el usuario ("su correo con el cual se loguea"). Es una copia: si el usuario cambia de email en Google, la empresa conserva el que tenía al pedir el alta.
- **Sí: contacto visible para el Owner y la plataforma** (elegido por el usuario), de solo lectura. Admin y Agent no lo ven, y nadie lo edita en este spec.
- **No: guardar el admin en la membresía o como rol.** El admin de plataforma no es miembro de las empresas que revisa.

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| `PLATFORM_ADMIN_EMAILS` vacío o mal escrito en producción: nadie aprueba. | Aviso en el log al arrancar con la lista vacía. Documentado en el README y en el `.env` de despliegue. |
| Alguien controla una cuenta de Google con un email de la lista. | El email lo verifica Google al hacer login (SPEC 07). La lista solo se cambia redesplegando. |
| Un camino que crea empresas (semilla, pruebas) olvida la aprobación. | El default de la columna es `PENDING` (falla cerrado). La semilla demo fija `APPROVED` y lo prueba el e2e de la demo. |
| El rechazo borra una empresa que tiene filas en otras tablas. | En `PENDING` todo el API de empresa responde `403`, así que solo existen la empresa y la membresía. El borrado falla si hay más, y se prueba en el e2e. |
| La sesión del solicitante apunta a una empresa borrada. | `Session.activeTenantId` no tiene FK. `GetMeUseCase` ya cae a otra empresa cuando la activa no es válida. |
| El dispatcher descarta el push del rechazo porque la empresa ya no existe. | `platform.push_requested` no pasa por el chequeo de estado (paso 6), con prueba de la empresa borrada. |
| La consulta del estado añade trabajo a cada petición con sesión. | `ResolveActor` amplía su consulta de membresía con `approval` y `suspendedAt`, igual que SPEC 16 con `deactivatedAt`. |
| Las consultas de `/platform` cruzan empresas y RLS las bloquearía. | Usan `PrismaService` (camino de sistema, SPEC 12), solo detrás de `PlatformAdminGuard`. |

## Qué **no** entra en este spec

- Gestión de admins de plataforma desde la app o en la base.
- Avisos por email.
- Aviso al solicitante en tiempo real por socket.
- Cancelar o editar una solicitud pendiente.
- Ver conversaciones, miembros o métricas de una empresa ajena.
- Borrar empresas aprobadas o inactivarlas en nombre del Owner.
- Historial de suspensiones.
- Acciones en lote o aprobación automática por dominio.
- Editar o verificar los datos de contacto, o mostrarlos a Admin y Agent.

Cada uno de esos, si llega, va en su propio spec.

## Verificación de implementación

2026-10-15, rama `spec-18-aprobacion-empresas`.

Automatizado, en verde:

- `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` en todo el monorepo: 399 unitarias del API, 164 de la web y 117 de contratos. El único aviso de lint (`main.tsx`) ya estaba en `main`.
- `pnpm --filter @omnidesk/api test:e2e` desde el host contra el Postgres local (`_e2e`), dos ejecuciones seguidas: 242 pasaron y 1 se saltó (el de MinIO). `test/platform.e2e-spec.ts` aporta 22 pruebas, y `test/retention.e2e-spec.ts` una más.
- La migración `20261024000000_tenant_approval` se aplicó en la base de desarrollo: `acme-sas` y `demo` quedaron `APPROVED`.
- Prueba de humo por el gateway local con los usuarios demo: alta `PENDING` → `403 TENANT_PENDING` → aprobar → `active`; alta → rechazar → aviso en `/me` → `dismiss` `204`; `404` en `/platform` para quien no es admin.

Los criterios marcados arriba los cubren esas pruebas. Los demás dependen de la web, el tiempo real o un push en un dispositivo, y quedan para la revisión manual:

- **Espera:** la pantalla con nombre, slug y fecha, y la entrada a `/conversations` en menos de 35 s.
- **Rechazo:** la pantalla de `/onboarding` y el aviso con "Entendido".
- **Panel:** "Plataforma" con su contador, la redirección del admin sin empresas a `/platform` y el contacto en las tres pestañas.
- **Contacto:** el bloque de `/settings/company`.
- **Suspensión:** el aviso en menos de 5 s con la app abierta.
- **Push:** a los admins y al solicitante, en un dispositivo (las pruebas comprueban que se encola `platform.push_requested`).

Decisiones tomadas al implementar, dentro del alcance:

- **Fechas en `/me`:** `Membership` gana `requestedAt` (solo en revisión) y `suspendedAt` (solo suspendida). La espera y el aviso de suspensión muestran una fecha que `/me` no traía.
- **Acciones de `/platform`:** responden `200` sin cuerpo. La web vuelve a pedir las pestañas y `/me`.
- **Sesiones al suspender:** las que tenían esa empresa activa la sueltan (`active_tenant_id = null`), y el siguiente `/me` elige la de respaldo. Así un miembro con otra empresa pasa a ella, y quien no tiene otra se queda viendo el aviso. Elegirla después desde el selector sigue funcionando.
- **Empresa de respaldo:** si no hay una activa ni una en revisión o suspendida, es la inactiva de un Owner. Sin esto, un Owner cuya única empresa está inactiva se quedaba sin empresa tras levantar una suspensión (regresión de SPEC 16). El login usa la misma regla.
- **Socket:** con la empresa activa en revisión o suspendida, la web no abre el socket (el gateway lo rechazaría) y la pantalla consulta `/me` cada 30 s.
- **"Crear empresa":** lleva a `/onboarding?create=1`, y se oculta con una solicitud en revisión. Sin `?create`, `/onboarding` devuelve a la bandeja a quien ya tiene empresa. Un admin sin empresas tiene "Crear empresa" en la cabecera de `/platform`.
- **Prueba existente:** `conversations.e2e-spec.ts` elegía un OWNER cualquiera de la demo, a veces uno dado de baja por otro archivo. El archivo e2e nuevo cambió el orden de ejecución y lo destapó. Ahora filtra los activos con usuario.

