# SPEC 05 — Atención humana: el agente responde desde la PWA

> **Status:** Approved
> **Depends on:** SPEC 03, SPEC 04
> **Date:** 2026-10-12
> **Objective:** El agente asignado escribe desde la PWA. El mensaje se registra como `PENDING`, se envía por el puerto `MessagingProvider` (adaptador simulado) mediante el Outbox con reintentos, y su estado de entrega (enviado, entregado, leído o fallido) se ve en tiempo real con opción de reintentar.

## Por qué existe este spec

Cierra el ciclo del MVP: un humano toma la conversación (SPEC 04) y ahora **responde**.

El envío sigue la regla de la arquitectura §12:

1. Registrar la intención como `PENDING`.
2. Enviar por el proveedor.
3. Actualizar el estado con la confirmación real.

Así nunca se confunde texto escrito con envío exitoso.

El proveedor es un puerto. Este spec trae un adaptador **simulado**, que confirma `SENT` → `DELIVERED` → `READ` con retrasos y puede fallar a propósito. El adaptador n8n/WhatsApp real llega después sin tocar el dominio.

También se añade el endpoint `POST /integrations/messages/status`, para que n8n (o el simulador) reporte los estados de las respuestas de IA, con deduplicación en `EventInbox`.

## Alcance

**Dentro:**

- **Envío desde la PWA:**
  - `POST /api/v1/conversations/:id/messages` `{ text, clientMessageId }`.
  - Solo el agente asignado (actor = `assignedAgentId`) y con la conversación `OPEN`.
  - Idempotente por `clientMessageId`.
  - Crea el `Message` (`AGENT`, `OUTBOUND`, `PENDING`, `senderMemberId`) y encola en la misma transacción `message.send_requested` y `conversation.changed` (`reason: 'delivery'`).
- **Reintento manual:** `POST /api/v1/conversations/:id/messages/:messageId/retry`. Solo mensajes `FAILED` del agente asignado. Los devuelve a `PENDING` y encola un nuevo envío.
- **Puerto `MessagingProvider`** (módulo `messaging`): `send(request) → { providerMessageId }`; lanza un error si falla.
- **Adaptador `SimulatedMessagingProvider`:**
  - Falla con probabilidad `SIMULATED_PROVIDER_FAILURE_RATE`.
  - Si no falla, devuelve `providerMessageId` y programa `DELIVERED` (+1,5 s) y `READ` (+4 s) usando el mismo caso de uso que el endpoint de estados.
- **Dispatcher del Outbox** (SPEC 03), que ahora enruta por tipo:
  - `conversation.changed` va a Socket.IO.
  - `message.send_requested` va a `MessagingProvider`:
    - Si tiene éxito, el mensaje pasa a `SENT` y se guarda `externalId = providerMessageId`.
    - Si falla, reintenta con backoff de 1, 2, 4, 8 y 16 s. Tras 5 intentos fallidos, el mensaje pasa a `FAILED` con `failureReason`.
  - Cada cambio de estado encola `conversation.changed` (`reason: 'delivery'`).
- **Estados de entrega:**
  - `POST /api/v1/integrations/messages/status` `{ messageId, providerMessageId, status, occurredAt, error? }`, con la credencial del canal.
  - Deduplica en `EventInbox` por `(channelId, "<messageId>:<status>")`.
  - Las transiciones son monótonas: un estado nunca retrocede (`READ` no vuelve a `DELIVERED`). `FAILED` solo se acepta desde `PENDING` o `SENT`.
- **Simulador:** tras registrar cada respuesta de IA, reporta `SENT` y luego `DELIVERED` por `/status`, como lo hará n8n.
- **Web:**
  - Composer en el chat, solo para el agente asignado.
    - Enter envía; Shift+Enter hace un salto de línea.
    - Contador desde 3800 caracteres; el límite es 4096.
  - Si la conversación está en la IA, el composer se reemplaza por "Tomar conversación para responder". Si está asignada a otro, por "Asignada a Laura".
  - Ticks:
    - Reloj: `PENDING`.
    - ✓: `SENT`.
    - ✓✓: `DELIVERED`.
    - ✓✓ azul: `READ`.
    - Rojo con "No enviado · Reintentar": `FAILED`.
  - Las burbujas de agente muestran el nombre del agente ("Laura") en lugar de "Agente".
  - Las burbujas de IA también muestran ticks.

**Fuera de alcance (para specs futuros):**

- Adaptador n8n/WhatsApp real y firma HMAC (spec de integración real o de despliegue).
- Multimedia, adjuntos, plantillas y respuestas rápidas.
- Edición o borrado de mensajes enviados.
- Indicador "escribiendo…" y notas internas.
- Notificaciones push al agente.

## Modelo de datos

**Prisma (cambios):**

```prisma
model Message {
  // … campos del SPEC 02
  senderMemberId String?  @map("sender_member_id") @db.Uuid   // FK tenant_members; solo AGENT
  clientMessageId String? @map("client_message_id")           // idempotencia del composer
  failureReason  String?  @map("failure_reason")
  statusUpdatedAt DateTime? @map("status_updated_at") @db.Timestamptz(3)
  @@unique([conversationId, clientMessageId])
  // externalId ya existe: para OUTBOUND guarda el providerMessageId (único por canal)
}

model EventInbox {
  id         String   @id @default(uuid(7)) @db.Uuid
  channelId  String   @map("channel_id") @db.Uuid
  /// "<messageId>:<status>" para estados de entrega.
  externalId String   @map("external_id")
  receivedAt DateTime @default(now()) @map("received_at") @db.Timestamptz(3)
  @@unique([channelId, externalId])
  @@map("event_inbox")
}
```

`OutboxEvent` no cambia: usa `attempts`, `nextAttemptAt` y `lastError` del SPEC 03 con el nuevo `type = 'message.send_requested'`.

**Transiciones de estado** (`conversations/domain/delivery.ts`, función pura):

| Desde \ Hacia | SENT | DELIVERED | READ | FAILED |
| --- | --- | --- | --- | --- |
| PENDING | ✓ | ✓ | ✓ | ✓ |
| SENT | — | ✓ | ✓ | ✓ |
| DELIVERED | ignorar | — | ✓ | ignorar |
| READ | ignorar | ignorar | — | ignorar |
| FAILED | ✓ (reintento exitoso) | ignorar | ignorar | — |

"Ignorar" significa responder `200` sin cambiar nada. Así los reportes que llegan desordenados no hacen retroceder el estado.

**Contratos:**

```ts
SendAgentMessageRequestSchema = { text: MessageText, clientMessageId: z.uuid() }
SendAgentMessageResponseSchema = MessageSchema                        // PENDING
MessageSchema += { sender: { id, displayName } | null, failureReason: string | null }

DeliveryStatusRequestSchema = {
  messageId: z.uuid(),
  providerMessageId: z.string().min(1).max(200),
  status: z.enum(['SENT', 'DELIVERED', 'READ', 'FAILED']),
  occurredAt: z.iso.datetime(),
  error: z.string().max(500).optional(),
}
DeliveryStatusResponseSchema = { applied: boolean, status: MessageStatus }  // applied=false si se ignoró

RealtimeEventSchema.reason += 'delivery'
```

**Puerto:**

```ts
// messaging/application/ports/messaging-provider.port.ts
export interface MessagingProvider {
  send(request: { tenantId: string; channelId: string; messageId: string; to: string; text: string }):
    Promise<{ providerMessageId: string }>;   // lanza un error si el proveedor falla
}
```

**Variables de entorno nuevas:**

| Variable | Validación | Default |
| --- | --- | --- |
| `MESSAGING_PROVIDER` | `simulated` (único valor admitido en este spec) | `simulated` |
| `SIMULATED_PROVIDER_FAILURE_RATE` | número entre 0 y 1 | `0` |

## Plan de implementación

1. **Modelo y migración** `…_human_messages`: columnas nuevas de `Message`, FK de `senderMemberId` y la tabla `EventInbox`.
2. **Contratos** nuevos y ampliados, con pruebas.
3. **Dominio de entrega:** `delivery.ts` con la tabla de transiciones y pruebas unitarias de cada celda.
4. **Envío desde la PWA.**
   - Caso de uso `SendAgentMessage`:
     - Valida actor = asignado y la conversación `OPEN`; si no, `403` o `409 INVALID_STATE`.
     - Si el `clientMessageId` ya existe, devuelve ese mensaje.
     - Añade el mensaje y encola `message.send_requested` y `conversation.changed`.
   - Controlador `POST /conversations/:id/messages` con `DemoActorGuard`.
   - Pruebas unitarias y e2e.
5. **Puerto y adaptador simulado.**
   - Módulo `messaging` con `MESSAGING_PROVIDER` validado en `env.ts`.
   - `SimulatedMessagingProvider` con la tasa de fallo y los estados programados vía `UpdateDeliveryStatus`.
   - Prueba unitaria con un reloj o temporizador falso.
6. **Dispatcher con envío.**
   - Enrutamiento por `type`.
   - `message.send_requested`:
     - Llama a `send`.
     - Si tiene éxito, `SENT` + `externalId`.
     - Si falla, programa el reintento (1/2/4/8/16 s). Tras 5 fallos, `FAILED` + `failureReason`.
   - Cada transición encola `conversation.changed`.
   - Pruebas unitarias con un proveedor falso que falla N veces.
7. **Estados por integración.**
   - Caso de uso `UpdateDeliveryStatus`: `EventInbox` (dedupe), transición monótona y outbox.
   - Controlador `POST /integrations/messages/status` con `ChannelCredentialGuard`. Un `messageId` de otro canal responde `404`.
   - e2e: duplicado (`applied: false`), orden inverso (`READ` y luego `DELIVERED`) e ignorados.
8. **Reintento manual.**
   - `RetryFailedMessage`: solo `FAILED` y solo el agente asignado; pasa a `PENDING` y encola un nuevo envío.
   - Controlador `POST /conversations/:id/messages/:messageId/retry`.
   - e2e.
9. **Simulador.** Después de cada outbound de IA aceptado, reporta `SENT` y, 1 s después, `DELIVERED` por `/status`, con `providerMessageId = sim-ai-<messageId>`.
10. **Web: composer.**
    - `features/conversations/ui/message-composer.tsx`: textarea autoajustable, Enter / Shift+Enter, contador desde 3800 y botón deshabilitado si el texto está vacío.
    - `clientMessageId = crypto.randomUUID()` (con el fallback de `newRequestId`) por cada mensaje, conservado al reintentar ante errores de red.
    - Visible solo para el agente asignado. En los demás casos, el botón "Tomar conversación para responder" (si `can(...)`) o el texto "Asignada a <nombre>".
    - `index.html`: el meta `viewport` añade `interactive-widget=resizes-content`, y el composer respeta `safe-area-inset-bottom`.
11. **Web: estados y reintento.**
    - `MessageBubble`: ticks por estado (lucide `Clock`, `Check`, `CheckCheck`, `CheckCheck` en azul, `AlertCircle`), nombre del agente y "No enviado · Reintentar" en `FAILED`, que llama a `/retry`.
    - `toBubbleView` amplía su modelo (`deliveryIcon`, `canRetry`), con pruebas.
12. **Documentación.**
    - README: escenario completo (tomar, responder, ver los ticks; `SIMULATED_PROVIDER_FAILURE_RATE=1` para probar el reintento).
    - `docs/arquitectura.md` §14: el SPEC 05 completa el ciclo del MVP en local.

## Criterios de aceptación

**Envío**

- [ ] Como Laura, con la conversación asignada a ella, `POST /messages` responde `201` con `status: PENDING`, `senderType: AGENT` y `sender.displayName: "Laura"`.
- [ ] Repetir el `POST` con el mismo `clientMessageId` devuelve el mismo mensaje sin crear filas.
- [ ] Como Mateo (no asignado), el mismo `POST` responde `404` (no ve la conversación). Como Sup. Demo (la ve, pero no está asignado), responde `403`.
- [ ] En una conversación `CLOSED`, responde `409 INVALID_STATE`.
- [ ] Con `SIMULATED_PROVIDER_FAILURE_RATE=0`, el mensaje pasa a `SENT` en ≤ 1 s, a `DELIVERED` en ≈ 1,5 s y a `READ` en ≈ 4 s, y `externalId` queda con el `providerMessageId`.
- [ ] Con `SIMULATED_PROVIDER_FAILURE_RATE=1`, el mensaje queda `FAILED` tras 5 intentos (≈ 31 s), con `failureReason`, y `outbox_events.attempts = 5`.
- [ ] `POST /retry` sobre ese mensaje (con la tasa de vuelta en 0) lo lleva a `PENDING` y después a `SENT`.
- [ ] `POST /retry` sobre un mensaje que no está en `FAILED` responde `409 INVALID_STATE`.

**Estados por integración**

- [ ] `POST /integrations/messages/status` con `SENT` para un mensaje de IA `PENDING` responde `200 { applied: true, status: 'SENT' }`.
- [ ] Repetir el mismo reporte responde `200 { applied: false }` y no crea filas en `event_inbox`.
- [ ] Reportar `READ` y después `DELIVERED` deja el mensaje en `READ` (`applied: false` en el segundo).
- [ ] Un `messageId` de otro canal responde `404`. Sin credencial, `401`.
- [ ] Tras `pnpm simulate`, las respuestas de IA quedan en `DELIVERED`.

**Web** (`http://localhost:8080`)

- [ ] Como Laura, en una conversación asignada a ella, aparece el composer. Escribir y pulsar Enter muestra la burbuja con reloj, y los ticks avanzan ✓ → ✓✓ → ✓✓ azul sin recargar.
- [ ] Shift+Enter inserta un salto de línea, y el botón de enviar está deshabilitado con el texto vacío.
- [ ] En una conversación en la IA, en lugar del composer aparece "Tomar conversación para responder". Al pulsarlo, se toma la conversación y aparece el composer.
- [ ] En una conversación asignada a Mateo, Sup. Demo ve "Asignada a Mateo" sin composer.
- [ ] Con `SIMULATED_PROVIDER_FAILURE_RATE=1`, la burbuja termina en rojo con "No enviado · Reintentar".
- [ ] Con la tasa de vuelta en 0, pulsar "Reintentar" la lleva a ✓.
- [ ] En otra pestaña (como Sup. Demo, en "Todas"), el mensaje de Laura y sus ticks aparecen en ≤ 1 s.
- [ ] En 390 px de ancho, el composer queda fijo abajo, respeta `safe-area-inset-bottom` y no se tapa con el teclado en iOS (`interactive-widget=resizes-content`).

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0, y el e2e del API pasa.

## Decisiones

- **Sí:** proveedor simulado detrás del puerto `MessagingProvider`. Se prueba el ciclo completo sin depender de n8n ni de WhatsApp. Lo decidió el equipo.
- **No:** el adaptador n8n en este spec. Requiere n8n y un número configurados, y llega con la integración real.
- **Sí:** `MESSAGING_PROVIDER=simulated` global. Hoy hay un único adaptador; cuando haya dos, la selección pasa a `Channel.provider`, como dice la arquitectura §13.
- **Sí:** el envío pasa por el Outbox (`message.send_requested`) con backoff 1/2/4/8/16 s y 5 intentos. Nunca se envía dentro de la transacción del caso de uso, y una caída del proveedor no pierde mensajes.
- **Sí:** reintento manual tras `FAILED`. El agente decide reenviar. Lo decidió el equipo, junto con los ticks.
- **Sí:** ticks completos (`PENDING`/`SENT`/`DELIVERED`/`READ`/`FAILED`). Son el modelo de WhatsApp y el adaptador simulado los reproduce. Lo decidió el equipo.
- **Sí:** solo el agente asignado escribe. Evita respuestas cruzadas; un OWNER/ADMIN primero se asigna. Lo decidió el equipo.
- **Sí:** `clientMessageId` (uuid generado en la web) como idempotencia del composer. Un reintento por error de red no duplica el mensaje.
- **Sí:** transiciones de estado monótonas y deduplicación en `EventInbox`. Los proveedores entregan los webhooks repetidos y desordenados.
- **Sí:** `externalId` guarda también el `providerMessageId` de los salientes. Ya es único por canal y evita otra columna.
- **Sí:** el simulador reporta los estados de las respuestas de IA. Ejercita `/status` como lo hará n8n, y las respuestas de IA dejan de quedar en `PENDING`.
- **No:** "escribiendo…", notas internas ni plantillas. Son funcionalidades aparte.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Mensaje enviado dos veces si el proceso cae entre `send` y marcar `SENT` | `providerMessageId` determinista por `messageId` en el adaptador simulado. El adaptador real debe usar el `messageId` como clave de idempotencia ante el proveedor. Queda documentado en el puerto. |
| Los estados programados del simulador se pierden si el API se reinicia | Aceptado en el simulador: el mensaje queda en `SENT`. El proveedor real reporta por `/status`, que es persistente. |
| El teclado de iOS tapa el composer | `viewport` con `interactive-widget=resizes-content`, el layout usa `h-dvh` y el composer respeta `safe-area-inset-bottom`. Criterio verificado en 390 px. |
| Un reporte `FAILED` tardío pisa un `READ` | La tabla de transiciones ignora `FAILED` desde `DELIVERED` o `READ`. |
| `SIMULATED_PROVIDER_FAILURE_RATE` activo por error | Default `0`. Solo existe con `MESSAGING_PROVIDER=simulated`, y la validación de entorno no admite otro proveedor todavía. |

## Lo que **no** entra en este spec

- n8n/WhatsApp real y HMAC.
- Multimedia, plantillas y respuestas rápidas.
- Edición o borrado de mensajes, "escribiendo…" y notas internas.
- Notificaciones push.

Cada uno llega en su propio spec.
