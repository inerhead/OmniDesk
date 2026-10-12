# SPEC 03 — Tiempo real: Outbox + Socket.IO

> **Status:** Approved
> **Depends on:** SPEC 02
> **Date:** 2026-10-12
> **Objective:** Cada cambio en una conversación se publica, mediante un Outbox transaccional y Socket.IO, para que la bandeja y el chat se actualicen en menos de 1 s sin polling, con un indicador de conexión y un respaldo cuando el socket cae.

## Por qué existe este spec

El SPEC 02 refresca la bandeja con un polling de 5 s. Ese polling es temporal: genera tráfico constante y retrasos visibles.

Este spec lo reemplaza por eventos. El patrón es el Outbox transaccional de `docs/arquitectura.md` §3:

- El evento se guarda en la **misma transacción** que el cambio. Por eso nunca se emite un evento de algo que no se guardó, ni se pierde el evento de algo que sí se guardó.
- Un dispatcher lo publica después.

La misma infraestructura la reutilizan los SPEC 04 (asignación) y SPEC 05 (envío por el proveedor con reintentos).

## Alcance

**Dentro:**

- **Modelo `OutboxEvent`** con los campos de reintento (`attempts`, `nextAttemptAt`, `lastError`) que usará el SPEC 05.
- **Puerto `OutboxPort`** (`shared/application`) y su adaptador Prisma.
  - `RegisterInboundMessage` y `RegisterAiReply` encolan `conversation.changed` en su transacción.
- **Dispatcher** (`realtime/infrastructure/outbox-dispatcher.ts`):
  - Cada 500 ms toma los eventos pendientes con `FOR UPDATE SKIP LOCKED`, los emite por Socket.IO y los marca como publicados.
  - Cada hora borra los eventos publicados hace más de 24 h.
- **Gateway Socket.IO**:
  - Ruta `/api/realtime`, con CORS igual a `CORS_ORIGINS`.
  - En el handshake se resuelve el tenant demo (solo con `DEMO_MODE=true`) y el socket entra al room `tenant:<tenantId>`.
  - Con `DEMO_MODE=false`, la conexión se rechaza.
- **Contrato** `RealtimeEventSchema` en `@omnidesk/contracts`.
- **Web**:
  - `RealtimeProvider`: conecta el socket e invalida las queries de TanStack Query afectadas por cada evento.
  - Badge "En vivo" / "Reconectando…" en el header.
  - Se elimina el polling de 5 s. Mientras el socket está desconectado hay un polling de respaldo cada 15 s, y al reconectar se invalida todo.
- **Caddy:** no cambia. `/api/*` ya cubre `/api/realtime`, incluido el upgrade a WebSocket.
- **Pruebas:**
  - Unitarias: dispatcher con puertos falsos.
  - e2e: un cliente `socket.io-client` recibe el evento tras un inbound; la conexión se rechaza con `DEMO_MODE=false`.

**Fuera de alcance (para specs futuros):**

- Asignación, comandos y eventos de asignación (SPEC 04).
- Envío de mensajes por el proveedor y sus reintentos (SPEC 05; aquí solo se dejan los campos del Outbox).
- Varias instancias del API (adapter Redis de Socket.IO): incremento de despliegue.
- `LISTEN/NOTIFY` de Postgres para bajar la latencia por debajo de 500 ms.
- Eventos con el contenido del mensaje (parchear la caché).
- Rooms por conversación y filtrado de eventos por permisos (llegan con identidad).

## Modelo de datos

**Prisma:**

```prisma
model OutboxEvent {
  id            String    @id @default(uuid(7)) @db.Uuid
  tenantId      String    @map("tenant_id") @db.Uuid
  /// "conversation.changed" (SPEC 03); el SPEC 05 añade "message.send_requested".
  type          String
  payload       Json
  attempts      Int       @default(0)
  nextAttemptAt DateTime  @default(now()) @map("next_attempt_at") @db.Timestamptz(3)
  lastError     String?   @map("last_error")
  publishedAt   DateTime? @map("published_at") @db.Timestamptz(3)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  @@index([nextAttemptAt], map: "outbox_events_pending", where: raw("published_at IS NULL"))
  @@index([publishedAt])
  @@map("outbox_events")
}
```

**Contrato** (`packages/contracts/src/realtime.ts`):

```ts
export const REALTIME_PATH = '/api/realtime';

// Evento ligero: dice qué cambió, no trae el contenido. La web vuelve a pedir por REST.
export const RealtimeEventSchema = z.object({
  type: z.literal('conversation.changed'),
  conversationId: z.uuid(),
  /** 'message' (SPEC 03); el SPEC 04 añade 'assignment' y el SPEC 05 'delivery'. */
  reason: z.enum(['message']),
  occurredAt: z.iso.datetime(),
});
```

- Nombre del evento Socket.IO: `conversation.changed`.
- Room: `tenant:<tenantId>`.

**Puerto:**

```ts
// shared/application/outbox.port.ts
export interface OutboxPort {
  /** Encola un evento en la transacción activa. Debe llamarse dentro de TransactionRunner.run. */
  enqueue(event: { tenantId: string; type: 'conversation.changed'; payload: object }): Promise<void>;
}
```

**Variables de entorno:** no hay nuevas. El intervalo de 500 ms y la retención de 24 h son constantes en el dispatcher.

## Plan de implementación

1. **Dependencias.**
   - `@nestjs/websockets` y `@nestjs/platform-socket.io` (línea 11, igual que Nest) en el API.
   - `socket.io-client` en la web y como dependencia de desarrollo del API para los e2e.
   - Las versiones tienen al menos 24 h de publicadas (`minimumReleaseAge`).
2. **Contrato y modelo.**
   - `realtime.ts` en contracts, con pruebas.
   - `OutboxEvent` en `schema.prisma` y migración `…_outbox`, con un índice parcial de pendientes.
3. **Puerto `OutboxPort` y adaptador `PrismaOutbox`.**
   - El adaptador usa `PrismaDb`, así que escribe en la transacción activa.
   - `RegisterInboundMessage` y `RegisterAiReply` encolan `conversation.changed` (`reason: 'message'`). Los duplicados y los rechazos no encolan nada.
   - Las pruebas unitarias de los casos de uso verifican que se encola un evento por mensaje nuevo.
4. **Gateway.**
   - Módulo `realtime` con `RealtimeGateway` (`path: REALTIME_PATH`).
   - `handleConnection`:
     - Con `DEMO_MODE=false`, emite `error` con "Autenticación requerida" y desconecta.
     - Con `DEMO_MODE=true`, resuelve el tenant demo y une el socket a `tenant:<id>`.
   - Puerto `RealtimePublisher.publish(tenantId, event)`, implementado sobre el server de Socket.IO.
5. **Dispatcher.**
   - `OutboxDispatcher` arranca en `onApplicationBootstrap` y se detiene en `onModuleDestroy`.
   - En cada tick, dentro de una transacción:
     - `SELECT … WHERE published_at IS NULL AND next_attempt_at <= now() ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`.
     - Publica cada evento y marca `published_at`.
     - Si falla, incrementa `attempts`, guarda `lastError` y fija `next_attempt_at = now() + 2^attempts s`.
   - Limpieza horaria de los publicados con más de 24 h.
   - Pruebas unitarias con un publisher falso: publica y marca; ante un fallo programa el reintento.
6. **e2e del API.**
   - Un cliente `socket.io-client` conectado a `/api/realtime` recibe `conversation.changed` con el `conversationId` correcto en menos de 2 s tras un `inbound`.
   - Con `DEMO_MODE=false`, la conexión se rechaza.
   - Tras publicarse, `outbox_events.published_at` no es nulo.
7. **Web: cliente y provider.**
   - `shared/realtime/realtime-client.ts`:
     - `io(VITE_API_URL || origen, { path: REALTIME_PATH, withCredentials: true })`.
     - Valida cada evento con `RealtimeEventSchema`.
   - `shared/realtime/connection-status.ts`: store (`useSyncExternalStore`) con los estados `connecting`, `live` y `reconnecting`.
   - `app/realtime-provider.tsx`:
     - Ante `conversation.changed`, invalida `['conversations']` y `['messages', conversationId]`.
     - Al reconectar, invalida todo.
8. **Web: polling y badge.**
   - En `use-conversations.ts`, `refetchInterval` es 15 s si el estado no es `live`, y `false` si lo es. Se elimina el polling de 5 s.
   - `shared/realtime/connection-badge.tsx` en el header:
     - Punto verde con "En vivo".
     - Punto ámbar con "Reconectando…".
     - Gris con "Conectando…".
9. **Documentación.**
   - README: cómo verlo funcionar con `pnpm simulate --live`.
   - `docs/arquitectura.md` §14: SPEC 03 implementado; latencia objetivo ≤ 1 s.

## Criterios de aceptación

**Backend**

- [ ] Un `inbound` nuevo crea exactamente una fila en `outbox_events` con `type = 'conversation.changed'`. Un `inbound` duplicado no crea ninguna.
- [ ] Un outbound de IA aceptado crea una fila. Un outbound rechazado con `409` no crea ninguna.
- [ ] Tras ≤ 1 s, esas filas tienen `published_at` distinto de nulo.
- [ ] e2e: un `socket.io-client` conectado a `/api/realtime` recibe `conversation.changed` con el `conversationId` del inbound en menos de 2 s.
- [ ] Con `DEMO_MODE=false`, la conexión de Socket.IO se rechaza.
- [ ] Si se fuerza un error al publicar (prueba unitaria), el evento queda con `attempts = 1`, `lastError` y `next_attempt_at` en el futuro, y se publica en un tick posterior.
- [ ] Los eventos publicados con más de 24 h se borran (prueba unitaria de la limpieza).

**Web** (`http://localhost:8080`)

- [ ] Con la app abierta y `pnpm simulate --live` corriendo, cada mensaje nuevo aparece en la lista y en el chat abierto en ≤ 1 s, sin recargar.
- [ ] Con el socket conectado y sin actividad, DevTools → Network no muestra peticiones a `/api/v1/conversations` durante 30 s.
- [ ] El header muestra "En vivo" con el socket conectado.
- [ ] Con `docker compose stop api`, el header pasa a "Reconectando…" en ≤ 5 s, y la lista hace como máximo una petición cada 15 s.
- [ ] Al volver a levantar el API, el header vuelve a "En vivo" y aparecen los mensajes que llegaron mientras tanto, sin recargar.
- [ ] Funciona igual entrando por el gateway (`8080`) y en la PWA instalada (`web-preview`).

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0, y el e2e del API pasa.

## Decisiones

- **Sí:** Outbox transaccional con un dispatcher que lee cada 500 ms. Es fiable (nunca un evento sin su cambio), simple y con latencia ≤ 1 s.
- **No:** `LISTEN/NOTIFY`. Baja la latencia, pero exige una conexión dedicada y lógica de reconexión. Se puede añadir sin cambiar el contrato.
- **No:** emitir directo desde el caso de uso. Si el commit falla, el evento ya salió. Si el proceso cae tras el commit, el evento se pierde.
- **Sí:** `FOR UPDATE SKIP LOCKED`. Deja preparado el escenario de varias instancias sin publicar dos veces un mismo evento.
- **Sí:** eventos ligeros (`conversationId` + `reason`) e invalidación en la web. Hay una sola fuente de verdad (REST, con permisos) y no hay lógica de orden ni de duplicados en la caché. Lo decidió el equipo.
- **No:** parchear la caché con el contenido del evento. Hay más lógica, y el contenido saldría por un canal sin los filtros de permisos que llegarán con identidad.
- **Sí:** un único room por tenant. El evento no lleva contenido, así que no expone datos. El refetch aplica los permisos.
- **No:** rooms por conversación por ahora. Llegan si hace falta reducir tráfico o filtrar por permisos.
- **Sí:** Socket.IO en `/api/realtime`. Caddy ya proxifica `/api/*` con upgrade a WebSocket, y la web y el API siguen separados.
- **Sí:** polling de respaldo cada 15 s solo mientras el socket está caído, más un resync al reconectar. Ningún mensaje queda sin mostrarse. Lo decidió el equipo.
- **Sí:** `attempts`, `nextAttemptAt` y `lastError` desde ya. El SPEC 05 los usa para los reintentos de envío sin otra migración.
- **Sí:** retención de 24 h de los eventos publicados. La tabla no crece sin límite; el historial real vive en `messages` y en `conversation_events`.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Con varias instancias del API, un evento solo llega a los sockets de la instancia que lo publica | Fuera de alcance: hoy hay una instancia. El adapter Redis de Socket.IO llega con el despliegue. `SKIP LOCKED` ya evita duplicados. |
| El dispatcher se atrasa con mucho volumen | Lotes de 100 por tick y un índice parcial de pendientes. Se registra un `warn` si un lote viene lleno. |
| WebSocket bloqueado por un proxy o una red corporativa | Socket.IO cae a long-polling automáticamente. El polling de 15 s es la última red de seguridad. |
| Una invalidación por evento genera muchas peticiones en ráfagas (`--live` intenso) | TanStack Query deduplica las peticiones en vuelo para una misma query. Si hace falta, se añade un debounce de 250 ms en `RealtimeProvider`. |
| Hot reload del API en dev deja sockets colgados | Socket.IO reconecta solo. El badge lo hace visible. |

## Lo que **no** entra en este spec

- Asignación y sus eventos.
- Envío de mensajes por el proveedor y reintentos de envío.
- Redis, varias instancias y `LISTEN/NOTIFY`.
- Rooms por conversación y filtrado por permisos.

Cada uno llega en su propio spec (SPEC 04, SPEC 05 o despliegue).
