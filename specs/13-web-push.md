# SPEC 13 — Robustez IV: notificaciones Web Push

> **Status:** Implemented
> **Depends on:** SPEC 06, SPEC 07, SPEC 08
> **Date:** 2026-10-12
> **Objective:** Los miembros activan notificaciones Web Push por dispositivo y eligen con 4 interruptores cuáles reciben (asignación, mensaje del cliente, envío fallido, nueva conversación en IA), y el API las envía mediante el Outbox con VAPID, mostrando el nombre del contacto y un preview que al tocarse abre la conversación en la PWA.

## Por qué existe este spec

Un agente no tiene la PWA abierta todo el día. Sin notificaciones, se entera tarde de que le asignaron un chat o de que el cliente respondió. Web Push funciona en Android, en escritorio y en iOS ≥ 16.4, aunque en iOS **solo con la PWA instalada** (§14, incremento 7). Por eso depende del despliegue con HTTPS (SPEC 08).

Las notificaciones se generan como eventos del Outbox, en la misma transacción que el cambio que las provoca. Así se aprovecha el dispatcher con reintentos (SPEC 03, SPEC 05), y nunca se notifica algo que no ocurrió.

## Alcance

**Dentro:**

- **Suscripciones por dispositivo** (`PushSubscription`, ligada al `User`).
  - `POST /api/v1/push/subscriptions { endpoint, keys: { p256dh, auth } }` es idempotente por `endpoint`.
  - `DELETE /api/v1/push/subscriptions { endpoint }`.
  - Al cerrar sesión, la web borra la suscripción del dispositivo.
- **Claves VAPID por entorno:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`mailto:`). `GET /api/v1/push/config` devuelve la clave pública.
- **Preferencias por miembro** (una empresa = un juego de interruptores):

  | Interruptor | Por defecto | Destinatarios |
  | --- | --- | --- |
  | Conversación asignada a mí | activado | El agente destino, si no es quien asigna |
  | Nuevo mensaje del cliente en mis conversaciones | activado | El agente asignado |
  | Mi mensaje no se pudo enviar | activado | El emisor (`senderMemberId`) cuando pasa a `FAILED` |
  | Nueva conversación en IA | **desactivado** | OWNER y ADMIN con el interruptor activado |

  - `GET /api/v1/me/notification-preferences` y `PATCH` con los 4 booleanos.
- **Disparadores** (eventos `notification.requested` en el Outbox, en la misma transacción que el cambio):
  - `AssignConversation` → `assigned`.
  - `RegisterInboundMessage`:
    - En una conversación asignada → `customer_message`.
    - Si crea una conversación nueva → `new_ai_conversation`.
  - Dispatcher, al marcar un mensaje `FAILED` → `send_failed`.
- **Supresión de "mensaje del cliente" cuando el agente ya lo está viendo:**
  - La web emite `presence { conversationId | null, visible, endpoint | null }` por Socket.IO cuando cambia `visibilitychange` o la conversación abierta. `endpoint` es la suscripción push de ese navegador.
  - El API guarda en memoria la presencia por socket.
  - El dispatcher omite `customer_message` solo para la suscripción cuyo socket tiene `visible: true` y esa conversación abierta. Los demás dispositivos del miembro (otro navegador, el móvil) sí reciben el aviso.
  - Las demás notificaciones nunca se suprimen.
- **Envío:**
  - Con la librería `web-push`, a todas las suscripciones de los usuarios destinatarios.
  - `TTL` de 1 h.
  - `Topic` igual al `conversationId` sin guiones, para que el servicio de push reemplace las pendientes de la misma conversación.
  - Una respuesta `404`/`410` borra la suscripción.
  - Otros errores se reintentan con la política del Outbox, hasta 3 intentos (en push, una notificación tardía no aporta).
- **Contenido:**
  - **Título:** nombre del contacto y teléfono ("Ana · +573001112233") o, si no tiene nombre, solo el teléfono.
  - **Cuerpo:**
    - `assigned`: "Te asignaron esta conversación".
    - `customer_message` y `new_ai_conversation`: el preview del mensaje, de 80 caracteres como máximo, con "…". Es el mismo texto que la bandeja (`previewSource`): con adjunto, su tipo y el pie ("Foto", "Foto · pie", "Nota de voz").
    - `send_failed`: "No se pudo enviar tu mensaje".
  - `tag` = `conversationId` (agrupa en el dispositivo), y el icono es el de la app.
  - Al tocarla, se enfoca una ventana existente de la PWA y se navega a `/omnidesk/conversations/:id`, o se abre una nueva.
- **Service worker:**
  - Pasa de `generateSW` a `injectManifest`, con `apps/web/src/sw.ts`.
  - Conserva las reglas de precache y de fallback de SPEC 01 y SPEC 08, y añade los manejadores `push` y `notificationclick`.
  - Siempre muestra la notificación que recibe (requisito de `userVisibleOnly`).
- **Pantalla `/settings/notifications`** (todos los roles):
  - Estado del permiso en este dispositivo:
    - "Activar notificaciones en este dispositivo" (`default`).
    - "Activadas" (`granted` y suscrito).
    - "Bloqueadas: actívalas en los ajustes del navegador" (`denied`).
  - En iOS sin instalar, muestra la instrucción "Instala la app (Compartir → Añadir a pantalla de inicio) para recibir notificaciones" en lugar del botón.
  - Los 4 interruptores; el cuarto solo para OWNER y ADMIN.
  - Botón "Enviar notificación de prueba" (`POST /api/v1/push/test`), que llega solo a los dispositivos del usuario.
  - El permiso se pide únicamente al pulsar el botón (gesto del usuario), nunca al cargar.

**Fuera de alcance (para specs futuros):**

- Notificaciones por email, SMS o WhatsApp al agente.
- Horario de silencio y "no molestar".
- Contador en el icono (Badging API) y no leídos.
- Notificaciones con acciones (responder desde la notificación).
- Resumen agrupado ("3 mensajes nuevos de 2 conversaciones").
- Elegir los dispositivos uno a uno en la UI.

## Modelo de datos

**Prisma (nuevo y cambios):**

```prisma
model PushSubscription {
  id         String   @id @default(uuid(7)) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  endpoint   String   @unique
  p256dh     String
  auth       String
  userAgent  String?  @map("user_agent")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  lastUsedAt DateTime? @map("last_used_at") @db.Timestamptz(3)
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("push_subscriptions")
}

model TenantMember {
  // … campos de SPEC 07
  notifyAssigned          Boolean @default(true)  @map("notify_assigned")
  notifyCustomerMessage   Boolean @default(true)  @map("notify_customer_message")
  notifySendFailed        Boolean @default(true)  @map("notify_send_failed")
  notifyNewAiConversation Boolean @default(false) @map("notify_new_ai_conversation")
}
```

- `push_subscriptions` no tiene `tenant_id`: pertenece al usuario, no a la empresa. La consulta el dispatcher (camino de sistema de SPEC 12).
- Las preferencias sí son por empresa, porque un usuario puede ser OWNER en una y AGENT en otra.
- Si un usuario pertenece a varias empresas, recibe las notificaciones de todas en las que tenga los interruptores activados. Al tocar una de otra empresa, la web cambia la empresa activa antes de navegar.

**Payload del Outbox y del push:**

```ts
// outbox_events.payload para type = 'notification.requested'
type NotificationRequested = {
  kind: 'assigned' | 'customer_message' | 'send_failed' | 'new_ai_conversation';
  tenantId: string;
  conversationId: string;
  recipientMemberIds: string[];        // resuelto en la transacción según las preferencias
  messageId?: string;
};

// Cuerpo cifrado que recibe el service worker (≤ 4 KB)
type PushPayload = {
  title: string; body: string; tag: string;
  url: string;                         // "/omnidesk/conversations/<id>"
  tenantId: string;
};
```

**Contratos** (`packages/contracts/src/push.ts`):

```ts
PushConfigResponseSchema = { vapidPublicKey: z.string() }
PushSubscriptionRequestSchema = { endpoint: z.url(), keys: { p256dh: z.string(), auth: z.string() } }
NotificationPreferencesSchema = { assigned: z.boolean(), customerMessage: z.boolean(),
                                  sendFailed: z.boolean(), newAiConversation: z.boolean() }
PresenceEventSchema = { conversationId: z.uuid().nullable(), visible: z.boolean() }   // socket
```

**Variables de entorno:**

```
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:soporte@gastromesa.com
# Sin VAPID_* el módulo push queda deshabilitado (la pantalla lo indica) y no se encolan notificaciones.
```

**Funciones puras**, con pruebas:

```ts
buildPushPayload(kind, contact: { displayName, externalId }, preview: string | null, conversationId, basePath): PushPayload
truncatePreview(text: string, max = 80): string
resolveRecipients(kind, ctx: { actorMemberId, assignedAgentId, senderMemberId, members: MemberPrefs[] }): string[]
shouldSuppress(kind, memberId, conversationId, presence: PresenceMap): boolean
```

## Plan de implementación

1. **Modelo, contratos y VAPID.**
   - Tabla, columnas de preferencias y contratos.
   - `VAPID_*` en `env.ts`, más el script `pnpm --filter @omnidesk/api vapid:generate` para crear las claves.
2. **Suscripciones y preferencias (API).**
   - `GET /push/config`.
   - `POST`/`DELETE /push/subscriptions`.
   - `GET`/`PATCH /me/notification-preferences`.
   - e2e.
3. **Service worker con `injectManifest`.**
   - Migrar a `src/sw.ts` sin cambiar el comportamiento: siguen funcionando la precarga, el fallback bajo `/omnidesk` y "Nueva versión disponible".
   - Añadir `push` y `notificationclick`.
4. **Web: `/settings/notifications`.**
   - Estados del permiso, detección de iOS sin instalar (reutiliza `install-mode.ts`), suscripción con `pushManager.subscribe` e interruptores.
   - Borrar la suscripción en el logout.
5. **Envío y notificación de prueba.**
   - Módulo `notifications`: puerto `PushSender` con el adaptador `WebPushSender`, y `POST /push/test`.
   - Borrado de la suscripción ante `404`/`410`.
   - Prueba unitaria con un `PushSender` falso.
6. **Disparadores en el Outbox.**
   - `notification.requested` encolado en `AssignConversation`, `RegisterInboundMessage` y la transición a `FAILED`, con `resolveRecipients`.
   - El dispatcher enruta el tipo hacia `PushSender`, con 3 intentos como máximo.
   - Pruebas de cada disparador y de que no se notifica a quien hizo la acción.
7. **Presencia y supresión.**
   - Evento `presence` en el gateway Socket.IO y mapa en memoria por miembro, que se limpia al desconectar.
   - `shouldSuppress` en el dispatcher.
   - La web emite `presence` en `visibilitychange` y al cambiar de conversación.
8. **Cambio de empresa al tocar.** Si `payload.tenantId` ≠ la empresa activa, se llama a `POST /me/active-tenant` antes de navegar.
9. **Documentación.**
   - README: generar las claves VAPID, probar en Android, escritorio e iPhone (instalada).
   - `docs/arquitectura.md` §14.

## Criterios de aceptación

**Activación**

- [ ] En Chrome de escritorio, "Activar notificaciones" pide permiso solo al pulsar. Al aceptar, aparece "Activadas" y se crea una fila en `push_subscriptions`.
- [ ] "Enviar notificación de prueba" muestra una notificación en ≤ 5 s.
- [ ] Con el permiso bloqueado, la pantalla muestra "Bloqueadas: actívalas en los ajustes del navegador" y ningún botón de activar.
- [ ] En Safari de iPhone sin instalar, la pantalla muestra la instrucción de instalar. Con la PWA instalada desde `https://dev.gastromesa.com/omnidesk`, la activación y la notificación de prueba funcionan.
- [ ] Cerrar sesión borra la suscripción del dispositivo, y la notificación de prueba enviada desde otra sesión ya no llega a ese dispositivo.
- [ ] Un AGENT no ve el interruptor "Nueva conversación en IA".

**Disparadores** (Laura con notificaciones activadas y la PWA en segundo plano)

- [ ] Sup. Demo asigna una conversación a Laura: Laura recibe "Te asignaron esta conversación" con el nombre del contacto.
- [ ] Laura se asigna a sí misma una conversación: no recibe notificación.
- [ ] El cliente escribe en una conversación de Laura: Laura recibe el nombre y el preview, recortado a 80 caracteres.
- [ ] Con esa misma conversación abierta y visible en la PWA de Laura, un nuevo mensaje del cliente **no** genera notificación en ese dispositivo, pero sí en sus otros dispositivos. Con la pestaña oculta, sí.
- [ ] Con `SIMULATED_PROVIDER_FAILURE_RATE=1`, el mensaje de Laura que queda `FAILED` genera "No se pudo enviar tu mensaje".
- [ ] Con "Nuevo mensaje del cliente" desactivado, Laura no recibe esa notificación pero sí las de asignación.
- [ ] Sup. Demo con "Nueva conversación en IA" activado recibe una notificación al crearse una conversación nueva desde el simulador. Con el interruptor desactivado (por defecto), no.
- [ ] Tocar la notificación abre `/omnidesk/conversations/<id>` en la PWA (enfocándola si ya estaba abierta).
- [ ] Cinco mensajes seguidos del cliente en la misma conversación dejan una sola notificación visible en el dispositivo (`tag`).

**Robustez**

- [ ] Una suscripción con endpoint caducado (`410`) se borra al primer intento, y el resto de dispositivos del usuario sigue recibiendo.
- [ ] Sin `VAPID_*`, la app arranca, `/settings/notifications` muestra "Notificaciones no disponibles en este entorno" y el Outbox no encola `notification.requested`.
- [ ] Siguen funcionando la actualización del service worker ("Nueva versión disponible") y el fallback de rutas bajo `/omnidesk`.

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0, y el e2e del API pasa.

## Decisiones

- **Sí:** las 4 notificaciones, con interruptores por miembro. Lo decidió el equipo. "Nueva conversación en IA" viene desactivada porque es ruidosa.
- **Sí:** nombre del contacto + preview de 80 caracteres. Lo decidió el equipo. Es más útil que un texto genérico, a costa de mostrar datos en la pantalla de bloqueo. Se documenta.
- **Sí:** notificaciones por el Outbox (`notification.requested`). Solo se notifica lo que se confirmó en la base, con reintentos y sin bloquear el caso de uso.
- **Sí:** destinatarios resueltos en la transacción que crea el evento. Las preferencias vigentes en ese momento deciden; cambios posteriores no afectan a lo ya encolado.
- **Sí:** supresión en el servidor según la presencia por socket, no en el service worker. iOS y Chrome penalizan o revocan el permiso si un `push` no muestra notificación.
- **Sí:** presencia en memoria. Hay una sola instancia del API (SPEC 08). Con varias instancias pasa a Redis junto con el adapter de Socket.IO.
- **Sí:** suscripción por usuario y preferencias por miembro. Un dispositivo pertenece a una persona, y lo que quiere recibir depende de su rol en cada empresa.
- **Sí:** `injectManifest` con `src/sw.ts`. `generateSW` no admite manejadores `push` propios sin `importScripts`, y tener el código tipado en el repo es más claro.
- **Sí:** máximo 3 intentos para el push. Una notificación de hace minutos ya no sirve, y el `TTL` de 1 h la descarta en el servicio de push.
- **No:** horario de silencio ni resumen agrupado. Son mejoras de UX para otro spec.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| iOS no entrega push si la PWA no está instalada o el permiso se pidió sin gesto | La pantalla detecta el modo y muestra la instrucción. El permiso solo se pide al pulsar. Hay un criterio verificado en un iPhone real. |
| Datos del cliente visibles en la pantalla de bloqueo | Aceptado por el equipo. Se documenta en el README, y desactivar los interruptores lo evita. |
| Migrar a `injectManifest` rompe la caché o la actualización de la PWA | Paso 3 aislado, sin push, verificado contra los criterios PWA de SPEC 01 y SPEC 08 antes de añadir manejadores. |
| Avalancha de notificaciones con `simulate --live` | `Topic` y `tag` por conversación reemplazan las anteriores. "Nueva conversación en IA" viene desactivada. |
| Presencia desactualizada (socket zombi) hace suprimir de más | La presencia se borra al desconectar, y Socket.IO detecta las caídas por ping (≈ 25 s). Solo se suprime `customer_message`. |
| Pérdida de las claves VAPID invalida todas las suscripciones | Se guardan junto a los demás secretos del entorno (`docs/despliegue.md`). Si se regeneran, la web se vuelve a suscribir al abrir `/settings/notifications`. |

## Lo que **no** entra en este spec

- Email, SMS o WhatsApp al agente.
- Horario de silencio.
- Badging API y no leídos.
- Respuesta desde la notificación.
- Resúmenes agrupados.
- Gestión de dispositivos en la UI.

Cada uno llega en su propio spec.
