# SPEC 12 — Robustez III: retención de datos y Row Level Security

> **Status:** Approved
> **Depends on:** SPEC 07, SPEC 09, SPEC 14, SPEC 16
> **Date:** 2026-10-12
> **Objective:** Cada empresa configura (como OWNER) cuántos días se conservan sus conversaciones cerradas y puede borrar un contacto a petición, un job diario aplica esa retención y purga las tablas técnicas, y PostgreSQL aísla por tenant todas las tablas con `tenant_id` mediante Row Level Security, con un rol de aplicación sin `BYPASSRLS`.

## Ajustes del 2026-10-14

Este spec se escribió antes de SPEC 16 y de decidir que SPEC 10 va al final. Al implementarlo se acordó:

- **La retención vive en `/settings/company` (SPEC 16)**, como una sección más, no en una pantalla `/settings/workspace` aparte. Los endpoints son los de la empresa activa: `retentionDays` va en `GET`/`PATCH /api/v1/tenants/current` y la vista previa es `GET /api/v1/tenants/current/retention-preview`. La entrada "Empresa" del menú (OWNER) ya existe.
- **Sin dependencias de SPEC 10:** la purga de `rate_limit_buckets` la añade SPEC 10, y la verificación de RLS usa los e2e del API más una pasada manual por la app (`pnpm e2e` llega con SPEC 10).
- **Sin dependencias de SPEC 11:** no se mide la latencia con su histograma.

## Por qué existe este spec

Dos pendientes de la arquitectura (§12, §17) se cierran aquí:

1. **Retención.** Hoy los datos crecen sin límite: mensajes, eventos, Outbox, Inbox, sesiones y buckets. Algunas empresas querrán (o por regulación deberán) borrar conversaciones viejas y atender pedidos de borrado de un cliente.
2. **Aislamiento por tenant en la base.** Hoy depende de que cada consulta incluya `tenantId`. RLS es defensa en profundidad: si un caso de uso olvida el filtro, Postgres no devuelve filas de otra empresa.

## Alcance

**Dentro:**

**Retención**

- **Configuración** en `Tenant.retentionDays`: `null` (indefinido, por defecto), `90`, `180` o `365`.
- **Sección "Retención de datos" en `/settings/company`** (solo OWNER, SPEC 16):
  - Selector "Conservar conversaciones cerradas: Indefinidamente / 90 / 180 / 365 días".
  - Antes de guardar, una vista previa: "Se borrarán N conversaciones en la próxima ejecución (03:30)".
  - Confirmación cuando N > 0.
- **API:**
  - `GET /api/v1/tenants/current` añade `retentionDays`.
  - `PATCH /api/v1/tenants/current { retentionDays }` (OWNER), solo o junto al nombre y el slug.
  - `GET /api/v1/tenants/current/retention-preview?days=90` devuelve `{ conversations }` (OWNER).
- **Job de retención diario** a las 03:30, hora del servidor (después del backup de las 03:00 de SPEC 08):
  - Se ejecuta con `pg_try_advisory_lock`, una sola vez aunque haya reinicios.
  - Para cada empresa con `retentionDays`:
    - Antes de borrar mensajes, borra del bucket los `message_attachments.storage_key` no nulos (SPEC 14). La fila cae en cascada; el objeto no.
    - Borra las conversaciones `CLOSED` con `lastMessageAt < now − retentionDays`, junto con sus mensajes y eventos.
    - Después borra los contactos sin conversaciones, con sus identidades.
  - Trabaja en lotes de 500 conversaciones por transacción.
  - Registra un log `info` por empresa con los conteos borrados.
- **Purga técnica**, en el mismo job:
  - `outbox_events` publicados hace más de 30 días.
  - `event_inbox` de hace más de 30 días.
  - `sessions` expiradas o revocadas hace más de 30 días.
  - `invitations` aceptadas, revocadas o expiradas hace más de 30 días.
  - Los `rate_limit_buckets` no existen todavía: su purga la añade SPEC 10.
- **Borrado de un contacto a petición:**
  - `DELETE /api/v1/contacts/:id` (OWNER). Borra el contacto, sus identidades, todas sus conversaciones (abiertas o cerradas), sus mensajes y sus eventos.
  - Se registra en `DeletionLog`, sin datos personales: quién, cuándo, cuántas conversaciones y mensajes.
  - **UI:** acción "Borrar contacto y su historial" en el panel de contacto (SPEC 06), solo para OWNER. El diálogo exige escribir el teléfono para confirmar.
  - Encola `conversation.changed` (`reason: 'deleted'`) por cada conversación, para que las pestañas abiertas la quiten de la lista. Un chat abierto muestra "Esta conversación fue eliminada".
- **El dispatcher tolera eventos huérfanos:** un `message.send_requested` cuyo mensaje ya no existe se marca publicado, sin error.

**Row Level Security**

- RLS **habilitado y forzado** (`ENABLE` + `FORCE ROW LEVEL SECURITY`) en todas las tablas con `tenant_id`:
  - `channels`
  - `integration_credentials`
  - `contacts`
  - `contact_identities`
  - `conversations`
  - `messages`
  - `message_attachments`
  - `tenant_members`
  - `conversation_events`
  - `outbox_events`
  - `invitations`
  - `deletion_log`
- **Política única por tabla**, `tenant_isolation`: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)` con el mismo `WITH CHECK`. Sin la variable fijada, no se ve ni se escribe ninguna fila (falla cerrado).
- **Dos roles de base de datos:**
  - `omnidesk_app` (`NOLOGIN` heredado por `omnidesk_app_login`, sin `BYPASSRLS` y sin ser dueño de las tablas). Lo usa todo lo que actúa en nombre de un tenant: peticiones con sesión y casos de uso de integración una vez resuelto el canal.
  - `omnidesk` (dueño, el actual). Solo se usa para:
    - Migraciones.
    - Resolver la sesión y la credencial (`users`, `sessions`, y el `integration_credentials` por `key_hash`, antes de conocer el tenant).
    - El dispatcher del Outbox.
    - Los jobs de retención, purga y rate limiting.
    - La semilla demo.
    - `POST /tenants` y la aceptación de invitaciones (crean filas de un tenant que la sesión aún no tiene activo).
- **Contexto de tenant en Prisma:**
  - `TenantPrisma.run(tenantId, fn)` abre una transacción con `SELECT set_config('app.tenant_id', $1, true)` y ejecuta `fn` con el cliente `omnidesk_app`.
  - El `TransactionRunner` existente lo usa siempre que hay `ActorContext` o un canal resuelto.
  - El read model de conversaciones también pasa por `run`.
- **Variables:** `DATABASE_URL` (dueño, como hoy) y `DATABASE_APP_URL` (rol `omnidesk_app_login`), las dos obligatorias. La migración crea el rol, y su contraseña sale de `DATABASE_APP_PASSWORD` mediante un script de arranque.

**Fuera de alcance (para specs futuros):**

- Exportación de datos (portabilidad) por contacto o por empresa.
- Retención de conversaciones abiertas o por canal.
- Borrado de la empresa completa y baja del servicio.
- Anonimización en lugar de borrado.
- Borrado de los backups ya existentes (rotan solos en 7 días, SPEC 08).
- Cifrado de columnas con datos personales.

## Modelo de datos

**Prisma (cambios):**

```prisma
model Tenant {
  // … campos existentes
  /// null = conservar indefinidamente; si no, 90 | 180 | 365.
  retentionDays Int? @map("retention_days")
}

model DeletionLog {
  id                   String   @id @default(uuid(7)) @db.Uuid
  tenantId             String   @map("tenant_id") @db.Uuid
  /// "contact" (a petición) | "retention" (job).
  kind                 String
  actorMemberId        String?  @map("actor_member_id") @db.Uuid   // null en el job
  conversationsDeleted Int      @map("conversations_deleted")
  messagesDeleted      Int      @map("messages_deleted")
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([tenantId, createdAt])
  @@map("deletion_log")
}
```

- Las FK de `messages`, `conversation_events` y `contact_identities` hacia sus padres pasan a `onDelete: Cascade`.
- `Conversation.assignedAgent` y `Message.senderMember` siguen en `Restrict`, porque a los miembros nunca se les borra.

**Migración SQL manual** (`…_rls/migration.sql`), descrita, no copiada:

- `CREATE ROLE omnidesk_app NOLOGIN;` y `GRANT SELECT, INSERT, UPDATE, DELETE` sobre las tablas de dominio.
- `GRANT USAGE` sobre las secuencias, si las hay.
- Para cada tabla de la lista: `ENABLE` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation … TO omnidesk_app`.
- `ALTER DEFAULT PRIVILEGES` para las tablas futuras.

**Contratos** (`packages/contracts/src/tenants.ts`):

```ts
RetentionDaysSchema = z.union([z.null(), z.literal(90), z.literal(180), z.literal(365)])
TenantDetailsSchema += { retentionDays: RetentionDaysSchema }
UpdateTenantRequestSchema += { retentionDays?: RetentionDaysSchema }
RetentionPreviewQuerySchema = { days: 90 | 180 | 365 }
RetentionPreviewResponseSchema = { conversations: z.int().min(0) }
RealtimeReasonSchema += 'deleted'
```

**Funciones puras**, con pruebas:

```ts
retentionCutoff(now: Date, days: number): Date
technicalPurgeCutoff(now: Date): Date            // now − 30 días
```

## Plan de implementación

1. **Retención: modelo.**
   - `retention_days`, `deletion_log` y las cascadas.
   - Contratos.
   - `retentionDays` en `GET`/`PATCH /tenants/current` y `retention-preview`, con permisos.
   - e2e.
2. **Job de retención y purga.**
   - `RetentionJob` con advisory lock, lotes de 500 y purga técnica.
   - Prueba de integración con fechas controladas: borra solo las `CLOSED` antiguas, conserva las `OPEN` y las recientes, y borra los contactos huérfanos.
3. **Borrado de contacto.**
   - Caso de uso `DeleteContact` (OWNER) con `DeletionLog` y `conversation.changed` (`deleted`).
   - El dispatcher tolera mensajes inexistentes.
   - e2e.
4. **Web.**
   - Sección de retención en `/settings/company` con la vista previa y la confirmación.
   - Acción "Borrar contacto y su historial" en el panel, con confirmación por teléfono.
   - Manejo de `reason: 'deleted'` (quitar de la lista y aviso en el chat).
5. **RLS: roles y contexto, sin activar políticas.**
   - Rol `omnidesk_app` y `DATABASE_APP_URL`.
   - `TenantPrisma.run` y el `TransactionRunner` actualizado.
   - Todos los casos de uso con tenant migrados a `run`.
   - Los e2e siguen pasando sin RLS activo.
6. **RLS: políticas.**
   - Migración con `ENABLE`/`FORCE` y las políticas.
   - Prueba de integración: con `app.tenant_id = A`, `SELECT` sobre `conversations` no devuelve filas de B; sin `app.tenant_id`, devuelve 0 filas; un `INSERT` con `tenant_id = B` falla.
   - Todos los e2e del API pasan, y una pasada manual por la app confirma el flujo (`pnpm e2e` llega con SPEC 10).
7. **Despliegue.**
   - `DATABASE_APP_URL` y `DATABASE_APP_PASSWORD` en las plantillas de `infra/deploy` y en `.env.example`.
   - Script de arranque del API que asegura la contraseña del rol.
   - Nota en `docs/despliegue.md` (hacer un backup antes de esta migración).
8. **Documentación.**
   - `docs/arquitectura.md` §12 y §17: se cierran los pendientes de retención y RLS.
   - `docs/datos.md`: qué se borra, cuándo y qué no (backups).

## Criterios de aceptación

**Retención**

- [ ] Como OWNER, elegir "90 días" con 3 conversaciones cerradas de hace 100 días muestra "Se borrarán 3 conversaciones…" y pide confirmación.
- [ ] Un ADMIN o AGENT no ve "Empresa" en el menú, y `PATCH /tenants/current` le responde `403`.
- [ ] Tras ejecutar el job (forzado en la prueba), esas 3 conversaciones, sus mensajes y sus eventos ya no existen. Las conversaciones abiertas de cualquier antigüedad y las cerradas de hace 10 días siguen intactas.
- [ ] Los contactos que se quedaron sin conversaciones se borran, y los que aún tienen alguna se conservan.
- [ ] Con `retentionDays = null`, el job no borra ninguna conversación de esa empresa.
- [ ] Dos instancias del job lanzadas a la vez: solo una borra, y la otra termina sin hacer nada (advisory lock).
- [ ] `outbox_events` publicados hace 31 días se purgan, y los de hace 29 días no.

**Borrado de contacto**

- [ ] Como OWNER, "Borrar contacto y su historial" exige escribir el teléfono exacto. Tras confirmar, la conversación desaparece de la lista en todas las pestañas abiertas en ≤ 1 s.
- [ ] `deletion_log` registra `kind: contact`, el actor y los conteos, sin teléfono ni nombre.
- [ ] Un mensaje de agente `PENDING` de ese contacto no rompe el dispatcher: su evento queda publicado y no hay errores repetidos en el log.
- [ ] Si el cliente vuelve a escribir después, se crea un contacto y una conversación nuevos, sin historial previo.

**RLS**

- [ ] `SELECT relrowsecurity, relforcerowsecurity FROM pg_class` devuelve `true, true` para las 12 tablas de la lista.
- [ ] Conectado como `omnidesk_app_login` sin `app.tenant_id`, `SELECT count(*) FROM conversations` devuelve 0.
- [ ] Con `app.tenant_id` del tenant A, no se ve ninguna fila del tenant B en ninguna de las 12 tablas.
- [ ] Un caso de uso modificado a propósito para no filtrar por `tenantId` (prueba de integración) sigue sin devolver filas de otro tenant.
- [ ] Todo el flujo de la app (login, bandejas, asignar, enviar, ticks, integraciones, simulador) funciona igual con RLS activo: los e2e del API pasan y una pasada manual por la app lo confirma.
- [ ] `omnidesk_app` no tiene `BYPASSRLS` ni es dueño de ninguna tabla (`\du` y `\dt+`).

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0.

## Decisiones

- **Sí:** retención configurable por empresa, indefinida por defecto. Lo decidió el equipo. Nadie pierde datos sin haberlo elegido.
- **Sí:** solo se borran conversaciones **cerradas**. Una conversación abierta antigua sigue siendo trabajo pendiente.
- **Sí:** valores cerrados (90/180/365) en lugar de un número libre. Es más fácil de explicar, y evita configuraciones como "1 día" por error.
- **Sí:** la configura el OWNER en `/settings/company`, con vista previa. Lo decidió el equipo; borrar datos es una decisión del dueño.
- **Sí:** borrado de contacto a petición, con confirmación escribiendo el teléfono. Es el derecho de supresión del cliente, y la confirmación evita borrados accidentales.
- **Sí:** `DeletionLog` sin datos personales. Deja constancia de que se borró sin conservar lo borrado.
- **Sí:** el job corre a las 03:30, después del backup de las 03:00. Lo borrado sigue recuperable durante 7 días desde el backup.
- **Sí:** implementar RLS, no solo evaluarlo. Lo decidió el equipo, como defensa en profundidad.
- **Sí:** variable de sesión `app.tenant_id` con `set_config(..., true)` (local a la transacción). Con el pool de conexiones de Prisma, una variable de sesión filtraría el tenant entre peticiones.
- **Sí:** el rol dueño solo se usa en los caminos de sistema enumerados. Esos caminos necesitan ver varios tenants o actúan antes de conocerlo. La lista es cerrada y está documentada.
- **No:** RLS en `users` y `sessions`. No tienen `tenant_id` (son globales), y solo los consulta el camino de sistema.
- **No:** anonimizar en lugar de borrar. Es más complejo y no lo pidió nadie; queda como evolución.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Una transacción por petición aumenta la latencia | Las escrituras ya eran transaccionales. Las lecturas añaden un `set_config`. |
| Un camino olvidado sigue usando el cliente dueño y salta RLS | Los clientes `SystemPrisma` y `TenantPrisma` son tipos distintos, y el dueño solo se inyecta en los módulos de la lista. Revisión de `grep` en el paso 5. |
| El job borra de más por un error de fechas | `retentionCutoff` es una función pura probada, el job es posterior al backup diario y el `DeletionLog` deja los conteos para detectar anomalías. |
| Borrado masivo que bloquea tablas | Lotes de 500 por transacción a las 03:30 (baja actividad). |
| La migración de RLS en prod deja la app sin acceso si falta `DATABASE_APP_URL` | `env.ts` exige la variable antes de arrancar, y la guía pide backup y despliegue primero en dev. |
| Pestañas con una conversación borrada abierta | El evento `deleted` se trata en la web. Si se pierde, el `GET` responde `404` y se muestra "Esta conversación fue eliminada". |

## Lo que **no** entra en este spec

- Exportación y portabilidad de datos.
- Retención de conversaciones abiertas o por canal.
- Baja de la empresa.
- Anonimización y cifrado de columnas.
- Borrado de backups existentes.

Cada uno llega en su propio spec.
