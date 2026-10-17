# SPEC 24 — Historial en `ai.reply` y workflow de n8n para Gastromesa

> **Status:** Approved
> **Depends on:** SPEC 09, SPEC 22, SPEC 23
> **Date:** 2026-10-16
> **Objective:** OmniDesk envía en cada `ai.reply` los últimos 20 mensajes de la conversación, y un workflow nuevo de n8n (`OmniDesk — entrada Gastromesa`) responde con OpenAI sin memoria propia, con el prompt de cada canal y consultando el menú de Gastromesa con un tool.

## Por qué existe este spec

Sale de la petición del 2026-10-16: "enviar historial reciente de la conversación en `ai.reply`", con el workflow que el usuario modificó en n8n (`tools/n8n/OmniDesk — entrada2Modificada.json`).

Hoy el agente de n8n solo ve el mensaje actual. La memoria de n8n (Simple Memory, SPEC 23) tiene tres problemas:

1. Solo ve lo que pasa por n8n: no ve lo que escriben los agentes humanos ni lo que dijo el cliente mientras un agente tenía la conversación.
2. Copia mensajes de clientes fuera de OmniDesk, donde no llegan la retención (SPEC 12) ni el borrado de empresa (SPEC 20).
3. Vive en la RAM de n8n y se pierde al reiniciar.

OmniDesk ya tiene la conversación completa ordenada por `sequence`. Si la envía, n8n no necesita memoria.

El usuario ya cambió el workflow: OpenAI (`gpt-5-mini`) en lugar de Anthropic, sin memoria y con el prompt de Sésamo. Quiere además que el agente consulte el menú y los precios en Gastromesa (`GET https://dev.gastromesa.com/api/v1/menu/full` con `X-Client-Secret`).

El export del usuario tiene un fallo: el nodo **Guardar respuesta** no tiene tabla seleccionada. El insert falla después de llamar al modelo, n8n responde `500` y OmniDesk reintenta (SPEC 23): hasta 6 llamadas al modelo por mensaje y ninguna respuesta llega al cliente.

Crear y consultar comandas en Gastromesa se habló en la misma petición. Se separa a **SPEC 25** porque crear una comanda es una escritura con riesgos propios (duplicados por reintento, confirmación con el cliente, ids de producto).

Lo que ya fijaron otros specs y aquí no se reabre:

- Contrato de `ai.reply`: cuerpo actual, respuesta `{ text }`, timeout de 10 s, `Idempotency-Key`, cabeceras `X-Client-Id` / `X-Client-Secret` (SPEC 09 y 22).
- Qué errores se reintentan y cuáles no (SPEC 23).
- Deduplicación por `Idempotency-Key` con la tabla `omnidesk_ai_replies` y su workflow de limpieza (SPEC 23).
- Cuándo se genera un `ai.reply`: mensaje de texto nuevo, conversación abierta sin agente, IA activa (SPEC 04 y 09).

## Alcance

**Dentro:**

- **Historial en `ai.reply`** (`AiReplyWorker`):
  - Campo nuevo `history` en el cuerpo: los **20 mensajes anteriores** al mensaje actual de la misma conversación, en orden cronológico (`sequence` ascendente).
  - No incluye el mensaje actual: sigue llegando en `text`.
  - Incluye mensajes `CUSTOMER`, `AI` y `AGENT`.
  - Excluye los salientes con estado `FAILED`: el cliente nunca los vio.
  - Cada elemento lleva:
    - `role`: `customer`, `ai` o `agent`.
    - `agentName`: el `displayName` del `TenantMember` que lo escribió. Solo en `agent`.
    - `text`: el texto del mensaje (puede ser vacío en un adjunto sin pie).
    - `attachment`: el tipo de adjunto (`IMAGE`, `DOCUMENT`, `AUDIO`, `VIDEO`, `STICKER`), si lo hay. El archivo no se envía.
    - `at`: `createdAt` del mensaje en ISO 8601.
  - Conversación sin mensajes previos: `history: []`.
  - El historial se lee al llamar a n8n, no al encolar: un reintento ve los mensajes que hayan llegado entretanto.
- **Contrato** (`packages/contracts/src/channels.ts`):
  - `AiReplyHistoryMessageSchema` y `N8nAiReplyRequestSchema` describen el cuerpo completo de `ai.reply`. El worker construye el cuerpo con ese tipo.
  - `AI_REPLY_HISTORY_LIMIT = 20`.
- **Lectura del historial:** método nuevo `listAiHistory(tenantId, conversationId, beforeSequence, limit)` en el puerto `ConversationRepository`, con implementación Prisma y en la fake de `modules/conversations/testing/in-memory.ts`.
- **Workflow nuevo** `tools/n8n/OmniDesk — entrada Gastromesa.json` (nombre en n8n: `OmniDesk — entrada Gastromesa`), creado a partir de `OmniDesk — entrada2Modificada.json`:
  - Conserva: webhook `POST /omnidesk`, `Buscar cliente` (tabla `Credentials`), `¿Cliente válido?` (`401`), `Tipo` (`ping` → `200`, otro → `400`), `Buscar respuesta previa`, `¿Ya respondida?` y `Responder respuesta previa`.
  - **Arreglo:** `Guardar respuesta` apunta a la tabla `omnidesk_ai_replies`.
  - Tras `¿Ya respondida?` (no respondida):
    1. `Buscar prompt`: tabla `omnidesk_prompts`, `get` por `canal` = cabecera `x-client-id`, `limit 1`, `alwaysOutputData`.
    2. `¿Tiene prompt?` (existe `systemPrompt`): si no, `Responder 501` con `{ ok: false }`. OmniDesk no reintenta (SPEC 23) y el mensaje queda para atención humana.
    3. `Buscar endpoint menú`: tabla `omnidesk_endpoints`, `get` por `canal` = cabecera `x-client-id` y `nombre` = `menu`, `limit 1`, `alwaysOutputData`.
    4. `Preparar conversación` (nodo Code): arma el texto de entrada del agente con el nombre del cliente, el historial y el mensaje actual (formato en "Modelo de datos").
    5. `Agente IA` (AI Agent): prompt de sistema = `systemPrompt` de `Buscar prompt`; entrada = salida de `Preparar conversación`; **sin memoria**.
    6. `OpenAI Chat Model` con `gpt-5-mini` (como en el export del usuario).
    7. Tool `consultar_menu` (HTTP Request Tool):
       - URL = `baseUrl` + `ruta` y método = `metodo` de la fila de `Buscar endpoint menú`.
       - Cabecera `X-Client-Secret` = `clientSecret` de esa fila.
       - Descripción para el modelo: "Devuelve el menú completo del restaurante: productos, precios, modificadores y disponibilidad. Úsalo antes de dar cualquier dato de productos o precios."
       - Si no hay fila o Gastromesa falla, el tool devuelve el error al agente. El agente responde que no tiene el dato y ofrece un agente humano. El workflow responde `200`.
    8. `Guardar respuesta` y `Responder IA` (`200 { text }`), como en SPEC 23.
  - El texto del prompt de Sésamo sale del nodo y pasa a la fila de Sésamo en `omnidesk_prompts`. La documentación incluye ese texto como ejemplo.
  - Se importa desactivado. Los ids de `Credentials`, `omnidesk_ai_replies` y la credencial de OpenAI se conservan del export del usuario. Las tablas nuevas se seleccionan tras importar.
- **Ficheros de `tools/n8n/`:**
  - Se borra `OmniDesk — entrada2Modificada.json`.
  - `OmniDesk — entrada.json` (Anthropic, Simple Memory) y `OmniDesk — limpieza.json` no cambian.
- **Documentación** `docs/integracion-n8n.md`:
  - El campo `history` en "Petición que recibe n8n", con un ejemplo.
  - Con historial, la memoria del agente en n8n deja de ser necesaria.
  - Sección del workflow Gastromesa: tablas `omnidesk_prompts` y `omnidesk_endpoints` con sus columnas exactas, una fila de ejemplo para `menu`, pasos de importación y el prompt de Sésamo como ejemplo de `systemPrompt`.

**Fuera de alcance (para futuros specs):**

- Tools de comandas: crear (`POST /orders`) y consultar (`GET /orders/:id`) en Gastromesa. Van en **SPEC 25**.
- Cambiar `OmniDesk — entrada.json` (Anthropic con Simple Memory) para usar el historial.
- Enviar el archivo de un adjunto al modelo (imágenes, audios).
- Configurar el número de mensajes del historial por canal.
- Guardar los prompts o los endpoints de Gastromesa en OmniDesk (hoy viven en tablas de n8n).
- Cifrar `clientSecret` de Gastromesa en n8n (credencial en lugar de columna).
- Caché del menú en n8n.

## Modelo de datos

OmniDesk no añade tablas ni columnas. Cambia el contrato de `ai.reply`:

```ts
// packages/contracts/src/channels.ts
export const AI_REPLY_HISTORY_LIMIT = 20;

export const AiReplyHistoryMessageSchema = z.object({
  role: z.enum(['customer', 'ai', 'agent']),
  agentName: z.string().optional(), // solo en role 'agent'
  text: z.string(), // puede ser '' en un adjunto sin pie
  attachment: AttachmentKindSchema.optional(),
  at: z.iso.datetime(),
});

export const N8nAiReplyRequestSchema = z.object({
  type: z.literal('ai.reply'),
  messageId: z.uuid(),
  conversationId: z.uuid(),
  controlVersion: z.number().int(),
  channel: z.object({ id: z.uuid(), externalId: z.string() }),
  from: z.object({ externalId: z.string(), displayName: z.string().optional() }),
  text: z.string(),
  history: z.array(AiReplyHistoryMessageSchema).max(AI_REPLY_HISTORY_LIMIT),
});
```

Ejemplo de cuerpo:

```json
{
  "type": "ai.reply",
  "messageId": "…",
  "conversationId": "…",
  "controlVersion": 2,
  "channel": { "id": "…", "externalId": "1322469280958506" },
  "from": { "externalId": "+573008018173", "displayName": "Gossio" },
  "text": "¿y a qué hora llega?",
  "history": [
    { "role": "customer", "text": "Quiero dos hamburguesas", "at": "2026-10-16T18:00:00.000Z" },
    { "role": "ai", "text": "¡Claro! ¿Para domicilio o para recoger?", "at": "2026-10-16T18:00:04.000Z" },
    { "role": "agent", "agentName": "Laura", "text": "Tu pedido sale en 10 minutos.", "at": "2026-10-16T18:05:00.000Z" }
  ]
}
```

Texto de entrada del agente que arma `Preparar conversación`:

```text
Nombre del cliente en WhatsApp: Gossio

Conversación hasta ahora:
Cliente: Quiero dos hamburguesas
Asistente: ¡Claro! ¿Para domicilio o para recoger?
Agente (Laura): Tu pedido sale en 10 minutos.

Mensaje actual del cliente:
¿y a qué hora llega?
```

Un adjunto se escribe como `[imagen]`, `[documento]`, `[audio]`, `[video]` o `[sticker]`, seguido del pie si lo hay. Sin historial, se omite el bloque "Conversación hasta ahora". Sin `displayName`, se omite la primera línea.

Tablas nuevas en n8n (no en OmniDesk), todas las columnas de tipo texto:

`omnidesk_prompts`: una fila por canal.

| Columna        | Contenido                                        |
| -------------- | ------------------------------------------------ |
| `canal`        | Id del canal de OmniDesk (= `X-Client-Id`).      |
| `empresa`      | Nombre del negocio (p. ej. `Sésamo`). Solo informativo. |
| `systemPrompt` | Prompt de sistema del agente para ese canal.     |

`omnidesk_endpoints`: una fila por canal y endpoint.

| Columna        | Contenido                                                      |
| -------------- | -------------------------------------------------------------- |
| `canal`        | Id del canal de OmniDesk.                                      |
| `nombre`       | Endpoint lógico: `menu` (SPEC 24); `consultar_comanda` y `crear_comanda` llegan en SPEC 25. |
| `baseUrl`      | Base de la API, sin barra final: `https://dev.gastromesa.com/api/v1`. |
| `ruta`         | Ruta con barra inicial: `/menu/full`.                          |
| `metodo`       | `GET` o `POST`.                                                |
| `clientSecret` | Valor de la cabecera `X-Client-Secret` de Gastromesa.          |

## Plan de implementación

1. **Contrato.** Añadir `AI_REPLY_HISTORY_LIMIT`, `AiReplyHistoryMessageSchema` y `N8nAiReplyRequestSchema` en `packages/contracts/src/channels.ts`, con pruebas del esquema. Build de contracts.
2. **Lectura del historial.** Añadir `listAiHistory` al puerto `ConversationRepository`, su implementación en `prisma-conversation.repository.ts` (orden por `sequence` descendente con `take`, luego invertido; `include` de `attachment` y `sender`; filtro `NOT (direction = OUTBOUND AND status = FAILED)`) y en la fake `in-memory.ts`.
3. **Worker.** `AiReplyWorker` busca el mensaje actual (`findMessageById`) para su `sequence`, lee el historial y construye el cuerpo como `N8nAiReplyRequest`. Si el mensaje actual no existe, no llama a n8n.
4. **e2e.** En `apps/api/test/whatsapp.e2e-spec.ts`:
   - El primer mensaje llega con `history: []`.
   - Tras un mensaje de IA, uno de agente y uno saliente `FAILED`, el siguiente `ai.reply` trae los dos primeros con su `role`, el `agentName` del agente y sin el `FAILED`.
   - Con 25 mensajes previos, `history` trae los 20 más recientes en orden ascendente.
5. **Workflow.** Crear `tools/n8n/OmniDesk — entrada Gastromesa.json` a partir de `OmniDesk — entrada2Modificada.json` con los nodos del alcance, y borrar `OmniDesk — entrada2Modificada.json`. Comprobar que es JSON válido, que las conexiones apuntan a nodos existentes y que no quedan nodos sueltos.
6. **Docs.** Actualizar `docs/integracion-n8n.md`.

## Criterios de aceptación

- [ ] El primer `ai.reply` de una conversación nueva lleva `history: []`.
- [ ] `history` contiene como mucho 20 mensajes, en orden de `sequence` ascendente, y nunca incluye el mensaje actual.
- [ ] Un mensaje escrito por un agente aparece con `role: 'agent'` y `agentName` igual al `displayName` de su miembro.
- [ ] Un saliente con estado `FAILED` no aparece en `history`.
- [ ] Un mensaje con adjunto aparece con `attachment` igual a su tipo y sin datos del archivo.
- [ ] El cuerpo de `ai.reply` cumple `N8nAiReplyRequestSchema`.
- [ ] `OmniDesk — entrada2Modificada.json` ya no existe y `OmniDesk — entrada Gastromesa.json` se importa en n8n sin errores.
- [ ] En n8n, un `ai.reply` de un canal sin fila en `omnidesk_prompts` responde `501`, y OmniDesk hace una sola llamada.
- [ ] Con prompt y endpoint configurados, "¿qué tienen en el menú?" ejecuta `consultar_menu` y la respuesta menciona productos del menú de Gastromesa.
- [ ] Con un `clientSecret` de Gastromesa incorrecto, el workflow responde `200` con un texto que dice que no tiene el dato y ofrece un agente.
- [ ] Tras una respuesta de IA, `omnidesk_ai_replies` tiene una fila con su `idempotencyKey`, y n8n muestra una sola ejecución por mensaje.
- [ ] En una conversación donde el cliente escribe "quiero dos hamburguesas" y luego "mejor que sean tres", la segunda respuesta tiene en cuenta el pedido anterior.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y los e2e de la API pasan.

## Decisiones

- **Sí:** OmniDesk envía el historial y n8n queda sin memoria. OmniDesk es la fuente de verdad, ve también a los agentes humanos y aplica la retención (SPEC 12) y el borrado de empresa (SPEC 20).
- **No:** memoria persistente en n8n (Postgres o Redis). Ve la conversación incompleta y duplica datos personales fuera de OmniDesk.
- **Sí:** últimos 20 mensajes. Suficiente para un pedido con coste de tokens acotado. Decisión del usuario.
- **No:** ventana de 24 h con tope de 50. Más tokens por respuesta sin necesidad clara.
- **Sí:** cliente, IA y agentes; sin salientes `FAILED`. Sin los agentes, la IA puede contradecir lo que ya resolvió una persona. Decisión del usuario.
- **Sí:** el nombre del agente (`displayName` del miembro) va en el historial. Decisión del usuario, sabiendo que es un dato personal que llega al proveedor del modelo.
- **Sí:** el historial se lee al llamar a n8n, no al encolar. Un reintento tiene el contexto más reciente y el payload del Outbox no crece.
- **Sí:** el mensaje actual va solo en `text`, no repetido en `history`. Mantiene el contrato actual y evita duplicarlo en el prompt.
- **Sí:** el adjunto va como marcador de tipo, sin archivo. El modelo sabe que hubo una imagen sin coste de tokens ni de ancho de banda.
- **Sí:** contrato de la petición en `@omnidesk/contracts`. Hoy el cuerpo se arma a mano en el worker; con un campo nuevo conviene un esquema compartido.
- **Sí:** workflow nuevo `OmniDesk — entrada Gastromesa.json` a partir del export del usuario; `entrada.json` queda como ejemplo genérico. Decisión del usuario.
- **Sí:** OpenAI `gpt-5-mini`. Ya lo eligió el usuario en su export.
- **Sí:** prompt por canal en la tabla `omnidesk_prompts` (`canal`, `empresa`, `systemPrompt`). Un mismo workflow sirve a varios negocios. Sustituye la decisión de SPEC 23 de un prompt genérico en el nodo, solo para este workflow. Decisión del usuario.
- **Sí:** canal sin prompt → `501`. Ningún negocio recibe respuestas con un prompt ajeno; SPEC 23 lo deja para atención humana sin reintentos.
- **No:** prompt genérico de respaldo. Respondería sin datos ni tono del negocio.
- **Sí:** endpoints de Gastromesa en la tabla `omnidesk_endpoints` (`canal`, `nombre`, `baseUrl`, `ruta`, `metodo`, `clientSecret`), una fila por endpoint. Cada fila tiene todo lo necesario para una llamada. Decisión del usuario.
- **No:** columnas en la tabla `Credentials`. El usuario prefiere tablas separadas.
- **No:** credencial de n8n para el secreto de Gastromesa. Cifrada, pero una sola para todo el workflow.
- **Sí:** autenticación con `X-Client-Secret`, como en el ejemplo de Gastromesa.
- **Sí:** un tool por endpoint (`consultar_menu`) en lugar de un tool con ruta libre. El agente no puede llamar rutas no previstas.
- **Sí:** si el tool falla, el error vuelve al agente y el workflow responde `200`. El cliente recibe "no tengo ese dato" y la oferta de un agente, en lugar de 6 reintentos contra un Gastromesa caído.
- **Sí:** comandas en SPEC 25. Crear una comanda es una escritura: un reintento de `ai.reply` puede duplicarla y exige confirmación y datos que el modelo no debe inventar.
- **Sí:** se corrige `Guardar respuesta`. Sin tabla, cada mensaje termina en `500` y hasta 6 llamadas al modelo.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| `GET /menu/full` es grande y encarece cada respuesta que lo consulta. | El agente solo lo llama cuando necesita datos del menú (descripción del tool). Una caché en n8n queda fuera de alcance. |
| `clientSecret` de Gastromesa queda en claro en una tabla de n8n. | Acceso a n8n restringido. Pasar a una credencial cifrada queda fuera de alcance. |
| El historial más el menú superan el timeout de 10 s. | `gpt-5-mini` y 20 mensajes. Si pasa, es timeout → reintento, y `omnidesk_ai_replies` evita repetir el modelo si la respuesta ya se guardó. |
| El nombre del agente llega al proveedor del modelo. | Aceptado por el usuario. Solo el `displayName`, nunca el email. |
| El modelo inventa datos aunque el prompt lo prohíba. | El prompt de Sésamo exige usar solo datos del tool. Los pedidos reales no se crean en este spec. |
| `dev.gastromesa.com` es un entorno de desarrollo. | La URL vive en `omnidesk_endpoints`: pasar a producción es cambiar `baseUrl`. |

## Qué **no** entra en este spec

- Crear o consultar comandas en Gastromesa (SPEC 25).
- Cambiar el workflow genérico `OmniDesk — entrada.json`.
- Enviar archivos adjuntos al modelo.
- Historial configurable por canal.
- Prompts o endpoints guardados en OmniDesk.
- Credencial cifrada para Gastromesa y caché del menú.

Cada uno de esos, si llega, va en su propio spec.
