# SPEC 20 — Borrado de empresas por el admin de plataforma

> **Status:** Approved
> **Depends on:** SPEC 07, SPEC 12, SPEC 14, SPEC 15, SPEC 16, SPEC 18
> **Date:** 2026-10-15
> **Objective:** Un admin de plataforma puede borrar de forma irreversible una empresa suspendida desde `/platform`, y un proceso en segundo plano elimina todas sus filas, sus archivos del bucket y las cuentas de los miembros que no pertenecen a otra empresa.

## Por qué existe este spec

SPEC 18 creó el admin de plataforma, la suspensión y el panel `/platform`. Dejó fuera, a propósito, "Borrar empresas aprobadas desde `/platform`".

Hoy una empresa suspendida sigue ocupando la base y el bucket para siempre: conversaciones, mensajes, contactos, adjuntos, logo y membresías. La plataforma no tiene forma de cumplir una baja definitiva ni de liberar ese espacio.

Este spec añade el borrado total, con tres salvaguardas:

- **Dos pasos:** solo se borra una empresa ya suspendida.
- **Confirmación fuerte:** hay que escribir el slug exacto.
- **Constancia:** queda una fila en `tenant_deletions` y una pestaña "Borradas" en `/platform`.

Lo que ya fijaron otros specs y aquí no se reabre:

- Admin de plataforma por email en `PLATFORM_ADMIN_EMAILS`, `PlatformAdminGuard` y `404` para quien no es admin (SPEC 18).
- Los caminos de sistema usan `PrismaService` (rol dueño, SPEC 12).
- Los objetos del bucket no caen en cascada con las filas: se borran explícitamente (SPEC 12).
- `PgJobLock` para que un job no corra dos veces a la vez (SPEC 12).
- `User` es una cuenta global; sus membresías dicen a qué empresas pertenece (SPEC 07).

## Alcance

**Dentro:**

- **Qué se puede borrar:**
  - Solo una empresa `APPROVED` con `suspendedAt` no nulo. Si no, `409 NOT_SUSPENDED`.
  - Una empresa en revisión no se borra con esto: para ella existe "Rechazar" (SPEC 18).
  - Con `DEMO_MODE=true`, la empresa demo (`DEMO_TENANT_SLUG`) responde `409 DEMO_TENANT_LOCKED`.
- **Confirmación:**
  - El cuerpo lleva `confirmSlug`. Si no coincide exactamente con el slug, responde `400 CONFIRMATION_MISMATCH` y no cambia nada.
- **Pedir el borrado (`POST /api/v1/platform/tenants/:id/delete { confirmSlug }`):**
  - Responde `202` sin cuerpo.
  - En una transacción:
    1. Fija `Tenant.deletionRequestedAt`.
    2. Crea el `TenantDeletion` con el nombre, el slug, quién lo pidió (id y email) y la fecha.
    3. Pone `active_tenant_id = null` en las sesiones que tenían esa empresa activa.
  - Tras el commit, despierta el job de borrado sin esperarlo.
  - Repetirlo con la empresa ya en borrado responde `202` sin cambios.
  - Es irreversible: no hay cancelación ni periodo de gracia.
- **Empresa en borrado (estado efectivo `deleting`):**
  - **Membresías:** deja de contar. `/me` no la lista, no aparece en el selector y no se puede elegir.
  - **Sesiones:** la que la tenía activa cae a la empresa de respaldo de SPEC 18 en el siguiente `/me`. Sin otra empresa, el usuario ve `/onboarding`.
  - **Tiempo real:** el gateway no deja unirse a su sala, como con `pending` y `suspended`.
  - **Entrantes:** el webhook de WhatsApp Cloud y los endpoints de integración (n8n, IA) tratan sus canales como desconocidos. Dan la misma respuesta que hoy a un canal que no existe y no guardan nada.
  - **Outbox:** el dispatcher descarta los eventos de una empresa `deleting` o inexistente, salvo `platform.push_requested`.
  - **Acciones de plataforma:** suspender y levantar la suspensión responden `409 TENANT_DELETING`.
- **Job de borrado (`TenantPurgeJob`):**
  - Corre cada 60 s y cuando se pide un borrado. Toma el lock `omnidesk:tenant-purge` con `PgJobLock`.
  - Procesa las empresas con `deletionRequestedAt`, de la más antigua a la más reciente, una cada vez.
  - Cada paso es idempotente. Si uno falla, guarda el error en `TenantDeletion.lastError`, lo registra en el log y la siguiente pasada sigue desde donde quedó.
  - Pasos, en orden:
    1. **Conversaciones**, por lotes de `TENANT_PURGE_BATCH_SIZE` (200) en transacciones separadas. Caen en cascada sus mensajes, adjuntos (filas) y eventos. Suma los conteos al `TenantDeletion`.
    2. **Bucket de la empresa:** borra todos los objetos bajo `tenants/<tenantId>/` (adjuntos entrantes, salientes y logo). Suma los objetos borrados.
    3. **Resto de filas**, en una transacción:
       - `contacts` (caen sus `contact_identities`), `integration_credentials`, `event_inbox` de sus canales y `channels`.
       - `invitations`, `outbox_events` y `deletion_log` de la empresa.
       - `tenants.deactivated_by_member_id = null` y `active_tenant_id = null` en las sesiones que aún la tengan.
       - `tenant_members` de la empresa.
       - Las **cuentas huérfanas** (ver abajo): primero sus `sessions`, después el `User`. Caen en cascada sus `push_subscriptions` y `tenant_rejections`.
       - La fila de `tenants`. El slug queda libre.
       - `TenantDeletion.completedAt` y los conteos finales.
    4. **Fotos de perfil** de las cuentas huérfanas, tras el commit: borra los objetos bajo `users/<userId>/`. Si falla, lo registra en el log y no reintenta.
  - Al terminar, escribe en el log `Empresa <tenantId> borrada` con los conteos, sin nombres ni emails.
- **Cuentas huérfanas:**
  - Una cuenta se borra si era miembro de la empresa y, en el paso 3, no tiene ninguna membresía con `removedAt` nulo en otra empresa.
  - Una solicitud en revisión cuenta como membresía (el solicitante es `OWNER` de la empresa `PENDING`).
  - Un admin de plataforma nunca se borra, aunque solo perteneciera a esa empresa.
  - Sus membresías dadas de baja en otras empresas conservan el nombre y el email, y pierden el `user_id` (la FK ya es `SET NULL`).
  - Al perder la sesión, su app recibe `401` y vuelve a `/login`.
- **Vista previa (`GET /api/v1/platform/tenants/:id/deletion-preview`):**
  - Devuelve los conteos de lo que se borraría: miembros, cuentas que se borrarían, conversaciones, mensajes y adjuntos.
  - Usa la misma regla de cuentas huérfanas que el job.
- **Constancias (`GET /api/v1/platform/tenant-deletions`):**
  - Devuelve todos los `TenantDeletion`, del más reciente al más antiguo.
  - Se conservan indefinidamente. El job de retención no los toca.
- **Panel `/platform`, cambia:**
  - **Aprobadas:** no muestra las empresas en borrado. Las suspendidas ganan la acción "Borrar", junto a "Levantar suspensión".
  - **"Borrar"** abre `DeleteTenantDialog`:
    - Pide la vista previa y muestra "Se borrarán N miembros, N cuentas, N conversaciones, N mensajes y N archivos. No se puede deshacer."
    - Campo "Escribe <slug> para confirmar". El botón "Borrar empresa" se habilita solo con el slug exacto.
    - Estados: cargando la vista previa, error con "Reintentar" y error del borrado dentro del diálogo.
    - Al confirmar, cierra el diálogo y vuelve a pedir las pestañas.
  - **Nueva pestaña "Borradas (n)"** (`?tab=deleted`): empresa, slug, borrada por (email), fecha de solicitud, estado ("Borrando…" o "Borrada" con la fecha) y conteos. Sin acciones. Vacío: "No hay empresas borradas".
- **Sin avisos:** no se envían push ni otros avisos. La suspensión previa ya mostró el aviso a todos.

**Fuera:**

- Exportar los datos de la empresa antes de borrarla.
- Que el Owner pida borrar su propia empresa.
- Periodo de gracia, cancelación o restauración.
- Borrar empresas en revisión (ya existe "Rechazar") o activas sin suspender.
- Avisos por push o email a los miembros.
- Desconectar el número en Meta o en n8n. La plataforma no toca la configuración externa del canal.
- Borrar las cuentas de miembros que pertenecen a otras empresas.
- Borrar en lote.

## Modelo de datos

**Prisma:**

```prisma
model Tenant {
  // … campos de SPEC 07, 12, 16 y 18 sin cambios
  /// Borrado pedido por la plataforma (SPEC 20); null = no se está borrando.
  deletionRequestedAt DateTime? @map("deletion_requested_at") @db.Timestamptz(3)
}

/// Constancia de una empresa borrada (SPEC 20). Sobrevive a la empresa: `tenant_id` sin FK y sin RLS.
model TenantDeletion {
  id                   String    @id @default(uuid(7)) @db.Uuid
  tenantId             String    @unique @map("tenant_id") @db.Uuid
  tenantName           String    @map("tenant_name")
  tenantSlug           String    @map("tenant_slug")
  requestedByUserId    String?   @map("requested_by_user_id") @db.Uuid
  /// Copia: se conserva aunque la cuenta del admin desaparezca.
  requestedByEmail     String    @map("requested_by_email")
  requestedAt          DateTime  @map("requested_at") @db.Timestamptz(3)
  /// null = el job aún no terminó.
  completedAt          DateTime? @map("completed_at") @db.Timestamptz(3)
  lastError            String?   @map("last_error")
  membersDeleted       Int       @default(0) @map("members_deleted")
  usersDeleted         Int       @default(0) @map("users_deleted")
  conversationsDeleted Int       @default(0) @map("conversations_deleted")
  messagesDeleted      Int       @default(0) @map("messages_deleted")
  attachmentsDeleted   Int       @default(0) @map("attachments_deleted")
  objectsDeleted       Int       @default(0) @map("objects_deleted")

  requestedBy User? @relation("TenantDeletionBy", fields: [requestedByUserId], references: [id], onDelete: SetNull)

  @@index([requestedAt])
  @@map("tenant_deletions")
}
```

- `tenant_deletions` no lleva RLS. Solo la leen y escriben caminos de sistema con `PrismaService`.
- La migración no toca filas existentes: `deletion_requested_at` es nulo en todas.

**Estado efectivo** (`tenant/domain/tenant-state.ts`), gana `deleting` y va primero:

```ts
export type TenantState = 'deleting' | 'pending' | 'suspended' | 'inactive' | 'active';
// deletionRequestedAt → 'deleting'; approval === 'PENDING' → 'pending'; suspendedAt → 'suspended'; …
```

- `ResolveActor` y `GetMeUseCase` ignoran las membresías de empresas `deleting`.
- `MembershipSchema.tenantState` no gana `deleting`: esas membresías nunca llegan a la web.

**Almacenamiento** (`AttachmentStorage`, SPEC 14) gana:

```ts
/** Borra todos los objetos bajo el prefijo y devuelve cuántos borró. Idempotente. */
deletePrefix(prefix: string): Promise<number>;
```

- En S3/MinIO: `ListObjectsV2` paginado y `DeleteObjects` por lotes de 1000.
- El fake en memoria lo implementa para las pruebas.

**Contratos (`@omnidesk/contracts`, `platform.ts`):**

```ts
export const DeleteTenantRequestSchema = z.object({ confirmSlug: z.string() });

export const TenantDeletionPreviewSchema = z.object({
  members: z.number().int(),
  accountsToDelete: z.number().int(),
  conversations: z.number().int(),
  messages: z.number().int(),
  attachments: z.number().int(),
});

export const PlatformTenantDeletionRowSchema = z.object({
  id: z.uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  requestedByEmail: z.string(),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  membersDeleted: z.number().int(),
  usersDeleted: z.number().int(),
  conversationsDeleted: z.number().int(),
  messagesDeleted: z.number().int(),
  attachmentsDeleted: z.number().int(),
});

// errors.ts — códigos nuevos:
// 'NOT_SUSPENDED' | 'DEMO_TENANT_LOCKED' | 'TENANT_DELETING'
```

- `CONFIRMATION_MISMATCH` ya existe (SPEC 16); se reutiliza.
- `TENANT_PURGE_BATCH_SIZE = 200` y `TENANT_PURGE_LOCK_NAME = 'omnidesk:tenant-purge'` viven en `modules/platform/domain/tenant-purge.ts`.

## Plan de implementación

1. **Modelo y contratos.** Migración de `tenants.deletion_requested_at` y `tenant_deletions`. Esquemas y códigos de error de arriba. Nada los usa todavía.
2. **Estado `deleting`.** `tenant-state.ts` con sus pruebas. `PrismaTenantStatus.state()` lee `deletionRequestedAt`. `ResolveActor`, `GetMeUseCase` y el gateway ignoran o rechazan las empresas `deleting`. Pruebas de `GetMeUseCase` con una empresa en borrado.
3. **Cortes de entrada.** El webhook de WhatsApp Cloud, los endpoints de integración y el dispatcher tratan una empresa `deleting` como inexistente. Prueba del dispatcher con una empresa en borrado y con una ya borrada.
4. **`deletePrefix`.** En `s3-attachment-storage.ts` y en el fake en memoria. Prueba del fake; la de MinIO se salta sin MinIO, como la de SPEC 14.
5. **Pedir el borrado.** Caso de uso en `modules/platform/application/` con las validaciones (`NOT_SUSPENDED`, `DEMO_TENANT_LOCKED`, `CONFIRMATION_MISMATCH`, idempotencia), la transacción y el despertar del job. `POST /platform/tenants/:id/delete`. Suspender y levantar responden `TENANT_DELETING`. E2E de cada validación.
6. **Regla de cuentas huérfanas y vista previa.** Consulta compartida en el repositorio de plataforma. `GET /platform/tenants/:id/deletion-preview`. E2E con un miembro que solo está en la empresa, otro que está en dos, uno con solo una baja en otra empresa y un admin de plataforma.
7. **Job de borrado.** `TenantPurgeJob` (pasos 1 a 4) y `TenantPurgeScheduler` cada 60 s con `PgJobLock`. Pruebas unitarias con el almacenamiento en memoria: lotes, reanudación tras un fallo en cada paso y conteos.
8. **Constancias.** `GET /platform/tenant-deletions`. E2E completo: suspender, borrar, esperar el job y comprobar que no queda ninguna fila con ese `tenant_id`, que el slug queda libre y que la constancia tiene los conteos.
9. **Web: diálogo.** `features/platform/delete-tenant-dialog.tsx` y las funciones nuevas en `platform-api.ts`. Acción "Borrar" en las suspendidas de la pestaña Aprobadas. Pruebas del diálogo: botón deshabilitado hasta escribir el slug.
10. **Web: pestaña "Borradas".** En `platform-page.tsx`, con `?tab=deleted`, sus estados de carga, error y vacío.
11. **Documentación.** Mención en el README (sección de la plataforma) y sección "Verificación de implementación" en este spec.

## Criterios de aceptación

- [x] Borrar una empresa activa, inactiva o en revisión responde `409 NOT_SUSPENDED` y no cambia nada.
- [x] Con `DEMO_MODE=true`, borrar la empresa demo responde `409 DEMO_TENANT_LOCKED`.
- [x] Un `confirmSlug` distinto del slug responde `400 CONFIRMATION_MISMATCH` y no cambia nada.
- [x] Un usuario que no es admin recibe `404` en `POST /platform/tenants/:id/delete`, en la vista previa y en `GET /platform/tenant-deletions`.
- [x] Pedir el borrado de una empresa suspendida responde `202`, y repetirlo responde `202` sin crear otra constancia.
- [x] Justo después de pedirlo, la empresa no aparece en `/me` de ningún miembro, y una sesión que la tenía activa pasa a otra empresa o a `/onboarding`.
- [x] Justo después de pedirlo, suspender o levantar la suspensión responde `409 TENANT_DELETING`.
- [x] Un WhatsApp entrante a un canal de la empresa en borrado no crea ninguna fila.
- [x] Al terminar el job, no queda ninguna fila con ese `tenant_id` en `channels`, `integration_credentials`, `contacts`, `contact_identities`, `conversations`, `messages`, `message_attachments`, `conversation_events`, `invitations`, `tenant_members`, `outbox_events` ni `deletion_log`, ni la fila de `tenants`.
- [x] Al terminar el job, el bucket no tiene ningún objeto bajo `tenants/<tenantId>/`.
- [x] Tras el borrado, un alta nueva con el mismo slug responde `201`.
- [x] Un miembro que solo pertenecía a esa empresa pierde su cuenta: su fila de `users`, sus sesiones, sus suscripciones push y su foto bajo `users/<userId>/`. Su app abierta vuelve a `/login`.
- [x] Un miembro que también pertenece a otra empresa conserva su cuenta y entra a la otra empresa.
- [x] Un admin de plataforma que era miembro de la empresa conserva su cuenta.
- [x] La vista previa devuelve los mismos conteos de miembros y cuentas que luego registra la constancia.
- [x] Si el bucket falla en medio del job, la constancia guarda `lastError`, la empresa sigue en borrado y la siguiente pasada termina el borrado sin duplicar conteos.
- [ ] En `/platform`, una empresa suspendida muestra "Borrar", y el botón "Borrar empresa" del diálogo está deshabilitado hasta escribir el slug exacto.
- [ ] La pestaña "Borradas" muestra la empresa como "Borrando…" mientras corre el job y como "Borrada" con la fecha y los conteos al terminar.
- [x] Lint, typecheck, test, build y e2e pasan.

## Decisiones tomadas y descartadas

- **Sí: borrar la cuenta solo si queda huérfana** (elegido por el usuario). Quien pertenece a otra empresa conserva su cuenta. Se descartaron borrar solo las membresías (dejaría cuentas inútiles con datos personales) y borrar todas las cuentas (rompería las otras empresas).
- **Sí: solo se borra una empresa suspendida** (elegido por el usuario). Obliga a dos pasos y la suspensión ya avisa a todos. Se descartaron borrar cualquier aprobada y borrar también las pendientes.
- **Sí: inmediato e irreversible** (elegido por el usuario). La suspensión previa hace de pausa. Se descartó un periodo de gracia con cancelación: añade un estado y UI que no aportan con los dos pasos.
- **Sí: confirmar escribiendo el slug** (elegido por el usuario), como el teléfono en el borrado de contacto de SPEC 12. Se descartaron un motivo obligatorio y un `ConfirmDialog` simple.
- **Sí: borrado en segundo plano** (elegido por el usuario). Una empresa grande excedería el timeout de una petición, y un fallo del bucket debe reintentarse. Se descartó el borrado síncrono.
- **Sí: job propio con `PgJobLock` en vez del Outbox.** Al preguntar se propuso el Outbox, pero el dispatcher es un único bucle cada 500 ms: un borrado largo retrasaría los eventos de tiempo real de todas las empresas. El job propio corre aparte y reanuda por estado (`deletionRequestedAt`), sin depender de reintentos de un evento.
- **Sí: constancia en `tenant_deletions` y pestaña "Borradas"** (elegido por el usuario), indefinida. Se descartaron la tabla sin UI y solo el log.
- **Sí: sin avisos** (elegido por el usuario). La suspensión ya avisó. Se descartaron push al Owner y a todos los miembros.
- **Sí: la demo no se borra con `DEMO_MODE=true`** (elegido por el usuario). Las pruebas y el login de desarrollo dependen de ella.
- **Sí: borrar el bucket por prefijo `tenants/<id>/`.** Atrapa también los salientes subidos que nunca llegaron a tener fila. Se descartó borrar solo las claves de `message_attachments` y `logoKey`.
- **Sí: filas antes que el bucket, y la fila de `tenants` al final.** Mientras exista la fila de `tenants` con `deletionRequestedAt`, el job sabe que debe seguir. Un objeto sin fila no hace daño; una fila sin objeto sí.
- **Sí: la empresa desaparece de `/me` al pedir el borrado**, sin un estado "Borrando" visible para los miembros. Ya no tienen nada que hacer en ella.
- **Sí: una membresía dada de baja en otra empresa no salva la cuenta.** La baja ya no da acceso; el historial de esa empresa se apoya en `tenant_members`, que conserva nombre y email.
- **No: desconectar el canal en Meta o n8n.** La plataforma no guarda credenciales para eso. Los entrantes posteriores reciben la respuesta de canal desconocido.
- **No: exportar antes de borrar ni autoservicio del Owner** (elegido por el usuario). Cada uno va en su propio spec si llega.

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Borrar la empresa equivocada. | Solo suspendidas, vista previa con conteos y el slug escrito a mano. |
| El job falla a mitad y deja la empresa a medias. | Cada paso es idempotente. La fila de `tenants` se borra al final, así que la siguiente pasada retoma. `lastError` queda en la constancia y en el log. |
| Una FK `RESTRICT` (miembros referenciados por eventos, mensajes o `deactivated_by_member_id`) bloquea el borrado. | Orden explícito: conversaciones (con eventos y mensajes) primero, `deactivated_by_member_id = null` antes de borrar miembros. El e2e completo lo comprueba con datos de todas las tablas. |
| Una descarga de adjunto en curso escribe un objeto después del paso 2. | El dispatcher descarta los eventos de una empresa `deleting`, así que solo puede pasar con una descarga ya empezada. El objeto queda huérfano en el bucket, sin fila que lo nombre. |
| Falla el borrado de la foto de un usuario huérfano tras el commit. | Se registra en el log con la clave. El objeto queda sin cuenta que lo use. |
| Un miembro se vuelve "no huérfano" entre la vista previa y el job (acepta otra invitación, pide otra empresa). | La regla se evalúa de nuevo dentro de la transacción del paso 3. La vista previa es orientativa. |
| Un borrado largo bloquea el job para otras empresas. | Una empresa cada vez, por lotes. El volumen esperado de borrados es bajo. |
| `ListObjectsV2` lento con muchos objetos. | Paginado de 1000 en 1000 y `DeleteObjects` por lotes. |

## Qué **no** entra en este spec

- Exportar los datos antes de borrar.
- Que el Owner borre su propia empresa.
- Periodo de gracia, cancelación o restauración.
- Borrar empresas en revisión o activas sin suspender.
- Avisos a los miembros.
- Desconectar el número en Meta o n8n.
- Borrar cuentas que pertenecen a otras empresas.
- Borrado en lote.

Cada uno de esos, si llega, va en su propio spec.

## Verificación de implementación

2026-10-15, rama `spec-20-borrar-empresa`.

Automatizado, en verde:

- `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` en todo el monorepo: 428 unitarias del API, 168 de la web y 119 de contratos. El único aviso de lint (`main.tsx`) ya estaba en `main`.
- `pnpm --filter @omnidesk/api test:e2e` desde el host contra el Postgres local (`_e2e`) y MinIO (`S3_E2E_ENDPOINT`): 260 pasaron y ninguno se saltó. `test/tenant-deletion.e2e-spec.ts` aporta 14 pruebas, y `test/s3-storage.e2e-spec.ts` una más de `deletePrefix` contra MinIO.
- La migración `20261025000000_tenant_deletion` se aplicó sobre una base vacía, y `prisma migrate diff` contra `schema.prisma` sale vacío.

Los criterios marcados arriba los cubren esas pruebas. Los demás dependen de la web y quedan para la revisión manual:

- **Diálogo:** "Borrar" en una empresa suspendida, el resumen de la vista previa y el botón "Borrar empresa" deshabilitado hasta escribir el slug exacto. La regla del slug y el resumen tienen pruebas unitarias (`tenant-deletion.spec.ts`), pero la página no se abrió en un navegador.
- **Pestaña "Borradas":** "Borrando…" mientras corre el job y "Borrada" con los conteos al terminar.
- **Vuelta a `/login`:** el API responde `401` a la sesión de una cuenta borrada (probado). La redirección de la web es el mecanismo existente para un `401`.

No se tocó el stack que corre en esta máquina: la migración se aplica en el próximo despliegue con `prisma migrate deploy`.

Decisiones tomadas al implementar, dentro del alcance:

- **Miembros que se cuentan y cuentas que se evalúan:** todas las filas de `tenant_members` de la empresa, también las dadas de baja. Así la vista previa coincide con lo que borra el job. Una cuenta que solo tenía una baja en esta empresa y nada más también es huérfana.
- **Otra empresa en borrado no salva una cuenta:** la regla solo cuenta membresías activas en empresas sin `deletionRequestedAt`.
- **Invitaciones:** el enlace de una invitación de una empresa en borrado responde como si no existiera. El job las borra después.
- **Dispatcher:** ahora consulta el estado de la empresa para todo evento, no solo para los salientes, y descarta los de una empresa en borrado o inexistente. Es una lectura por clave primaria por evento. El push de plataforma sigue saliendo siempre.
- **Respuesta de los entrantes:** el webhook de WhatsApp Cloud responde `404` (canal desconocido) y los endpoints de integración `401` (credencial desconocida), las mismas respuestas que ya daban.
- **Fotos de las cuentas borradas:** se borra el prefijo `users/<userId>/` de cada cuenta huérfana, tenga o no foto. Así caen también fotos viejas que hubieran quedado.
- **`objectsDeleted`:** `deletePrefix` devuelve el total solo al terminar. Si el bucket falla a mitad, los objetos ya borrados en esa pasada no se suman, así que el conteo puede quedar por debajo, nunca duplicado. No se muestra en la web.
- **`PgJobLock`:** se reutiliza el de SPEC 12 (`modules/retention`); el módulo de plataforma lo registra con su propio `JOB_LOCK`.
- **Web:** la pestaña "Borradas" se vuelve a pedir cada 5 s mientras alguna sigue en curso. El botón "Borrar empresa" también espera a que cargue la vista previa.
