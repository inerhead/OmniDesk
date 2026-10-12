# SPEC 02 — Bandeja de conversaciones: ingesta y visualización

> **Status:** Approved
> **Depends on:** SPEC 01
> **Date:** 2026-10-12
> **Objective:** Los mensajes de clientes y las respuestas de IA que entran por el endpoint de integración, alimentado por un simulador, se guardan aislados por tenant y se ven en la PWA como lista de conversaciones e historial de chat responsive, refrescados por polling cada 5 s.

## Por qué existe este spec

El SPEC 01 dejó la base técnica, pero no hay nada del producto que se pueda ver. Este spec entrega la primera funcionalidad visible del MVP: **ver las conversaciones**.

Para lograrlo se **reordena el roadmap** de `docs/arquitectura.md` §14:

- La ingesta y la supervisión (incrementos 2 y 3 originales) se adelantan a identidad y tenancy (incremento 1 original).
- La supervisión se parte en dos:
  - Este spec cubre los datos y la UI de solo lectura, con polling.
  - El SPEC 03 cubre el tiempo real (Outbox + Socket.IO) y elimina el polling.

Todavía no hay login. Para no tener que rehacer el aislamiento después:

- Todas las tablas nacen con `tenantId`.
- El tenant se resuelve desde el servidor. Para las integraciones sale de la credencial del canal. Para la web sale de un tenant demo, disponible solo con `DEMO_MODE=true`.
- El spec de identidad solo cambiará cómo se resuelve el tenant de la web (sesión en lugar de demo). El resto queda igual.

## Alcance

**Dentro:**

- **Contratos** en `@omnidesk/contracts`:
  - Ingesta: `inbound` y `outbound` de IA.
  - Lectura: lista de conversaciones e historial de mensajes.
- **Modelo de datos** (Prisma + migración):
  - `Tenant`, `Channel`, `IntegrationCredential`, `Contact`, `ContactIdentity`, `Conversation` y `Message`, todos con `tenantId`.
- **Ingesta**:
  - `POST /api/v1/integrations/messages/inbound`, autenticado con la credencial del canal.
    - Crea el contacto y la conversación si no existen.
    - Deduplica por `externalMessageId`.
    - Devuelve `aiAllowed` y `controlVersion`.
  - `POST /api/v1/integrations/messages/outbound`, que registra la respuesta de IA como `PENDING`.
    - Valida `controlVersion` (protocolo §9 de la arquitectura).
    - Es idempotente por `idempotencyKey`.
- **Lectura** (solo con `DEMO_MODE=true`):
  - `GET /api/v1/conversations`, paginado por cursor y ordenado por último mensaje.
  - `GET /api/v1/conversations/:id/messages`, paginado por cursor hacia mensajes anteriores.
- **Modo demo**:
  - Variables `DEMO_MODE` y `DEMO_CHANNEL_API_KEY`.
  - Seed idempotente al arrancar el API: tenant demo, canal WhatsApp demo y credencial.
  - Guard que resuelve el tenant demo para la lectura.
  - Rechazo de `DEMO_MODE=true` con `NODE_ENV=production`.
- **Simulador** `tools/simulator` (`@omnidesk/simulator`):
  - `pnpm simulate` crea 5 conversaciones de ejemplo.
  - `pnpm simulate --live` envía mensajes de forma continua.
  - Usa los endpoints reales, como lo hará n8n.
- **Web**:
  - Rutas `/conversations`, `/conversations/:conversationId` y `/status`. El health pasa a `/status`.
  - Navegación en el header.
  - Lista de conversaciones y vista de chat. En escritorio son dos paneles; en móvil, dos pantallas.
  - Burbujas `CUSTOMER` / `AI`.
  - Estados vacío, cargando y error.
  - Polling cada 5 s.
- **Documentación**: roadmap y tabla de módulos en `docs/arquitectura.md`; sección "Datos de ejemplo" en el README.

**Fuera de alcance (para specs futuros):**

- Tiempo real con Outbox + Socket.IO, y eliminar el polling (SPEC 03).
- Login, sesiones, invitaciones, roles y membresías (spec de identidad).
- `POST /integrations/messages/status`, estados de entrega e `EventInbox` (spec de atención humana).
- Asignar, liberar, cerrar y reabrir conversaciones, bandejas por estado y `ConversationEvent` (spec de asignación).
- Enviar mensajes desde la PWA y el puerto `MessagingProvider` (spec de atención humana).
- Firma HMAC en las integraciones, n8n real y WhatsApp real.
- Búsqueda, filtros, multimedia y adjuntos.

## Modelo de datos

**Prisma** (`apps/api/prisma/schema.prisma`).

Convenciones:
- Tablas en snake_case vía `@@map`.
- IDs UUID v7 (`@default(uuid(7)) @db.Uuid`), ordenables por tiempo.
- Fechas en `timestamptz` (`@db.Timestamptz(3)`).

```prisma
enum ChannelType { WHATSAPP }
enum ChannelProvider { N8N CUSTOM }
enum ConversationStatus { OPEN CLOSED }
enum SenderType { CUSTOMER AI AGENT }
enum MessageDirection { INBOUND OUTBOUND }
enum MessageStatus { RECEIVED PENDING SENT DELIVERED READ FAILED }

model Tenant {
  id        String   // uuid v7
  slug      String   @unique          // "demo"
  name      String
  createdAt DateTime
}

model Channel {
  id         String
  tenantId   String
  name       String                   // "WhatsApp Demo"
  type       ChannelType
  provider   ChannelProvider          // N8N
  externalId String                   // id del número en el proveedor
  createdAt  DateTime
  @@unique([tenantId, externalId])
}

model IntegrationCredential {
  id        String
  tenantId  String
  channelId String
  keyHash   String   @unique          // sha256 hex de la API key
  createdAt DateTime
  revokedAt DateTime?
}

model Contact {
  id          String
  tenantId    String
  displayName String?
  createdAt   DateTime
}

model ContactIdentity {
  id         String
  tenantId   String
  contactId  String
  channelId  String
  externalId String                   // teléfono E.164, p. ej. "+573001234567"
  @@unique([channelId, externalId])
}

model Conversation {
  id                 String
  tenantId           String
  channelId          String
  contactId          String
  status             ConversationStatus @default(OPEN)
  assignedAgentId    String?                          // siempre null en este spec
  controlVersion     Int                @default(0)
  lastSequence       Int                @default(0)
  lastMessageAt      DateTime
  lastMessagePreview String                           // primeros 120 caracteres
  createdAt          DateTime
  @@index([tenantId, lastMessageAt(sort: Desc), id])
  // + índice único parcial en SQL: (channel_id, contact_id) WHERE status = 'OPEN'
}

model Message {
  id                String
  tenantId          String
  channelId         String
  conversationId    String
  sequence          Int                               // 1, 2, 3… por conversación
  direction         MessageDirection
  senderType        SenderType
  text              String
  status            MessageStatus
  externalId        String?                           // id del proveedor (inbound)
  idempotencyKey    String?                           // outbound de IA
  providerTimestamp DateTime?
  createdAt         DateTime
  @@unique([conversationId, sequence])
  @@unique([channelId, externalId])
  @@unique([conversationId, idempotencyKey])
}
```

**Contratos** (`packages/contracts/src/integrations.ts` y `conversations.ts`):

```ts
// Ingesta
InboundMessageRequestSchema = {
  externalMessageId: string(1..200),
  from: { externalId: E.164, displayName?: string(1..120) },
  text: string(1..4096),
  sentAt: ISO 8601,
}
InboundMessageResponseSchema = { conversationId, messageId, aiAllowed: boolean, controlVersion: int, duplicate: boolean }

OutboundAiMessageRequestSchema = { conversationId, controlVersion: int, idempotencyKey: string(1..200), text: string(1..4096) }
OutboundAiMessageResponseSchema = { messageId, sendAllowed: true }
OutboundAiMessageRejectedSchema = { sendAllowed: false, reason: 'CONTROL_CHANGED' | 'CONVERSATION_CLOSED' }

// Lectura
ConversationSummarySchema = {
  id, status, aiActive: boolean,
  contact: { id, displayName: string | null, externalId },
  channel: { id, name, type },
  lastMessageAt, lastMessagePreview,
}
ListConversationsResponseSchema = { items: ConversationSummary[], nextCursor: string | null }

MessageSchema = { id, sequence, direction, senderType, text, status, createdAt }
ListMessagesResponseSchema = { items: Message[] /* orden ascendente por sequence */, prevCursor: string | null }
```

**Reglas de dominio** (`conversations/domain`):

- **IA activa:** `aiActive = status === 'OPEN' && assignedAgentId === null`. En este spec siempre es `true`.
- **Orden de mensajes:** cada mensaje nuevo recibe `sequence = lastSequence + 1`. En la misma transacción se actualizan `lastSequence`, `lastMessageAt` y `lastMessagePreview` (texto recortado a 120 caracteres con `…`).
- **Inbound:**
  - Reutiliza la conversación `OPEN` de ese contacto en ese canal, o crea una nueva.
  - Un `externalMessageId` ya registrado en el canal devuelve el mensaje existente con `duplicate: true` y no crea nada.
- **Outbound de IA:**
  - Bloquea la fila de la conversación (`SELECT … FOR UPDATE`).
  - Si `status !== 'OPEN'`, rechaza con `409 CONVERSATION_CLOSED`.
  - Si `assignedAgentId !== null` o el `controlVersion` no coincide, rechaza con `409 CONTROL_CHANGED`.
  - Si todo está bien, crea el mensaje con `status = 'PENDING'`.
  - Si ya existe un mensaje con el mismo `idempotencyKey` en esa conversación, devuelve ese mismo mensaje.
- **Estado de los inbound:** los mensajes del cliente se guardan con `status = 'RECEIVED'`.

**Paginación:**

- Conversaciones:
  - Cursor opaco: base64url de `"<lastMessageAt ISO>|<id>"`.
  - Orden `lastMessageAt DESC, id DESC`.
  - `limit` por defecto 30, máximo 100.
- Mensajes:
  - `before=<sequence>` devuelve los mensajes con `sequence` menor.
  - Sin `before`, devuelve la página más reciente.
  - `limit` por defecto 50, máximo 100.
  - `prevCursor` es la `sequence` más antigua de la página, o `null` si no hay más.

**Variables de entorno nuevas:**

| Variable | App | Validación | Default |
| --- | --- | --- | --- |
| `DEMO_MODE` | api | `true` \| `false`. Con `NODE_ENV=production` solo se acepta `false`. | `false` (`.env.example`: `true`) |
| `DEMO_CHANNEL_API_KEY` | api, simulator | Obligatoria con `DEMO_MODE=true`, mínimo 24 caracteres | — (`.env.example`: `dev-demo-channel-key-change-me`) |
| `SIMULATOR_API_URL` | simulator | URL | `http://localhost:${GATEWAY_HOST_PORT:-8080}` |

**Datos del seed demo** (idempotente, por upsert):

- Tenant `slug: "demo"`, `name: "Empresa Demo"`.
- Canal `name: "WhatsApp Demo"`, `type: WHATSAPP`, `provider: N8N`, `externalId: "demo-whatsapp"`.
- Credencial con `keyHash = sha256(DEMO_CHANNEL_API_KEY)`.

## Plan de implementación

1. **Contratos.**
   - `packages/contracts/src/integrations.ts` y `conversations.ts`, exportados desde `index.ts`.
   - Pruebas Vitest:
     - Payloads válidos.
     - `text` vacío o de más de 4096 caracteres.
     - Teléfono que no es E.164.
     - `limit` fuera de rango.
2. **Modelo y migración.**
   - Modelos y enums en `schema.prisma`.
   - Migración `…_conversations`, con el índice único parcial añadido a mano en SQL.
   - Verificación: `db:deploy` en limpio y `\d conversations` muestra el índice parcial.
3. **Transacciones y entorno.**
   - `shared/application/transaction-runner.port.ts`: interfaz `TransactionRunner` con `run(fn)`.
   - `shared/infrastructure/prisma/prisma-transaction-runner.ts`: usa `AsyncLocalStorage`. Los repositorios toman el cliente de la transacción activa o, si no hay, el `PrismaService`.
   - `env.ts`:
     - Añade `DEMO_MODE` y `DEMO_CHANNEL_API_KEY`.
     - Regla: `DEMO_MODE=true` exige la key y está prohibido en `production`.
   - Pruebas del parser de entorno.
4. **Módulos `tenancy` y `channels`.**
   - Entidades de dominio, puertos de repositorio y repositorios Prisma.
   - `channels/infrastructure/http/channel-credential.guard.ts`:
     - Lee `Authorization: Bearer <key>` y busca el `sha256` en las credenciales no revocadas.
     - Deja `IntegrationContext { tenantId, channelId }` en la request.
     - Responde `401` si falta la key o no es válida.
5. **Módulo `demo`.**
   - `DemoSeedService` (`onApplicationBootstrap`): si `DEMO_MODE=true`, hace upsert de tenant, canal y credencial.
   - `DemoTenantGuard`:
     - Con `DEMO_MODE=false` responde `401`.
     - Con `DEMO_MODE=true` resuelve el tenant `demo` y deja `TenantContext { tenantId }` en la request.
   - Prueba e2e: con `DEMO_MODE=false`, `GET /api/v1/conversations` responde `401`.
6. **Dominio de `contacts` y `conversations`.**
   - Agregado `Conversation` con `appendMessage` (sequence, preview, `lastMessageAt`), `canAcceptAiReply(controlVersion)` y `aiActive`.
   - Pruebas unitarias de las reglas de dominio.
7. **Inbound.**
   - Caso de uso `RegisterInboundMessage` (en `TransactionRunner`): resolver contacto e identidad, encontrar o crear la conversación `OPEN`, añadir el mensaje y deduplicar.
   - Si el índice parcial choca (`P2002`), reintenta una vez.
   - `integrations/infrastructure/http/inbound-messages.controller.ts`: responde `201` cuando es nuevo y `200` cuando es duplicado.
   - Pruebas unitarias con repositorios en memoria y e2e.
8. **Outbound de IA.**
   - Caso de uso `RegisterAiReply`, con bloqueo de fila, validación de `controlVersion` e idempotencia.
   - Controlador `outbound-messages.controller.ts`: `201` / `409` / `404` (conversación inexistente o de otro canal).
   - Pruebas unitarias y e2e.
9. **Lectura.**
   - Casos de uso `ListConversations` y `ListMessages`, filtrados siempre por `TenantContext.tenantId`.
   - `conversations/infrastructure/http/conversations.controller.ts` protegido con `DemoTenantGuard`.
   - Una conversación de otro tenant responde `404`.
   - Swagger documenta los 4 endpoints. Los de integración usan el esquema `bearer`.
   - e2e: paginación de ambas listas y aislamiento con un segundo tenant creado en la prueba.
10. **Simulador.**
    - Añadir `tools/*` a `pnpm-workspace.yaml` y crear `tools/simulator` con `src/index.ts`, `src/client.ts` y `src/scenarios.ts`.
    - Ejecución con Node 24 sin build: `node --env-file-if-exists=../../.env src/index.ts`.
    - Script raíz `simulate`.
    - El escenario fijo tiene 5 contactos y de 2 a 4 turnos cliente → IA cada uno.
      - Los `externalMessageId` e `idempotencyKey` son deterministas (`sim-<contacto>-<n>`), así que volver a ejecutarlo no duplica nada.
    - `--live`:
      - Cada 4 s, un contacto al azar envía un mensaje y la IA responde 1,5 s después.
      - Los ids son únicos y se detiene con Ctrl+C.
    - Prueba Vitest: los ids del escenario fijo son deterministas y únicos.
    - `.env.example` gana `DEMO_MODE=true` y `DEMO_CHANNEL_API_KEY`.
    - `turbo.json` añade `DEMO_MODE`, `DEMO_CHANNEL_API_KEY` y `SIMULATOR_API_URL` a `globalPassThroughEnv`.
11. **Web: rutas y navegación.**
    - `/` redirige a `/conversations`.
    - La página de health pasa a `pages/status-page.tsx` en `/status`.
    - El header tiene los enlaces "Conversaciones" y "Estado".
    - `pages/not-found-page.tsx` atiende rutas desconocidas.
12. **Web: lista de conversaciones.**
    - `features/conversations/api/list-conversations.ts` (`useInfiniteQuery`, `refetchInterval` de 5 s, solo con la pestaña visible).
    - `model/format-time.ts`: hora si es de hoy, "Ayer", o fecha `dd/MM`, en español.
    - `ui/conversation-list.tsx`: nombre o teléfono, vista previa de una línea, hora, canal y botón "Cargar más".
    - Estados:
      - Vacío: "Aún no hay conversaciones. Ejecuta `pnpm simulate`."
      - Cargando: skeleton.
      - Error: "No se pudieron cargar las conversaciones" con botón "Reintentar".
    - Pruebas de `formatTime`.
13. **Web: vista de chat.**
    - `features/conversations/api/list-messages.ts`: `useInfiniteQuery` hacia mensajes anteriores; polling de 5 s de la página más reciente.
    - `model/to-bubble-view.ts`: función pura que lleva `senderType` a lado y etiqueta. `CUSTOMER` va a la izquierda; `AI` a la derecha con la etiqueta "IA".
    - `ui/chat-view.tsx`:
      - Header con contacto, teléfono, canal y badge "IA activa".
      - Burbujas con hora, e ícono de reloj si el estado es `PENDING`.
      - Botón "Cargar anteriores".
      - Al abrir la conversación, desplazamiento hasta el final.
    - `pages/conversations-page.tsx`:
      - En escritorio (≥ `md`), dos paneles. El panel derecho muestra "Selecciona una conversación" cuando no hay ninguna.
      - En móvil, la lista y el chat son pantallas separadas, con botón "Volver".
    - Conversación inexistente: "Conversación no encontrada".
    - Pruebas de `toBubbleView`.
14. **Documentación.**
    - `docs/arquitectura.md`:
      - §14 con el roadmap reordenado.
      - §6.1: `Message` vive en `conversations` y se añade el módulo `demo`.
    - README: sección "Datos de ejemplo" (`pnpm simulate`, `--live`, `DEMO_MODE`).

## Criterios de aceptación

**Ingesta**

- [ ] `curl -X POST /api/v1/integrations/messages/inbound` sin `Authorization`, o con una key inválida, responde `401`.
- [ ] Un inbound válido con la key demo responde `201` con `aiAllowed: true`, `controlVersion: 0` y `duplicate: false`.
- [ ] Repetir el mismo `externalMessageId` responde `200` con el mismo `messageId` y `duplicate: true`. La tabla `messages` no gana filas.
- [ ] Dos inbound del mismo teléfono quedan en la misma conversación, con `sequence` 1 y 2.
- [ ] Un outbound con el `controlVersion` correcto responde `201` con `sendAllowed: true`, y el mensaje queda `PENDING` y `senderType: AI`.
- [ ] Repetir el outbound con el mismo `idempotencyKey` devuelve el mismo `messageId` sin crear filas.
- [ ] Un outbound con `controlVersion: 99` responde `409` con `reason: "CONTROL_CHANGED"`.
- [ ] Un outbound a una conversación de otro canal responde `404`.
- [ ] `text` vacío o de más de 4096 caracteres responde `400`.
- [ ] Los logs del API no contienen el `text` de ningún mensaje.

**Lectura y modo demo**

- [ ] Con `DEMO_MODE=false`, `GET /api/v1/conversations` responde `401`.
- [ ] Con `DEMO_MODE=true` y `NODE_ENV=production`, el API no arranca y el mensaje nombra `DEMO_MODE`.
- [ ] Al arrancar con `DEMO_MODE=true` existen el tenant `demo`, el canal y la credencial. Reiniciar el API no los duplica.
- [ ] `GET /api/v1/conversations` devuelve las conversaciones ordenadas por último mensaje, de la más reciente a la más antigua.
- [ ] Con más de 30 conversaciones, `nextCursor` permite recorrerlas todas sin repetir ninguna.
- [ ] `GET /api/v1/conversations/:id/messages` devuelve los mensajes en orden ascendente por `sequence`, y `before` trae los anteriores.
- [ ] Una conversación de otro tenant responde `404` en `GET /conversations/:id/messages` y no aparece en la lista.
- [ ] Swagger muestra los 4 endpoints nuevos con sus esquemas.

**Simulador**

- [ ] `pnpm simulate` termina con código 0 y crea 5 conversaciones con mensajes de cliente y de IA.
- [ ] Ejecutar `pnpm simulate` dos veces no duplica mensajes ni conversaciones.
- [ ] `pnpm simulate --live` crea un mensaje nuevo al menos cada 5 s hasta Ctrl+C.

**Web** (`http://localhost:8080`)

- [ ] `/` redirige a `/conversations`, y `/status` muestra el estado del sistema del SPEC 01.
- [ ] Sin datos, la lista muestra "Aún no hay conversaciones. Ejecuta `pnpm simulate`."
- [ ] Tras `pnpm simulate`, la lista muestra 5 conversaciones con nombre, vista previa y hora, sin recargar la página en ≤ 5 s.
- [ ] Al abrir una conversación se ven las burbujas del cliente a la izquierda y las de IA a la derecha con la etiqueta "IA", en orden cronológico.
- [ ] Con `pnpm simulate --live` corriendo, los mensajes nuevos aparecen en la lista y en el chat abierto en ≤ 5 s sin recargar.
- [ ] En un viewport de 390 px de ancho, la lista ocupa la pantalla; al tocar una conversación se abre el chat con botón "Volver", sin scroll horizontal.
- [ ] En un viewport de 1280 px se ven ambos paneles a la vez.
- [ ] `/conversations/<uuid inexistente>` muestra "Conversación no encontrada".
- [ ] Con el API detenido, la lista muestra "No se pudieron cargar las conversaciones" con el botón "Reintentar".
- [ ] La app instalada como PWA (build `web-preview`) muestra las conversaciones. El service worker no cachea `/api/*`.

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0.
- [ ] El e2e del API pasa con todos los casos de ingesta, lectura, aislamiento y modo demo.
- [ ] Ningún archivo bajo `domain/` o `application/` de los módulos nuevos rompe las reglas de capas (`pnpm lint`).

## Decisiones

- **Sí:** reordenar el roadmap. La bandeja va antes que identidad para tener funcionalidad visible pronto, y el tiempo real se separa en el SPEC 03.
- **No:** identidad primero. Funciona, pero no muestra el producto.
- **No:** un solo spec con tiempo real. Tocaría 5 áreas, y la revisión y el riesgo serían demasiado grandes.
- **Sí:** `tenantId` en todas las tablas desde ya, con un tenant demo resuelto en el servidor. El spec de identidad solo reemplaza el guard.
- **No:** tablas sin tenancy. Añadirlo después exige migrar datos y revisar cada consulta.
- **Sí:** la lectura solo funciona con `DEMO_MODE=true`, que además está prohibido en producción. Las conversaciones son datos personales y no hay login.
- **No:** endpoints abiertos. Riesgo de exponer datos si alguien despliega esto.
- **No:** un token estático en la web. Es configuración que se descarta al llegar el login.
- **Sí:** seed idempotente al arrancar, implementado como `DemoSeedService` dentro del API.
- **No:** `prisma db seed`. Requiere un ejecutor de TypeScript extra en el contenedor y duplica el acceso a datos fuera de los repositorios.
- **Sí:** credencial de canal como Bearer API key guardada con `sha256`. Basta para servicio a servicio en local.
- **No:** HMAC en este spec. Se añade con n8n real.
- **Sí:** el endpoint real de ingesta más un simulador. Prueba el contrato que usará n8n sin depender de n8n.
- **No:** seed directo en la base. No prueba la ingesta.
- **No:** n8n en Compose por ahora. Más configuración, y el simulador cubre el contrato.
- **Sí:** el simulador vive en `tools/simulator`, como paquete de workspace separado. Es un cliente externo y no se despliega.
- **Sí:** el simulador corre con Node 24 sin build (type stripping nativo). Evita añadir tsx o un paso de compilación.
- **Sí:** se incluyen `inbound` y `outbound` de IA con `controlVersion` en el contrato. El contrato queda estable para el spec de asignación, aunque hoy `sendAllowed` siempre es `true`.
- **No:** `/status` (estados de entrega) ni `EventInbox` todavía. Llegan con atención humana, donde se reciben eventos de estado.
- **Sí:** el inbound se deduplica con `@@unique([channelId, externalId])` en `messages`, y el outbound con `@@unique([conversationId, idempotencyKey])`. Las restricciones de la base de datos garantizan la idempotencia sin tablas extra.
- **Sí:** polling temporal de 5 s, solo con la pestaña visible. Lo eligió el equipo; el SPEC 03 lo elimina.
- **Sí:** `Message` vive en el módulo `conversations`. La `sequence` necesita bloquear la conversación en la misma transacción. Se actualiza la tabla de módulos de la arquitectura.
- **Sí:** las transacciones usan un puerto `TransactionRunner` con `AsyncLocalStorage`. Los casos de uso orquestan la transacción sin conocer Prisma.
- **Sí:** un índice único parcial `(channel_id, contact_id) WHERE status = 'OPEN'` en SQL, con un reintento ante `P2002`. Evita dos conversaciones abiertas por una carrera entre inbound simultáneos.
- **Sí:** UUID v7 como ids. Ordenables por tiempo y generados por Prisma.
- **Sí:** `RECEIVED` como estado de los mensajes entrantes. Los estados de entrega (`PENDING`…`FAILED`) aplican solo a los salientes.
- **Sí:** `/` redirige a `/conversations`, y el health pasa a `/status`. La pantalla principal del producto es la bandeja.
- **Sí:** solo lista y chat, en modo lectura. Las bandejas por estado no aportan nada sin asignación ni cierre.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Dos inbound simultáneos del mismo contacto crean dos conversaciones `OPEN` | Índice único parcial más un reintento ante `P2002`. Prueba e2e con dos peticiones en paralelo. |
| Dos mensajes simultáneos obtienen la misma `sequence` | `lastSequence` se incrementa con `UPDATE … RETURNING` dentro de la transacción. El `@@unique([conversationId, sequence])` lo garantiza en la base. |
| `DEMO_MODE=true` llega a un entorno real | La validación de entorno lo rechaza con `NODE_ENV=production`. El default es `false`; solo `.env.example` lo activa. |
| Datos personales en los logs | `pino-http` no serializa cuerpos por defecto. Hay un criterio que verifica que el `text` no aparece en los logs. |
| El type stripping de Node no soporta alguna sintaxis en el simulador | El simulador solo usa TypeScript borrable (sin enums ni decoradores), e importa `@omnidesk/contracts` ya compilado. |
| El polling de 5 s carga el API con muchas pestañas abiertas | Solo corre con la pestaña visible. Es temporal hasta el SPEC 03. |
| Prisma no expresa índices parciales en el schema, y un `migrate dev` posterior propone borrar los índices que no conoce | En el paso 2 se comprueba si Prisma 7.10 soporta índices parciales en el schema (preview feature). Si no, el índice se escribe a mano en el SQL y cada migración nueva se revisa para quitar cualquier `DROP INDEX` de ese índice. Lo documenta un comentario en `schema.prisma`. |

## Lo que **no** entra en este spec

- Tiempo real (Socket.IO y Outbox).
- Login, roles e invitaciones.
- Estados de entrega y `/status`.
- Asignar, liberar, cerrar y reabrir conversaciones.
- Enviar mensajes desde la PWA.
- n8n y WhatsApp reales, y firma HMAC.
- Búsqueda, filtros y multimedia.

Cada uno llega en su propio spec, según el roadmap actualizado en `docs/arquitectura.md` §14.
