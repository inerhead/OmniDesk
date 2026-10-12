# SPEC 04 — Asignación de conversaciones y control de IA

> **Status:** Implemented
> **Depends on:** SPEC 02, SPEC 03
> **Date:** 2026-10-12
> **Objective:** Supervisores y agentes demo pueden tomar, asignar, liberar, cerrar y reabrir conversaciones según su rol, con bandejas IA/Mías/Todas/Cerradas, eventos visibles en el historial y suspensión inmediata de la IA vía `controlVersion`, todo actualizado en tiempo real.

## Por qué existe este spec

Es el corazón del producto (`docs/arquitectura.md` §8 y §9): una persona decide cuándo deja de atender la IA. La IA nunca decide transferir.

Todavía no hay login, así que se introduce el modelo real de miembros (`TenantMember` con rol) y un **actor demo**:

- La web elige "con quién actuar" y lo envía en `X-Demo-Member-Id`.
- Solo funciona con `DEMO_MODE=true`.
- El spec de identidad reemplaza el guard del actor por la sesión. Las reglas de permisos y los comandos quedan igual.

## Alcance

**Dentro:**

- **Modelo de datos:**
  - `TenantMember` con rol `OWNER` / `ADMIN` / `AGENT`.
  - `ConversationEvent`: `ASSIGNED`, `RELEASED`, `CLOSED` y `REOPENED`.
  - Llave foránea de `Conversation.assignedAgentId` a `tenant_members`.
- **Seed demo:** tres miembros, "Sup. Demo" (OWNER), "Laura" (AGENT) y "Mateo" (AGENT).
- **Actor demo:**
  - `DemoActorGuard` lee `X-Demo-Member-Id`, valida que el miembro sea del tenant demo y deja `ActorContext { tenantId, memberId, role }`.
  - `GET /api/v1/members` lista los miembros, para el selector y para el menú "Asignar a".
- **Comandos** (con `controlVersion` obligatorio en el cuerpo):
  - `POST /api/v1/conversations/:id/assign` `{ memberId, controlVersion }`. "Tomar" es asignarse a uno mismo.
  - `POST /api/v1/conversations/:id/release` `{ controlVersion }`.
  - `POST /api/v1/conversations/:id/close` `{ controlVersion }`.
  - `POST /api/v1/conversations/:id/reopen` `{ controlVersion }`.
  - Cada comando, en una sola transacción:
    - Bloquea la fila.
    - Valida rol, estado y `controlVersion`.
    - Aplica el cambio e incrementa `controlVersion`.
    - Escribe el `ConversationEvent` (que consume una `sequence`).
    - Encola `conversation.changed` con `reason: 'assignment'`.
- **Política de permisos** como función pura de dominio (tabla en el modelo de datos).
- **Bandejas:**
  - `GET /api/v1/conversations?inbox=ai|mine|all|closed`, filtrado por rol.
  - Un AGENT no ve conversaciones asignadas a otros agentes (`404` al abrirlas).
- **Línea de tiempo:** `GET /api/v1/conversations/:id/timeline` devuelve mensajes y eventos intercalados por `sequence`, paginados igual que los mensajes. `/messages` se mantiene sin cambios.
- **Reapertura automática:** un inbound en una conversación `CLOSED` la reabre, la devuelve a la IA y registra `REOPENED` sin actor.
- **IA:** con la conversación asignada, `inbound` devuelve `aiAllowed: false`, y un outbound de IA con el `controlVersion` anterior responde `409 CONTROL_CHANGED`.
- **Web:**
  - Selector "Actuar como" en el header (`localStorage`).
  - Pestañas de bandeja. "Todas" se oculta para AGENT.
  - Estado en el encabezado del chat: "IA activa", "Asignada a Laura" o "Cerrada".
  - Acciones según rol y estado: "Tomar", "Asignar a…", "Liberar a IA", "Cerrar" y "Reabrir".
  - Líneas de sistema en el historial.
  - Aviso cuando un comando choca: "La conversación cambió. Se actualizó con el estado actual".
- **Simulador:** sin cambios de código. Ya respeta `aiAllowed`. Se documenta el escenario "asignar mientras corre `--live`".

**Fuera de alcance (para specs futuros):**

- Escribir y enviar mensajes desde la PWA (SPEC 05).
- Login, invitaciones y alta real de miembros (spec de identidad).
- Asignación automática y reglas de enrutamiento.
- Contadores por bandeja, búsqueda y filtros.
- Header `Idempotency-Key` en los comandos. `controlVersion` ya evita los dobles efectos.
- Notificaciones al agente asignado.

## Modelo de datos

**Prisma:**

```prisma
enum MemberRole { OWNER ADMIN AGENT }
enum ConversationEventType { ASSIGNED RELEASED CLOSED REOPENED }

model TenantMember {
  id          String     @id @default(uuid(7)) @db.Uuid
  tenantId    String     @map("tenant_id") @db.Uuid
  displayName String     @map("display_name")
  email       String
  role        MemberRole
  createdAt   DateTime   @default(now()) @map("created_at") @db.Timestamptz(3)
  @@unique([tenantId, email])
  @@map("tenant_members")
}

model ConversationEvent {
  id             String                @id @default(uuid(7)) @db.Uuid
  tenantId       String                @map("tenant_id") @db.Uuid
  conversationId String                @map("conversation_id") @db.Uuid
  /// Comparte el contador `lastSequence` con los mensajes: una sola línea de tiempo.
  sequence       Int
  type           ConversationEventType
  actorMemberId  String?               @map("actor_member_id") @db.Uuid   // null = sistema (reapertura por inbound)
  targetMemberId String?               @map("target_member_id") @db.Uuid // agente asignado en ASSIGNED
  createdAt      DateTime              @default(now()) @map("created_at") @db.Timestamptz(3)
  @@unique([conversationId, sequence])
  @@map("conversation_events")
}

// Conversation.assignedAgentId pasa a ser FK -> tenant_members(id).
```

**Seed demo** (upsert por `(tenantId, email)`):

| displayName | email | role |
| --- | --- | --- |
| Sup. Demo | `supervisor@demo.omnidesk.local` | OWNER |
| Laura | `laura@demo.omnidesk.local` | AGENT |
| Mateo | `mateo@demo.omnidesk.local` | AGENT |

**Reglas de estado** (`conversations/domain`; cada transición incrementa `controlVersion`):

| Comando | Desde | Resultado | Evento |
| --- | --- | --- | --- |
| assign(memberId) | `OPEN` | `assignedAgentId = memberId` | `ASSIGNED` (actor, target) |
| release | `OPEN` y asignada | `assignedAgentId = null` (vuelve a la IA) | `RELEASED` |
| close | `OPEN` | `status = CLOSED`. **Conserva** `assignedAgentId` | `CLOSED` |
| reopen | `CLOSED` | `status = OPEN`, `assignedAgentId = null` | `REOPENED` |
| inbound en `CLOSED` | `CLOSED` | Igual que reopen, sin actor | `REOPENED` (actor null) |

- Si el `controlVersion` del comando no coincide, responde `409 { reason: 'CONTROL_CHANGED' }`.
- Si el comando no aplica al estado actual (p. ej. `close` sobre `CLOSED`), responde `409 { reason: 'INVALID_STATE' }`.

**Permisos** (`conversations/domain/conversation-policy.ts`):

| Acción | OWNER / ADMIN | AGENT |
| --- | --- | --- |
| Ver bandeja `ai` | ✓ | ✓ |
| Ver bandeja `mine` | ✓ | ✓ |
| Ver bandeja `all` | ✓ | ✗ (`403`) |
| Ver bandeja `closed` | Todas las cerradas | Solo las cerradas con `assignedAgentId = yo` |
| Abrir una conversación | Cualquiera | Sin asignar, o asignadas a él (si no, `404`) |
| Asignar a sí mismo ("Tomar") | ✓ | Solo si está sin asignar |
| Asignar o reasignar a otro | ✓ | ✗ |
| Liberar | Cualquiera asignada | Solo las suyas |
| Cerrar | Cualquiera | Solo las suyas |
| Reabrir | Cualquiera | Solo las suyas (`assignedAgentId = yo`) |

Una acción no permitida responde `403`. Si además el AGENT no puede ver la conversación, responde `404`.

**Bandejas:**

| `inbox` | Filtro |
| --- | --- |
| `ai` (default) | `status = OPEN` y `assignedAgentId IS NULL` |
| `mine` | `status = OPEN` y `assignedAgentId = actor` |
| `all` | `status = OPEN` (solo OWNER/ADMIN) |
| `closed` | `status = CLOSED`, más el filtro de rol de la tabla anterior |

**Contratos** (`packages/contracts`):

```ts
MemberSchema = { id, displayName, role: 'OWNER' | 'ADMIN' | 'AGENT' }
ListMembersResponseSchema = { items: Member[] }

ListConversationsQuerySchema += { inbox: 'ai' | 'mine' | 'all' | 'closed' (default 'ai') }
ConversationSummarySchema += { assignedAgent: { id, displayName } | null, controlVersion: int }

AssignConversationRequestSchema = { memberId, controlVersion }
ConversationCommandRequestSchema = { controlVersion }           // release / close / reopen
ConversationCommandResponseSchema = ConversationSummarySchema   // estado tras el comando
ConversationCommandRejectedSchema = { reason: 'CONTROL_CHANGED' | 'INVALID_STATE' }

TimelineItemSchema = discriminatedUnion('kind', [
  { kind: 'message', ...MessageSchema },
  { kind: 'event', id, sequence, type, actor: { id, displayName } | null, target: { id, displayName } | null, createdAt },
])
ListTimelineResponseSchema = { items: TimelineItem[] /* asc por sequence */, prevCursor: int | null }

RealtimeEventSchema.reason += 'assignment'
```

- Header del actor demo: `X-Demo-Member-Id: <uuid>`. Sin él, los endpoints de conversaciones responden `401` con "Selecciona con quién actuar".
- Clave de `localStorage`: `omnidesk:demo-member-id`.

## Plan de implementación

1. **Modelo y migración.**
   - `TenantMember`, `ConversationEvent`, enums y FK de `assignedAgentId`, en la migración `…_assignment`.
   - El seed demo añade los tres miembros.
2. **Contratos** nuevos y ampliados, con pruebas (inbox por defecto, unión discriminada del timeline, `memberId` uuid).
3. **Dominio.**
   - `conversation-policy.ts`, una función pura `can(actor, action, conversation, target?)`.
   - Transiciones `assign`, `release`, `close` y `reopen` que devuelven el nuevo estado o el motivo de rechazo.
   - Pruebas unitarias de **toda** la tabla de permisos y de la tabla de estados.
4. **Actor demo.**
   - `members` (repositorio, `ListMembersUseCase`, `GET /api/v1/members` con `DemoTenantGuard`).
   - `DemoActorGuard` (`401` sin header, `401` si el miembro no es del tenant demo) y decorador `@CurrentActor()`.
   - El controlador de conversaciones pasa de `DemoTenantGuard` a `DemoActorGuard`.
5. **Comandos.**
   - Casos de uso `AssignConversation`, `ReleaseConversation`, `CloseConversation` y `ReopenConversation`.
   - Usan `TransactionRunner`, `findByIdForUpdate`, la política, `appendEvent` (consume una `sequence`) y `OutboxPort` (`reason: 'assignment'`).
   - Controlador con los 4 `POST`.
   - Pruebas unitarias con repositorios en memoria.
6. **Lectura con bandejas y timeline.**
   - `ListConversations` acepta `inbox` y aplica el filtro por rol.
   - `GET /conversations/:id/messages` y `/timeline` responden `404` si el AGENT no puede ver la conversación.
   - `ListTimeline` combina mensajes y eventos por `sequence` (dos consultas de `limit + 1`, mezcla y recorte).
7. **Inbound sobre conversaciones cerradas.**
   - `RegisterInboundMessage` busca la última conversación del contacto en el canal. Si está `CLOSED`, la reabre (`REOPENED` sin actor, `controlVersion + 1`) antes de añadir el mensaje.
   - Prueba unitaria y e2e.
8. **e2e del API.** Matriz de permisos por rol, `409 CONTROL_CHANGED`, `aiAllowed: false` tras asignar, `409` de la IA con el `controlVersion` viejo, timeline con eventos y bandejas.
9. **Web: actor demo.**
   - `features/actor/`:
     - `useMembers`.
     - Store del actor (`localStorage`).
     - `ActorSelector` en el header.
   - `http-client` envía `X-Demo-Member-Id`.
   - Sin actor elegido, la bandeja muestra "Elige con quién actuar para ver la bandeja".
   - Por defecto se elige "Sup. Demo".
10. **Web: bandejas.**
    - Pestañas "IA", "Mías", "Todas" y "Cerradas" sobre la lista. "Todas" se oculta para AGENT.
    - La pestaña activa va en la URL (`?inbox=`).
    - Cada ítem muestra "IA" o el nombre del agente asignado.
11. **Web: acciones y timeline.**
    - El chat pasa a `/timeline`.
    - Las líneas de sistema van centradas:
      - "Sup. Demo asignó la conversación a Laura".
      - "Laura tomó la conversación".
      - "Laura liberó la conversación a la IA".
      - "Cerrada por Mateo".
      - "Reabierta por un mensaje del cliente".
    - El encabezado muestra el estado y los botones que permite `can(...)`; la UI replica la misma política del dominio vía contracts.
    - "Asignar a…" es un menú de miembros (solo OWNER/ADMIN).
    - Ante `409`, se muestra el aviso y se invalida la conversación.
12. **Documentación.**
    - README: escenario demo (asignar a Laura con `--live` corriendo; la IA deja de responder).
    - `docs/arquitectura.md`: §8 con la regla de cierre que conserva el agente, y §14.

## Criterios de aceptación

**Comandos y control de IA**

- [ ] Como Sup. Demo, `assign` a Laura con el `controlVersion` actual responde `200`. La conversación queda asignada, `controlVersion` sube en 1 y existe un `ConversationEvent ASSIGNED` con actor Sup. Demo y target Laura.
- [ ] Repetir ese `assign` con el `controlVersion` anterior responde `409 CONTROL_CHANGED`.
- [ ] Con la conversación asignada, un `inbound` nuevo devuelve `aiAllowed: false` y el nuevo `controlVersion`.
- [ ] Un outbound de IA con el `controlVersion` previo a la asignación responde `409 CONTROL_CHANGED` y no crea un mensaje.
- [ ] `release` devuelve la conversación a la IA, y el siguiente `inbound` devuelve `aiAllowed: true`.
- [ ] `close` deja `CLOSED` y conserva `assignedAgentId`. `reopen` deja `OPEN` con `assignedAgentId = null`.
- [ ] Un `inbound` sobre una conversación `CLOSED` la reabre (misma `conversationId`), crea `REOPENED` sin actor y devuelve `aiAllowed: true`.
- [ ] `close` sobre una conversación ya `CLOSED` responde `409 INVALID_STATE`.

**Permisos**

- [ ] Como Laura (AGENT):
  - Tomar una conversación de la IA responde `200`.
  - Asignar a Mateo responde `403`.
  - Tomar una conversación asignada a Mateo responde `404`.
  - `GET ?inbox=all` responde `403`.
- [ ] Como Laura, `GET /conversations/:id/timeline` de una conversación asignada a Mateo responde `404`.
- [ ] Sin `X-Demo-Member-Id`, o con un id de otro tenant, los endpoints de conversaciones responden `401`.
- [ ] Las pruebas unitarias cubren cada fila de la tabla de permisos y de la tabla de estados.

**Bandejas y timeline**

- [ ] `?inbox=ai` devuelve solo `OPEN` sin asignar, `mine` solo las del actor y `closed` solo `CLOSED` (filtradas por rol).
- [ ] `/timeline` intercala mensajes y eventos en orden de `sequence`, y `before` pagina igual que `/messages`.

**Web** (`http://localhost:8080`)

- [ ] El header tiene "Actuar como" con los 3 miembros. Cambiar de actor recarga las bandejas, y la elección sobrevive a recargar la página.
- [ ] Como Sup. Demo se ven 4 pestañas; como Laura, 3 (sin "Todas").
- [ ] Con `pnpm simulate --live` corriendo, asignar una conversación a Laura hace que:
  - En ≤ 1 s, la conversación sale de "IA" y aparece en "Mías" de Laura en otra pestaña del navegador.
  - El historial muestra "Sup. Demo asignó la conversación a Laura".
  - Los mensajes siguientes del cliente en esa conversación ya no reciben respuesta de IA.
- [ ] Al pulsar "Tomar" en dos pestañas casi a la vez, una gana y la otra muestra "La conversación cambió. Se actualizó con el estado actual".
- [ ] Cada botón del encabezado aparece solo si `can(...)` lo permite para el actor y el estado.
- [ ] En 390 px de ancho, las pestañas y las acciones caben sin scroll horizontal (los botones secundarios van en un menú "⋯").

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0, y el e2e del API pasa.

## Decisiones

- **Sí:** modelo real `TenantMember` con rol y un actor demo vía `X-Demo-Member-Id` (solo `DEMO_MODE`). Las reglas de permisos se prueban ya, y la identidad solo cambia el guard. Lo decidió el equipo.
- **No:** identidad antes de la asignación. Retrasa un spec la funcionalidad central.
- **Sí:** permisos por rol (tabla de este spec), como función pura de dominio reutilizada por la UI. Lo decidió el equipo.
- **Sí:** `controlVersion` obligatorio en cada comando. Evita acciones sobre un estado viejo (dos pestañas, dos supervisores) y hace innecesario el `Idempotency-Key` por ahora.
- **No:** `Idempotency-Key` en los comandos en este spec. Un doble clic con el mismo `controlVersion` responde `409` sin efecto doble.
- **Sí:** "Tomar" = `assign` a uno mismo. Es un comando menos y la regla vive en la política.
- **Sí:** `close` conserva `assignedAgentId`. "Cerradas" del agente es un filtro simple. Reabrir devuelve a la IA, como en la arquitectura. Lo decidió el equipo.
- **Sí:** `ConversationEvent` comparte el contador `sequence` con los mensajes. Da una línea de tiempo única y estable sin ordenar por fechas.
- **Sí:** un endpoint nuevo `/timeline`, manteniendo `/messages`. `/messages` sigue siendo el contrato simple de solo mensajes para integraciones.
- **Sí:** líneas de sistema en el historial. Trazabilidad visible de quién tomó, liberó o cerró. Lo decidió el equipo.
- **Sí:** un inbound sobre una conversación cerrada reabre la misma conversación, sin crear una nueva. Es la decisión por defecto de la arquitectura §8 y conserva el historial completo.
- **Sí:** un AGENT recibe `404` (no `403`) al abrir conversaciones de otros. No revela que existen.
- **No:** contadores por bandeja. Exigen consultas de agregación por evento; llegan con métricas.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La UI y el API divergen en permisos | La política es una función pura con pruebas. La UI la usa solo para mostrar botones; el API siempre decide. Un `403` inesperado se muestra como aviso. |
| Carrera entre la IA y la asignación | Protocolo `controlVersion` con bloqueo de fila (arquitectura §9). Queda una ventana residual de milisegundos entre el `201` del outbound y el envío real; está aceptada. |
| El actor demo se usa en producción | `DemoActorGuard` solo existe con `DEMO_MODE=true`, que está prohibido en producción. |
| El timeline mezcla dos tablas y pagina mal | Ambas comparten el contador `sequence` y el cursor es una `sequence`. Hay una prueba e2e con eventos en el borde entre páginas. |
| El FK de `assignedAgentId` falla con datos previos | En el SPEC 02 siempre es null. La migración añade el FK sin datos que migrar. |

## Lo que **no** entra en este spec

- Escribir mensajes desde la PWA.
- Login, invitaciones y gestión de miembros.
- Asignación automática y contadores.
- `Idempotency-Key` y notificaciones.

Cada uno llega en su propio spec (SPEC 05, identidad o posteriores).
